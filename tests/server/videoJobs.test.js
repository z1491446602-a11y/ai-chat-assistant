import { describe, expect, it } from 'vitest';
import { createVideoJobStore } from '../../server/videoJobs.js';

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
  it('creates an allowlisted record without credentials or images', () => {
    const harness = createHarness({ users: {} });
    const job = harness.store.create({
      ownerId: 'owner', type: 'video', sessionId: 'session', messageId: 'message', userMessageId: 'user-message',
      prompt: 'make a video', apiKey: 'secret', images: ['data:image/png;base64,secret'],
    });

    expect(job).toEqual({
      id: 'job-1', ownerId: 'owner', ownerType: 'user', sessionId: 'session', messageId: 'message',
      userMessageId: 'user-message', prompt: 'make a video', upstreamTaskId: '', status: 'pending',
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

  it('classifies unfinished jobs by whether submission can be recovered', () => {
    const harness = createHarness({ videoJobs: {
      a: { id: 'a', status: 'processing', upstreamTaskId: 'up-a' },
      b: { id: 'b', status: 'pending', upstreamTaskId: '' },
      c: { id: 'c', status: 'completed', upstreamTaskId: 'up-c' },
    } });

    expect(harness.store.getRecoveryPlan()).toEqual({
      recoverable: [{ id: 'a', status: 'processing', upstreamTaskId: 'up-a' }],
      unknownSubmission: [{ id: 'b', status: 'pending', upstreamTaskId: '' }],
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
});
