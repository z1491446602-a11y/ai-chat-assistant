import { describe, expect, it, vi } from 'vitest';
import {
  MediaTaskQueueFullError,
  MediaTaskQueueCancelledError,
  createMediaTaskScheduler,
} from '../../server/mediaTaskScheduler.js';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createJob(id, type, ownerId, deferred, started) {
  return {
    id,
    type,
    ownerId,
    run: vi.fn(async () => {
      started.push(id);
      return deferred.promise;
    }),
  };
}

describe('media task scheduler', () => {
  it('enforces total and per-type concurrency while allowing runnable work past a blocked type', async () => {
    const scheduler = createMediaTaskScheduler({
      maxConcurrent: 3,
      imageMaxConcurrent: 2,
      videoMaxConcurrent: 1,
      ownerMaxConcurrent: 2,
      maxQueued: 10,
      maxQueuedPerOwner: 10,
    });
    const started = [];
    const jobs = ['video-1', 'video-2', 'image-1', 'image-2'].map((id) => ({
      id,
      deferred: createDeferred(),
      type: id.startsWith('video') ? 'video' : 'image',
    }));

    const promises = jobs.map(({ id, type, deferred }) => scheduler.schedule(
      createJob(id, type, `owner-${id}`, deferred, started),
    ));
    await Promise.resolve();

    expect(started).toEqual(['video-1', 'image-1', 'image-2']);
    expect(scheduler.getStats()).toMatchObject({
      active: 3,
      queued: 1,
      activeByType: { image: 2, video: 1 },
    });

    jobs[0].deferred.resolve('video-1-done');
    await vi.waitFor(() => {
      expect(started).toEqual(['video-1', 'image-1', 'image-2', 'video-2']);
    });

    jobs.slice(1).forEach(({ deferred, id }) => deferred.resolve(`${id}-done`));
    await expect(Promise.all(promises)).resolves.toEqual([
      'video-1-done',
      'video-2-done',
      'image-1-done',
      'image-2-done',
    ]);
  });

  it('limits each owner to one active media task without blocking other owners', async () => {
    const scheduler = createMediaTaskScheduler({
      maxConcurrent: 2,
      imageMaxConcurrent: 2,
      videoMaxConcurrent: 1,
      ownerMaxConcurrent: 1,
      maxQueued: 10,
      maxQueuedPerOwner: 10,
    });
    const started = [];
    const first = createDeferred();
    const sameOwner = createDeferred();
    const otherOwner = createDeferred();

    const firstPromise = scheduler.schedule(createJob('first', 'image', 'owner-a', first, started));
    const sameOwnerPromise = scheduler.schedule(createJob('same-owner', 'image', 'owner-a', sameOwner, started));
    const otherOwnerPromise = scheduler.schedule(createJob('other-owner', 'image', 'owner-b', otherOwner, started));
    await Promise.resolve();

    expect(started).toEqual(['first', 'other-owner']);
    expect(scheduler.getQueuePosition('same-owner')).toBe(1);

    first.resolve('first-done');
    await vi.waitFor(() => {
      expect(started).toEqual(['first', 'other-owner', 'same-owner']);
    });

    sameOwner.resolve('same-owner-done');
    otherOwner.resolve('other-owner-done');
    await expect(Promise.all([firstPromise, sameOwnerPromise, otherOwnerPromise])).resolves.toEqual([
      'first-done',
      'same-owner-done',
      'other-owner-done',
    ]);
  });

  it('rejects queue overflow globally and per owner', async () => {
    const scheduler = createMediaTaskScheduler({
      maxConcurrent: 1,
      imageMaxConcurrent: 1,
      videoMaxConcurrent: 1,
      ownerMaxConcurrent: 1,
      maxQueued: 2,
      maxQueuedPerOwner: 1,
    });
    const started = [];
    const active = createDeferred();
    const queued = createDeferred();
    const otherQueued = createDeferred();

    const activePromise = scheduler.schedule(createJob('active', 'image', 'owner-a', active, started));
    const queuedPromise = scheduler.schedule(createJob('queued', 'image', 'owner-a', queued, started));
    await expect(scheduler.schedule(createJob('owner-overflow', 'image', 'owner-a', createDeferred(), started)))
      .rejects.toBeInstanceOf(MediaTaskQueueFullError);
    const otherQueuedPromise = scheduler.schedule(createJob('other-queued', 'video', 'owner-b', otherQueued, started));
    await expect(scheduler.schedule(createJob('global-overflow', 'image', 'owner-c', createDeferred(), started)))
      .rejects.toBeInstanceOf(MediaTaskQueueFullError);

    active.resolve();
    queued.resolve();
    otherQueued.resolve();
    await Promise.all([activePromise, queuedPromise, otherQueuedPromise]);
  });

  it('starts a runnable image even when the queue is full of blocked videos', async () => {
    const scheduler = createMediaTaskScheduler({
      maxConcurrent: 2,
      imageMaxConcurrent: 1,
      videoMaxConcurrent: 1,
      ownerMaxConcurrent: 1,
      maxQueued: 1,
      maxQueuedPerOwner: 1,
    });
    const started = [];
    const activeVideo = createDeferred();
    const queuedVideo = createDeferred();
    const image = createDeferred();

    const activePromise = scheduler.schedule(createJob('active-video', 'video', 'owner-a', activeVideo, started));
    const queuedPromise = scheduler.schedule(createJob('queued-video', 'video', 'owner-b', queuedVideo, started));
    const imagePromise = scheduler.schedule(createJob('image', 'image', 'owner-c', image, started));

    expect(started).toEqual(['active-video', 'image']);
    image.resolve();
    activeVideo.resolve();
    queuedVideo.resolve();
    await Promise.all([activePromise, queuedPromise, imagePromise]);
  });

  it('removes a cancelled queued task without consuming a slot', async () => {
    const scheduler = createMediaTaskScheduler({
      maxConcurrent: 1,
      imageMaxConcurrent: 1,
      videoMaxConcurrent: 1,
      ownerMaxConcurrent: 1,
      maxQueued: 5,
      maxQueuedPerOwner: 5,
    });
    const started = [];
    const active = createDeferred();
    const cancelled = createDeferred();
    const next = createDeferred();

    const activePromise = scheduler.schedule(createJob('active', 'image', 'owner-a', active, started));
    const cancelledPromise = scheduler.schedule(createJob('cancelled', 'image', 'owner-b', cancelled, started));
    const nextPromise = scheduler.schedule(createJob('next', 'video', 'owner-c', next, started));

    expect(scheduler.cancel('cancelled')).toBe(true);
    await expect(cancelledPromise).rejects.toBeInstanceOf(MediaTaskQueueCancelledError);
    active.resolve();
    await vi.waitFor(() => {
      expect(started).toEqual(['active', 'next']);
    });

    next.resolve();
    await Promise.all([activePromise, nextPromise]);
  });

  it('releases the active slot and continues the queue when onStart throws', async () => {
    const scheduler = createMediaTaskScheduler({
      maxConcurrent: 1,
      imageMaxConcurrent: 1,
      videoMaxConcurrent: 1,
      ownerMaxConcurrent: 1,
      maxQueued: 5,
      maxQueuedPerOwner: 5,
    });
    const startError = new Error('onStart failed');
    const next = createDeferred();
    const started = [];
    let failedPromise;

    expect(() => {
      failedPromise = scheduler.schedule({
        id: 'bad-start',
        type: 'image',
        ownerId: 'owner-a',
        onStart: () => {
          throw startError;
        },
        run: vi.fn(),
      });
    }).not.toThrow();
    const nextPromise = scheduler.schedule(createJob('next', 'image', 'owner-b', next, started));

    await expect(failedPromise).rejects.toBe(startError);
    await vi.waitFor(() => expect(started).toEqual(['next']));
    expect(scheduler.getStats()).toMatchObject({ active: 1, queued: 0 });

    next.resolve('next-done');
    await expect(nextPromise).resolves.toBe('next-done');
    expect(scheduler.getStats()).toMatchObject({ active: 0, queued: 0 });
  });

  it('holds five image slots for one batch before starting another image task', async () => {
    const scheduler = createMediaTaskScheduler({
      maxConcurrent: 5,
      imageMaxConcurrent: 5,
      videoMaxConcurrent: 1,
      ownerMaxConcurrent: 1,
      maxQueued: 10,
      maxQueuedPerOwner: 10,
    });
    const batch = createDeferred();
    const next = createDeferred();
    const started = [];
    const batchPromise = scheduler.schedule({ ...createJob('batch', 'image', 'owner-a', batch, started), slots: 5 });
    const nextPromise = scheduler.schedule(createJob('next', 'image', 'owner-b', next, started));

    expect(started).toEqual(['batch']);
    expect(scheduler.getStats()).toMatchObject({ active: 1, activeSlots: 5, activeByType: { image: 5, video: 0 } });

    batch.resolve();
    await vi.waitFor(() => expect(started).toEqual(['batch', 'next']));
    next.resolve();
    await Promise.all([batchPromise, nextPromise]);
  });
});
