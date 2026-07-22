import { describe, expect, it } from 'vitest';
import {
  MAX_VIDEO_JOBS,
  MAX_VIDEO_PROMPT_LENGTH,
  createVideoJobStore,
} from '../../server/videoJobs.js';

function createHarness(initialData = {}) {
  let data = initialData;
  const store = createVideoJobStore({
    loadData: () => data,
    saveData: nextData => { data = JSON.parse(JSON.stringify(nextData)); },
    now: (() => { let value = 100; return () => ++value; })(),
    generateId: () => 'job-1',
  });
  return { store, data: () => data };
}

describe('video job persistence', () => {
  it('initializes videoJobs only when the property is missing', () => {
    const harness = createHarness({ users: {} });

    expect(harness.store.getRecoveryPlan()).toEqual({
      recoverable: [],
      unknownSubmission: [],
      staleAssets: [],
    });
    expect(harness.data().videoJobs).toEqual({});
  });

  it.each([
    ['an array', []],
    ['null', null],
    ['a string', 'corrupt'],
    ['a number', 42],
  ])('rejects %s without replacing the persisted videoJobs value', (_label, invalidValue) => {
    const data = { videoJobs: invalidValue };
    let saves = 0;
    const store = createVideoJobStore({
      data,
      saveData: () => { saves += 1; },
    });

    expect(() => store.getRecoveryPlan())
      .toThrow('Persisted videoJobs must be an object');
    expect(data.videoJobs).toBe(invalidValue);
    expect(saves).toBe(0);
  });

  it('creates an allowlisted record without credentials or images', () => {
    const harness = createHarness({ users: {} });
    const job = harness.store.create({
      ownerId: 'owner', type: 'video', sessionId: 'session', messageId: 'message', userMessageId: 'user-message',
      prompt: 'make a video', apiKey: 'secret', images: ['data:image/png;base64,secret'],
    });

    expect(job).toEqual({
      id: 'job-1', ownerId: 'owner', ownerType: 'user', sessionId: 'session', messageId: 'message',
      userMessageId: 'user-message', prompt: 'make a video', upstreamTaskId: '', videoAssetIds: [], status: 'pending',
      stage: 'created', error: '', createdAt: 101, updatedAt: 101,
    });
    expect(harness.data().videoJobs['job-1']).toEqual(job);
    expect(JSON.stringify(harness.data())).not.toContain('secret');
  });

  it('patches only persisted fields and supports old data without videoJobs', () => {
    const harness = createHarness({ users: {} });
    harness.store.create({ prompt: 'go' });
    const patched = harness.store.patch('job-1', { status: 'processing', upstreamTaskId: 'up-1', apiKey: 'nope' });

    expect(patched.status).toBe('processing');
    expect(patched.upstreamTaskId).toBe('up-1');
    expect(patched).not.toHaveProperty('apiKey');
    expect(harness.store.get('job-1')).toEqual(patched);
  });

  it('bounds prompt updates as well as newly created prompts', () => {
    const harness = createHarness({ videoJobs: {
      'job-1': { id: 'job-1', prompt: 'short', status: 'pending', createdAt: 1, updatedAt: 1 },
    } });

    const patched = harness.store.patch('job-1', {
      prompt: 'x'.repeat(MAX_VIDEO_PROMPT_LENGTH + 1),
    });

    expect(patched.prompt).toHaveLength(MAX_VIDEO_PROMPT_LENGTH);
    expect(harness.data().videoJobs['job-1'].prompt).toHaveLength(MAX_VIDEO_PROMPT_LENGTH);
  });

  it('classifies unfinished jobs by whether submission can be recovered', () => {
    const harness = createHarness({ videoJobs: {
      a: { id: 'a', status: 'processing', upstreamTaskId: 'up-a' },
      b: { id: 'b', status: 'pending', upstreamTaskId: '' },
      c: { id: 'c', status: 'completed', upstreamTaskId: 'up-c', videoAssetIds: ['asset-c'] },
    } });

    expect(harness.store.getRecoveryPlan()).toEqual({
      recoverable: [{ id: 'a', status: 'processing', upstreamTaskId: 'up-a' }],
      unknownSubmission: [{ id: 'b', status: 'pending', upstreamTaskId: '' }],
      staleAssets: [{
        id: 'c', status: 'completed', upstreamTaskId: 'up-c', videoAssetIds: ['asset-c'],
      }],
    });
  });

  it('supports the server shared-data API and persists owner type', () => {
    const data = {};
    let saves = 0;
    const store = createVideoJobStore({ data, saveData: () => { saves += 1; }, now: () => 10, generateId: () => 'job-2' });

    const job = store.createVideoJob({ ownerId: 'guest-1', ownerType: 'guest', videoStage: 'submitting' });
    expect(job).toMatchObject({ id: 'job-2', ownerId: 'guest-1', ownerType: 'guest', stage: 'submitting' });
    expect(store.getVideoJob('job-2')).toEqual(job);
    expect(store.patchVideoJob('job-2', { status: 'running' }).status).toBe('running');
    expect(saves).toBe(2);
  });

  it('rolls a patch back when persistence fails', () => {
    const data = {
      videoJobs: {
        'job-1': { id: 'job-1', status: 'pending', createdAt: 1, updatedAt: 1 },
      },
    };
    const saveError = new Error('disk full');
    const store = createVideoJobStore({
      data,
      saveData: () => { throw saveError; },
      now: () => 2,
    });

    expect(() => store.patch('job-1', { status: 'completed' })).toThrow(saveError);
    expect(data.videoJobs['job-1']).toEqual({
      id: 'job-1', status: 'pending', createdAt: 1, updatedAt: 1,
    });
  });

  it('bounds prompts and prunes the oldest terminal jobs before active jobs', () => {
    const terminalJobs = Object.fromEntries(Array.from({ length: MAX_VIDEO_JOBS }, (_, index) => [
      `terminal-${index}`,
      {
        id: `terminal-${index}`,
        prompt: 'old',
        status: 'completed',
        createdAt: index + 1,
        updatedAt: index + 1,
      },
    ]));
    const data = {
      videoJobs: {
        active: { id: 'active', prompt: 'keep', status: 'processing', createdAt: 0, updatedAt: 0 },
        ...terminalJobs,
      },
    };
    const store = createVideoJobStore({
      data,
      saveData: () => {},
      now: () => MAX_VIDEO_JOBS + 10,
      generateId: () => 'new-job',
    });

    const created = store.create({ prompt: 'x'.repeat(MAX_VIDEO_PROMPT_LENGTH + 100) });

    expect(created.prompt).toHaveLength(MAX_VIDEO_PROMPT_LENGTH);
    expect(Object.keys(data.videoJobs)).toHaveLength(MAX_VIDEO_JOBS);
    expect(data.videoJobs.active).toBeDefined();
    expect(data.videoJobs['terminal-0']).toBeUndefined();
    expect(data.videoJobs['terminal-1']).toBeUndefined();
    expect(data.videoJobs['new-job']).toBeDefined();
  });
});
