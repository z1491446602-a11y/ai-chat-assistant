import { describe, expect, it, vi } from 'vitest';
import {
  createAiTaskStore,
  createChatTaskScheduler,
  reconcileMediaRequestOrphans,
} from '../../server/aiTasks.js';
import { createMediaTaskScheduler } from '../../server/mediaTaskScheduler.js';

function createDeferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createHarness({
  scheduler,
  chatScheduler,
  performImageGeneration,
  videoProvider,
  videoJobStore: providedVideoJobStore,
  performStreamingChatCompletion = vi.fn(),
  sanitizeAiMessage = message => message,
  settleMediaTask: providedSettleMediaTask,
  patchAiMessage: providedPatchAiMessage,
  clearAiSessionTask: providedClearAiSessionTask,
  terminalMediaRequest: providedTerminalMediaRequest,
  getMediaRequestKeyForTask: providedGetMediaRequestKeyForTask,
  settlementRetryDelaysMs,
  taskRetentionMs = 60_000,
}) {
  const sessions = new Map();
  const patches = [];
  const cleared = [];
  const videoJobStore = providedVideoJobStore || {
    patchVideoJob: vi.fn(),
    getRecoveryPlan: vi.fn(() => ({ recoverable: [], unknownSubmission: [] })),
  };
  const settleMediaTask = providedSettleMediaTask || vi.fn();
  const patchAiMessage = providedPatchAiMessage || vi.fn((_owner, sessionId, messageId, patch) => {
    patches.push({ sessionId, messageId, patch });
  });
  const clearAiSessionTask = providedClearAiSessionTask || vi.fn((_owner, sessionId) => {
    cleared.push(sessionId);
  });
  const terminalMediaRequest = providedTerminalMediaRequest || vi.fn();
  const store = createAiTaskStore({
    findAiSession: (_owner, sessionId) => sessions.get(sessionId) || null,
    upsertAiSession: (_owner, session) => { sessions.set(session.id, session); return session; },
    patchAiMessage,
    clearAiSessionTask,
    sanitizeAiMessage,
    buildVoiceReplyMessages: messages => messages,
    ensureVoiceReplyText: vi.fn(),
    performVoiceSynthesis: vi.fn(),
    performStreamingChatCompletion,
    performImageGeneration,
    videoProvider,
    videoFileStore: {
      inspectExistingVideo: vi.fn().mockResolvedValue(null),
      downloadValidateAndSave: vi.fn().mockResolvedValue({ videoUrl: '/videos/final.mp4' }),
    },
    videoJobStore,
    isKittyVoiceModel: () => false,
    resolveKittyVoiceProfile: vi.fn(),
    VOICE_STREAMING_TEXT: 'speaking',
    VOICE_REPLY_TEMPERATURE: 0.5,
    VOICE_REPLY_MAX_TOKENS: 100,
    VOICE_REPLY_TOP_P: 1,
    mediaTaskScheduler: scheduler,
    chatTaskScheduler: chatScheduler,
    settleMediaTask,
    terminalMediaRequest,
    getMediaRequestKeyForTask: providedGetMediaRequestKeyForTask || (() => ''),
    settlementRetryDelaysMs,
    taskRetentionMs,
  });
  return {
    store,
    sessions,
    patches,
    cleared,
    videoJobStore,
    settleMediaTask,
    patchAiMessage,
    clearAiSessionTask,
    terminalMediaRequest,
  };
}

function createTask(id, type, ownerId) {
  return {
    id,
    type,
    ownerId,
    ownerType: 'user',
    userId: ownerId,
    sessionId: `session-${id}`,
    messageId: `message-${id}`,
    status: 'pending',
    error: '',
    prompt: `${type} prompt`,
    images: [],
    imageProvider: 'grok',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('AI media task scheduling', () => {
  it('uses task-local input for the current chat message and releases it after completion', async () => {
    const inputImage = 'data:image/png;base64,AA==';
    const performStreamingChatCompletion = vi.fn().mockResolvedValue({
      content: '看到了',
      files: [],
    });
    const { store, sessions } = createHarness({
      performStreamingChatCompletion,
      sanitizeAiMessage: message => ({ ...message, images: undefined }),
    });
    const task = {
      ...createTask('chat-1', 'chat', 'owner-a'),
      userMessageId: 'user-message',
      inputMessage: {
        id: 'user-message',
        role: 'user',
        content: '看看这张图',
        images: [inputImage],
        status: 'sent',
      },
    };
    sessions.set(task.sessionId, {
      id: task.sessionId,
      messages: [
        { id: 'user-message', role: 'user', content: '看看这张图', status: 'sent' },
        { id: task.messageId, role: 'assistant', content: '正在思考...', status: 'streaming' },
      ],
    });
    store.registerAiTask(task);

    await store.runAiTask(task.id);

    expect(performStreamingChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({
        id: 'user-message',
        images: [inputImage],
      })],
    }));
    expect(task.inputMessage).toBeUndefined();
  });

  it('shares the total media limit between image and video tasks', async () => {
    const scheduler = createMediaTaskScheduler({
      maxConcurrent: 1,
      imageMaxConcurrent: 1,
      videoMaxConcurrent: 1,
      ownerMaxConcurrent: 1,
      maxQueued: 5,
      maxQueuedPerOwner: 2,
    });
    const imageDeferred = createDeferred();
    const performImageGeneration = vi.fn(() => imageDeferred.promise);
    const videoProvider = {
      submit: vi.fn().mockResolvedValue({ id: 'up-video', status: 'queued' }),
      poll: vi.fn().mockResolvedValue('https://cdn.example/video.mp4'),
    };
    const { store, sessions } = createHarness({ scheduler, performImageGeneration, videoProvider });
    const imageTask = createTask('image-1', 'image', 'owner-a');
    const videoTask = createTask('video-1', 'video', 'owner-b');
    sessions.set(imageTask.sessionId, { id: imageTask.sessionId, messages: [] });
    sessions.set(videoTask.sessionId, { id: videoTask.sessionId, messages: [] });
    store.registerAiTask(imageTask);
    store.registerAiTask(videoTask);

    const imageRun = store.runAiTask(imageTask.id);
    const videoRun = store.runAiTask(videoTask.id);
    await vi.waitFor(() => expect(performImageGeneration).toHaveBeenCalledTimes(1));

    expect(videoProvider.submit).not.toHaveBeenCalled();
    expect(store.serializeAiTask(videoTask)).toMatchObject({
      status: 'pending',
      queuePosition: 1,
      content: '视频任务正在排队...',
    });

    imageDeferred.resolve({ images: ['/uploads/image.png'], imageProvider: 'grok' });
    await imageRun;
    await vi.waitFor(() => expect(videoProvider.submit).toHaveBeenCalledTimes(1));
    await videoRun;
  });

  it('cancels a queued image without calling its provider', async () => {
    const scheduler = createMediaTaskScheduler({
      maxConcurrent: 1,
      imageMaxConcurrent: 1,
      videoMaxConcurrent: 1,
      ownerMaxConcurrent: 1,
      maxQueued: 5,
      maxQueuedPerOwner: 2,
    });
    const activeDeferred = createDeferred();
    const performImageGeneration = vi.fn()
      .mockImplementationOnce(() => activeDeferred.promise)
      .mockResolvedValueOnce({ images: ['/uploads/should-not-exist.png'], imageProvider: 'grok' });
    const videoProvider = { submit: vi.fn(), poll: vi.fn() };
    const { store, sessions, cleared } = createHarness({ scheduler, performImageGeneration, videoProvider });
    const activeTask = createTask('active', 'image', 'owner-a');
    const queuedTask = createTask('queued', 'image', 'owner-b');
    sessions.set(activeTask.sessionId, { id: activeTask.sessionId, messages: [] });
    sessions.set(queuedTask.sessionId, { id: queuedTask.sessionId, messages: [] });
    store.registerAiTask(activeTask);
    store.registerAiTask(queuedTask);

    const activeRun = store.runAiTask(activeTask.id);
    const queuedRun = store.runAiTask(queuedTask.id);
    await vi.waitFor(() => expect(store.serializeAiTask(queuedTask).queuePosition).toBe(1));

    expect(store.cancelAiTask(queuedTask.id)?.status).toBe('cancelled');
    await queuedRun;
    expect(performImageGeneration).toHaveBeenCalledTimes(1);
    expect(cleared).toContain(queuedTask.sessionId);

    activeDeferred.resolve({ images: ['/uploads/active.png'], imageProvider: 'grok' });
    await activeRun;
  });

  it('persists a failed video job when the media queue is full', async () => {
    const scheduler = createMediaTaskScheduler({
      maxConcurrent: 1,
      imageMaxConcurrent: 1,
      videoMaxConcurrent: 1,
      ownerMaxConcurrent: 1,
      maxQueued: 1,
      maxQueuedPerOwner: 1,
    });
    const activeDeferred = createDeferred();
    const performImageGeneration = vi.fn(() => activeDeferred.promise);
    const videoProvider = {
      submit: vi.fn().mockResolvedValue({ id: 'up-video', status: 'queued' }),
      poll: vi.fn().mockResolvedValue('https://cdn.example/video.mp4'),
    };
    const { store, sessions, videoJobStore } = createHarness({ scheduler, performImageGeneration, videoProvider });
    const activeTask = createTask('active-image', 'image', 'owner-a');
    const queuedTask = createTask('queued-video', 'video', 'owner-b');
    const overflowTask = createTask('overflow-video', 'video', 'owner-c');
    for (const task of [activeTask, queuedTask, overflowTask]) {
      sessions.set(task.sessionId, { id: task.sessionId, messages: [] });
      store.registerAiTask(task);
    }

    const activeRun = store.runAiTask(activeTask.id);
    const queuedRun = store.runAiTask(queuedTask.id);
    const overflowRun = store.runAiTask(overflowTask.id);
    await overflowRun;

    expect(store.getAiTask(overflowTask.id)).toMatchObject({
      status: 'failed',
      error: '媒体任务队列已满，请稍后重试',
    });
    expect(videoJobStore.patchVideoJob).toHaveBeenCalledWith(overflowTask.id, expect.objectContaining({
      status: 'failed',
      stage: 'submitting',
    }));

    activeDeferred.resolve({ images: ['/uploads/active.png'], imageProvider: 'grok' });
    await Promise.all([activeRun, queuedRun]);
  });

  it('drops heavy task inputs immediately and removes terminal tasks after the retention period', async () => {
    vi.useFakeTimers();
    try {
      const scheduler = createMediaTaskScheduler({ maxConcurrent: 1 });
      const performImageGeneration = vi.fn().mockResolvedValue({
        images: ['/uploads/image.png'],
        imageProvider: 'grok',
      });
      const { store, sessions } = createHarness({
        scheduler,
        performImageGeneration,
        videoProvider: { submit: vi.fn(), poll: vi.fn() },
        taskRetentionMs: 1_000,
      });
      const task = createTask('cleanup', 'image', 'owner-a');
      task.images = ['data:image/png;base64,large-input'];
      sessions.set(task.sessionId, { id: task.sessionId, messages: [] });
      store.registerAiTask(task);

      await store.runAiTask(task.id);
      expect(store.getAiTask(task.id)).not.toHaveProperty('images');
      expect(store.getAiTask(task.id)).not.toHaveProperty('prompt');

      await vi.advanceTimersByTimeAsync(1_001);
      expect(store.getAiTask(task.id)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles successful image reservations exactly once', async () => {
    const lifecycle = [];
    const settleMediaTask = vi.fn(() => { lifecycle.push('points'); });
    const terminalMediaRequest = vi.fn((_key, status) => { lifecycle.push(`request:${status}`); });
    const { store, sessions } = createHarness({
      scheduler: createMediaTaskScheduler({ maxConcurrent: 1 }),
      performImageGeneration: vi.fn().mockResolvedValue({
        images: ['/uploads/image.png'],
        imageProvider: 'gpt',
      }),
      videoProvider: { submit: vi.fn(), poll: vi.fn() },
      settleMediaTask,
      terminalMediaRequest,
    });
    const task = createTask('billed-success', 'image', 'owner-a');
    task.mediaRequestKey = 'media-request-success';
    sessions.set(task.sessionId, { id: task.sessionId, messages: [] });
    store.registerAiTask(task);

    await store.runAiTask(task.id);

    expect(settleMediaTask).toHaveBeenCalledTimes(1);
    expect(settleMediaTask).toHaveBeenCalledWith(task.id, true);
    expect(terminalMediaRequest).toHaveBeenCalledWith('media-request-success', 'completed');
    expect(lifecycle).toEqual(['points', 'request:completed']);
  });

  it('charges only successful images from a partially completed image batch', async () => {
    const settleMediaTask = vi.fn();
    const { store, sessions, patches } = createHarness({
      scheduler: createMediaTaskScheduler({ maxConcurrent: 5, imageMaxConcurrent: 5 }),
      performImageGeneration: vi.fn().mockResolvedValue({
        images: ['/uploads/1.png', '/uploads/2.png', '/uploads/3.png'],
        imageProvider: 'gpt',
        completedCount: 3,
        failedCount: 2,
      }),
      videoProvider: { submit: vi.fn(), poll: vi.fn() },
      settleMediaTask,
    });
    const task = createTask('batch-partial', 'image', 'owner-a');
    task.imageCount = 5;
    task.imageUnitCost = 2;
    sessions.set(task.sessionId, { id: task.sessionId, messages: [] });
    store.registerAiTask(task);

    await store.runAiTask(task.id);

    expect(settleMediaTask).toHaveBeenCalledWith(task.id, true, 6);
    expect(patches.at(-1)?.patch).toMatchObject({
      content: '已生成 3/5 张图片，2 张失败。',
      images: ['/uploads/1.png', '/uploads/2.png', '/uploads/3.png'],
      status: 'sent',
    });
  });

  it('retries failed media settlement with bounded backoff until it succeeds', async () => {
    vi.useFakeTimers();
    try {
      const firstError = new Error('disk busy');
      const secondError = new Error('disk still busy');
      const settleMediaTask = vi.fn()
        .mockImplementationOnce(() => { throw firstError; })
        .mockImplementationOnce(() => { throw secondError; })
        .mockReturnValue({ status: 'settled', success: true });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { store, sessions } = createHarness({
        scheduler: createMediaTaskScheduler({ maxConcurrent: 1 }),
        performImageGeneration: vi.fn().mockResolvedValue({
          images: ['/uploads/retry-success.png'],
          imageProvider: 'gpt',
        }),
        videoProvider: { submit: vi.fn(), poll: vi.fn() },
        settleMediaTask,
        settlementRetryDelaysMs: [100, 200],
      });
      const task = createTask('settlement-retry', 'image', 'owner-a');
      task.mediaRequestKey = 'media-request-retry';
      sessions.set(task.sessionId, { id: task.sessionId, messages: [] });
      store.registerAiTask(task);

      await store.runAiTask(task.id);
      expect(settleMediaTask).toHaveBeenCalledTimes(1);
      expect(store.getAiTask(task.id)).toMatchObject({
        pointsFinalized: false,
        pointsSettlementAttempts: 1,
      });
      expect(store.getAiTask(task.id)?.mediaRequestFinalized).not.toBe(true);

      await vi.advanceTimersByTimeAsync(100);
      expect(settleMediaTask).toHaveBeenCalledTimes(2);
      expect(store.getAiTask(task.id)).toMatchObject({ pointsSettlementAttempts: 2 });

      await vi.advanceTimersByTimeAsync(200);
      expect(settleMediaTask).toHaveBeenCalledTimes(3);
      expect(settleMediaTask).toHaveBeenNthCalledWith(3, task.id, true);
      expect(store.getAiTask(task.id)).toMatchObject({
        pointsFinalized: true,
        pointsSettlementAttempts: 3,
        mediaRequestFinalized: true,
      });
      expect(store.getAiTask(task.id)).not.toHaveProperty('pointsSettlementTimer');
      consoleError.mockRestore();
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it('stops retrying after the settlement retry budget is exhausted', async () => {
    vi.useFakeTimers();
    const settlementError = new Error('persistent disk failure');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const settleMediaTask = vi.fn(() => { throw settlementError; });
      const { store, sessions } = createHarness({
        scheduler: createMediaTaskScheduler({ maxConcurrent: 1 }),
        performImageGeneration: vi.fn().mockResolvedValue({
          images: ['/uploads/persisted-result.png'],
          imageProvider: 'gpt',
        }),
        videoProvider: { submit: vi.fn(), poll: vi.fn() },
        settleMediaTask,
        settlementRetryDelaysMs: [100, 200],
      });
      const task = createTask('settlement-exhausted', 'image', 'owner-a');
      sessions.set(task.sessionId, { id: task.sessionId, messages: [] });
      store.registerAiTask(task);

      await store.runAiTask(task.id);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);

      expect(settleMediaTask).toHaveBeenCalledTimes(3);
      expect(store.getAiTask(task.id)).toMatchObject({
        status: 'completed',
        pointsFinalized: false,
        pointsSettlementAttempts: 3,
        pointsSettlementExhausted: true,
        partialImages: ['/uploads/persisted-result.png'],
      });
      expect(store.getAiTask(task.id)).not.toHaveProperty('pointsSettlementTimer');
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('failed after 3 attempts'),
        settlementError,
      );

      await vi.advanceTimersByTimeAsync(1_000);
      expect(settleMediaTask).toHaveBeenCalledTimes(3);
    } finally {
      consoleError.mockRestore();
      vi.useRealTimers();
    }
  });

  it('releases failed image reservations and exposes only a Chinese public error', async () => {
    const { store, sessions, patches, settleMediaTask, terminalMediaRequest } = createHarness({
      scheduler: createMediaTaskScheduler({ maxConcurrent: 1 }),
      performImageGeneration: vi.fn().mockRejectedValue(
        new Error('The generated images appear to be unsafe. Try modifying the prompts.'),
      ),
      videoProvider: { submit: vi.fn(), poll: vi.fn() },
    });
    const task = createTask('billed-failure', 'image', 'owner-a');
    task.mediaRequestKey = 'media-request-failure';
    sessions.set(task.sessionId, { id: task.sessionId, messages: [] });
    store.registerAiTask(task);

    await store.runAiTask(task.id);

    expect(settleMediaTask).toHaveBeenCalledTimes(1);
    expect(settleMediaTask).toHaveBeenCalledWith(task.id, false);
    expect(terminalMediaRequest).toHaveBeenCalledWith('media-request-failure', 'failed');
    expect(store.getAiTask(task.id)?.error).toBe('图片内容可能不符合安全规范，请调整描述后重试。');
    const publicContent = patches.at(-1)?.patch?.content || '';
    expect(publicContent).toContain('图片内容可能不符合安全规范');
    expect(publicContent).not.toMatch(/unsafe|generated images|try modifying/iu);
  });

  it('releases a reservation when the media queue rejects a task', async () => {
    const scheduler = createMediaTaskScheduler({
      maxConcurrent: 1,
      maxQueued: 1,
      maxQueuedPerOwner: 1,
    });
    const activeDeferred = createDeferred();
    const { store, sessions, settleMediaTask } = createHarness({
      scheduler,
      performImageGeneration: vi.fn(() => activeDeferred.promise),
      videoProvider: { submit: vi.fn(), poll: vi.fn() },
    });
    const activeTask = createTask('queue-active', 'image', 'owner-a');
    const queuedTask = createTask('queue-waiting', 'image', 'owner-b');
    const rejectedTask = createTask('queue-rejected', 'image', 'owner-c');
    for (const task of [activeTask, queuedTask, rejectedTask]) {
      sessions.set(task.sessionId, { id: task.sessionId, messages: [] });
      store.registerAiTask(task);
    }

    const activeRun = store.runAiTask(activeTask.id);
    const queuedRun = store.runAiTask(queuedTask.id);
    await store.runAiTask(rejectedTask.id);

    expect(settleMediaTask).toHaveBeenCalledWith(rejectedTask.id, false);
    activeDeferred.resolve({ images: ['/uploads/active.png'], imageProvider: 'gpt' });
    await Promise.all([activeRun, queuedRun]);
  });

  it('catches a rejected promise from a resumed video task', async () => {
    const backgroundError = new Error('scheduler failed');
    const scheduler = {
      schedule: vi.fn().mockRejectedValue(backgroundError),
      cancel: vi.fn(() => false),
      getQueuePosition: vi.fn(() => 0),
    };
    const videoJobStore = {
      patchVideoJob: vi.fn(),
      getRecoveryPlan: vi.fn(() => ({
        recoverable: [{
          id: 'video-resumed',
          ownerId: 'owner-a',
          ownerType: 'user',
          sessionId: 'session-video-resumed',
          messageId: 'message-video-resumed',
          userMessageId: 'user-message-video-resumed',
          prompt: '恢复视频',
          upstreamTaskId: 'upstream-video-resumed',
          stage: 'processing',
        }],
        unknownSubmission: [],
      })),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { store, sessions } = createHarness({
        scheduler,
        performImageGeneration: vi.fn(),
        videoProvider: { submit: vi.fn(), poll: vi.fn() },
        videoJobStore,
      });
      sessions.set('session-video-resumed', {
        id: 'session-video-resumed',
        messages: [{ id: 'user-message-video-resumed', role: 'user', content: '恢复视频' }],
      });

      expect(store.resumeVideoJobs()).toMatchObject({ recoveredCount: 1 });
      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('Background AI task'),
          backgroundError,
        );
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps a running cancellation terminal when the provider ignores abort', async () => {
    const providerResult = createDeferred();
    const performImageGeneration = vi.fn(() => providerResult.promise);
    const { store, sessions, patchAiMessage, settleMediaTask, clearAiSessionTask } = createHarness({
      scheduler: createMediaTaskScheduler({ maxConcurrent: 1 }),
      performImageGeneration,
      videoProvider: { submit: vi.fn(), poll: vi.fn() },
    });
    const task = createTask('ignore-abort', 'image', 'owner-a');
    task.mediaRequestKey = 'media-request-cancel';
    sessions.set(task.sessionId, { id: task.sessionId, messages: [] });
    store.registerAiTask(task);

    const run = store.runAiTask(task.id);
    await vi.waitFor(() => expect(performImageGeneration).toHaveBeenCalledTimes(1));
    expect(store.cancelAiTask(task.id)?.status).toBe('cancelled');
    expect(settleMediaTask).toHaveBeenCalledWith(task.id, false);
    expect(clearAiSessionTask).toHaveBeenCalledWith(expect.anything(), task.sessionId, task.id);
    expect(store.getAiTask(task.id)?.mediaRequestFinalized).toBe(true);
    providerResult.resolve({ images: ['/uploads/must-not-be-persisted.png'], imageProvider: 'gpt' });
    await run;

    expect(store.getAiTask(task.id)).toMatchObject({ status: 'cancelled' });
    expect(store.getAiTask(task.id)?.partialImages).toBeUndefined();
    expect(patchAiMessage).not.toHaveBeenCalledWith(
      expect.anything(),
      task.sessionId,
      task.messageId,
      expect.objectContaining({ images: ['/uploads/must-not-be-persisted.png'] }),
    );
    expect(settleMediaTask).toHaveBeenCalledWith(task.id, false);
    expect(settleMediaTask).not.toHaveBeenCalledWith(task.id, true);
    expect(clearAiSessionTask).toHaveBeenCalledWith(expect.anything(), task.sessionId, task.id);
  });

  it('isolates terminal cleanup so a session save failure cannot skip settlement or input release', async () => {
    vi.useFakeTimers();
    const clearError = new Error('session save failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const clearAiSessionTask = vi.fn(() => { throw clearError; });
      const { store, sessions, settleMediaTask } = createHarness({
        scheduler: createMediaTaskScheduler({ maxConcurrent: 1 }),
        performImageGeneration: vi.fn().mockResolvedValue({
          images: ['/uploads/completed.png'],
          imageProvider: 'gpt',
        }),
        videoProvider: { submit: vi.fn(), poll: vi.fn() },
        clearAiSessionTask,
        taskRetentionMs: 100,
      });
      const task = createTask('cleanup-save-failure', 'image', 'owner-a');
      task.images = ['data:image/png;base64,large'];
      sessions.set(task.sessionId, { id: task.sessionId, messages: [] });
      store.registerAiTask(task);

      await expect(store.runAiTask(task.id)).resolves.toBeUndefined();

      expect(settleMediaTask).toHaveBeenCalledWith(task.id, true);
      expect(store.getAiTask(task.id)).not.toHaveProperty('images');
      expect(store.getAiTask(task.id)).not.toHaveProperty('prompt');
      await vi.advanceTimersByTimeAsync(101);
      expect(store.getAiTask(task.id)).toBeNull();
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('clear session task'),
        clearError,
      );
    } finally {
      consoleError.mockRestore();
      vi.useRealTimers();
    }
  });

  it('keeps a result-persistence failure classified as task failure while cleanup still completes', async () => {
    const persistenceError = new Error('disk full');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const patchAiMessage = vi.fn(() => { throw persistenceError; });
      const { store, sessions, settleMediaTask, clearAiSessionTask } = createHarness({
        scheduler: createMediaTaskScheduler({ maxConcurrent: 1 }),
        performImageGeneration: vi.fn().mockResolvedValue({
          images: ['/uploads/generated-but-unsaved.png'],
          imageProvider: 'gpt',
        }),
        videoProvider: { submit: vi.fn(), poll: vi.fn() },
        patchAiMessage,
      });
      const task = createTask('result-save-failure', 'image', 'owner-a');
      sessions.set(task.sessionId, { id: task.sessionId, messages: [] });
      store.registerAiTask(task);

      await expect(store.runAiTask(task.id)).resolves.toBeUndefined();

      expect(store.getAiTask(task.id)).toMatchObject({
        status: 'failed',
        error: '图片生成失败，请稍后重试。',
      });
      expect(store.getAiTask(task.id)?.partialImages).toBeUndefined();
      expect(settleMediaTask).toHaveBeenCalledWith(task.id, false);
      expect(clearAiSessionTask).toHaveBeenCalledWith(expect.anything(), task.sessionId, task.id);
      expect(store.getAiTask(task.id)).not.toHaveProperty('prompt');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('fails and releases an image task when its result message no longer exists', async () => {
    const patchAiMessage = vi.fn(() => null);
    const { store, sessions, settleMediaTask } = createHarness({
      scheduler: createMediaTaskScheduler({ maxConcurrent: 1 }),
      performImageGeneration: vi.fn().mockResolvedValue({
        images: ['/uploads/generated-but-unlinked.png'],
        imageProvider: 'gpt',
      }),
      videoProvider: { submit: vi.fn(), poll: vi.fn() },
      patchAiMessage,
    });
    const task = createTask('missing-image-message', 'image', 'owner-a');
    sessions.set(task.sessionId, { id: task.sessionId, messages: [] });
    store.registerAiTask(task);

    await store.runAiTask(task.id);

    expect(store.getAiTask(task.id)).toMatchObject({ status: 'failed' });
    expect(store.getAiTask(task.id)?.partialImages).toBeUndefined();
    expect(settleMediaTask).toHaveBeenCalledWith(task.id, false);
    expect(settleMediaTask).not.toHaveBeenCalledWith(task.id, true);
  });

  it('fails and releases a video task when its result message no longer exists', async () => {
    const patchAiMessage = vi.fn(() => null);
    const videoProvider = {
      submit: vi.fn().mockResolvedValue({ id: 'upstream-video', status: 'queued' }),
      poll: vi.fn().mockResolvedValue('https://cdn.example/result.mp4'),
    };
    const { store, sessions, settleMediaTask, videoJobStore } = createHarness({
      scheduler: createMediaTaskScheduler({ maxConcurrent: 1 }),
      performImageGeneration: vi.fn(),
      videoProvider,
      patchAiMessage,
    });
    const task = createTask('missing-video-message', 'video', 'owner-a');
    sessions.set(task.sessionId, { id: task.sessionId, messages: [] });
    store.registerAiTask(task);

    await store.runAiTask(task.id);

    expect(store.getAiTask(task.id)).toMatchObject({ status: 'failed' });
    expect(settleMediaTask).toHaveBeenCalledWith(task.id, false);
    expect(settleMediaTask).not.toHaveBeenCalledWith(task.id, true);
    expect(videoJobStore.patchVideoJob).not.toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('turns an unexpected scheduler start failure into a failed terminal task', async () => {
    const schedulerError = new Error('scheduler unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scheduler = {
      schedule: vi.fn().mockRejectedValue(schedulerError),
      cancel: vi.fn(() => false),
      getQueuePosition: vi.fn(() => 0),
    };
    try {
      const { store, sessions, settleMediaTask, clearAiSessionTask } = createHarness({
        scheduler,
        performImageGeneration: vi.fn(),
        videoProvider: { submit: vi.fn(), poll: vi.fn() },
      });
      const task = createTask('start-failure', 'image', 'owner-a');
      sessions.set(task.sessionId, { id: task.sessionId, messages: [] });
      store.registerAiTask(task);

      await expect(store.runAiTask(task.id)).resolves.toBeUndefined();

      expect(store.getAiTask(task.id)).toMatchObject({
        status: 'failed',
        error: '媒体任务启动失败，请稍后重试',
      });
      expect(settleMediaTask).toHaveBeenCalledWith(task.id, false);
      expect(clearAiSessionTask).toHaveBeenCalledWith(expect.anything(), task.sessionId, task.id);
      expect(consoleError).toHaveBeenCalledWith(
        'Background AI task start-failure failed:',
        schedulerError,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('bounds guest chat execution and fails overflow instead of bypassing scheduling', async () => {
    const firstReply = createDeferred();
    const performStreamingChatCompletion = vi.fn()
      .mockImplementationOnce(() => firstReply.promise)
      .mockResolvedValue({ content: 'queued reply', files: [] });
    const chatScheduler = createChatTaskScheduler({
      maxConcurrent: 1,
      maxQueued: 1,
      ownerMaxConcurrent: 1,
      maxQueuedPerOwner: 1,
    });
    const { store, sessions } = createHarness({
      chatScheduler,
      performStreamingChatCompletion,
      performImageGeneration: vi.fn(),
      videoProvider: { submit: vi.fn(), poll: vi.fn() },
    });
    const tasks = ['guest-active', 'guest-queued', 'guest-overflow'].map((id, index) => ({
      ...createTask(id, 'chat', `guest-${index}`),
      ownerId: `guest-${index}`,
      ownerType: 'guest',
      userId: '',
      userMessageId: `user-${id}`,
      inputMessage: { id: `user-${id}`, role: 'user', content: id, status: 'sent' },
    }));
    for (const task of tasks) {
      sessions.set(task.sessionId, {
        id: task.sessionId,
        messages: [
          task.inputMessage,
          { id: task.messageId, role: 'assistant', content: '正在思考...', status: 'streaming' },
        ],
      });
      store.registerAiTask(task);
    }

    const activeRun = store.runAiTask(tasks[0].id);
    const queuedRun = store.runAiTask(tasks[1].id);
    await vi.waitFor(() => expect(performStreamingChatCompletion).toHaveBeenCalledTimes(1));
    await store.runAiTask(tasks[2].id);

    expect(store.getAiTask(tasks[1].id)).toMatchObject({ status: 'pending' });
    expect(store.getAiTask(tasks[2].id)).toMatchObject({
      status: 'failed',
      error: '聊天服务繁忙，请稍后重试',
    });
    firstReply.resolve({ content: 'active reply', files: [] });
    await Promise.all([activeRun, queuedRun]);
    expect(performStreamingChatCompletion).toHaveBeenCalledTimes(2);
  });
});

describe('media request startup reconciliation', () => {
  it('clears and releases interrupted claimed submissions without touching newer or active tasks', () => {
    const claimed = {
      key: 'request-claimed', userId: 'owner-a', mediaType: 'image', status: 'claimed',
    };
    const pointReservations = {
      interrupted: {
        taskId: 'interrupted', userId: 'owner-a', taskType: 'image', status: 'reserved',
      },
      active: {
        taskId: 'active', userId: 'owner-a', taskType: 'image', status: 'reserved',
      },
      otherOwner: {
        taskId: 'other-owner', userId: 'owner-b', taskType: 'image', status: 'reserved',
      },
    };
    const sessions = [
      { id: 'stale-session', pendingTaskId: 'interrupted' },
      { id: 'new-session', pendingTaskId: 'new-task' },
    ];
    const mediaRequestService = {
      getRecoveryPlan: vi.fn(() => ({
        claimed: [claimed], activeAccepted: [], orphanAccepted: [], terminalLinked: [],
      })),
      abort: vi.fn(),
      prune: vi.fn(() => []),
    };
    const clearAiSessionTask = vi.fn((_owner, sessionId, taskId) => (
      sessionId === 'stale-session' && taskId === 'interrupted'
    ));
    const settleMediaTask = vi.fn((taskId) => {
      pointReservations[taskId].status = 'released';
    });

    const result = reconcileMediaRequestOrphans({
      mediaRequestService,
      activeTaskIds: ['active'],
      pointReservations,
      getAiSessions: owner => (owner.userId === 'owner-a' ? sessions : []),
      findAiSession: vi.fn(),
      patchAiMessage: vi.fn(),
      clearAiSessionTask,
      settleMediaTask,
      videoJobStore: { getVideoJob: vi.fn() },
    });

    expect(clearAiSessionTask).toHaveBeenCalledOnce();
    expect(clearAiSessionTask).toHaveBeenCalledWith(
      { userId: 'owner-a' }, 'stale-session', 'interrupted',
    );
    expect(settleMediaTask).toHaveBeenCalledOnce();
    expect(settleMediaTask).toHaveBeenCalledWith('interrupted', false);
    expect(mediaRequestService.abort).toHaveBeenCalledWith(claimed.key);
    expect(pointReservations.active.status).toBe('reserved');
    expect(sessions[1].pendingTaskId).toBe('new-task');
    expect(result).toMatchObject({ abortedCount: 1, errors: [] });
  });

  it('does not release an accepted orphan when another request for the same media type is claimed', () => {
    const accepted = {
      key: 'request-accepted', userId: 'owner-a', mediaType: 'image', taskId: 'accepted-task',
      sessionId: 'accepted-session', messageId: 'accepted-message', status: 'accepted',
    };
    const mediaRequestService = {
      getRecoveryPlan: vi.fn(() => ({
        claimed: [{ key: 'request-claimed', userId: 'owner-a', mediaType: 'image', status: 'claimed' }],
        activeAccepted: [],
        orphanAccepted: [accepted],
        terminalLinked: [],
      })),
      abort: vi.fn(),
      terminal: vi.fn(),
    };
    const settleMediaTask = vi.fn();

    reconcileMediaRequestOrphans({
      mediaRequestService,
      pointReservations: {
        accepted: {
          taskId: 'accepted-task', userId: 'owner-a', taskType: 'image', status: 'reserved',
        },
      },
      getAiSessions: () => [{ id: 'accepted-session', pendingTaskId: 'accepted-task' }],
      findAiSession: () => ({
        id: 'accepted-session',
        pendingTaskId: 'accepted-task',
        messages: [{ id: 'accepted-message', status: 'sent', images: ['/uploads/result.png'] }],
      }),
      patchAiMessage: vi.fn(),
      clearAiSessionTask: vi.fn(() => true),
      settleMediaTask,
      videoJobStore: { getVideoJob: vi.fn() },
    });

    expect(settleMediaTask).not.toHaveBeenCalledWith('accepted-task', false);
    expect(settleMediaTask).toHaveBeenCalledWith('accepted-task', true);
  });

  it('clears only matching terminal pending markers before pruning recovery evidence', () => {
    const matching = {
      key: 'request-terminal-a', userId: 'owner-a', mediaType: 'image', taskId: 'task-a',
      sessionId: 'session-a', messageId: 'message-a', status: 'completed',
    };
    const different = {
      key: 'request-terminal-b', userId: 'owner-a', mediaType: 'image', taskId: 'task-b',
      sessionId: 'session-b', messageId: 'message-b', status: 'failed',
    };
    const events = [];
    const mediaRequestService = {
      getRecoveryPlan: vi.fn(() => {
        events.push('plan');
        return { activeAccepted: [], orphanAccepted: [], terminalLinked: [matching, different] };
      }),
      prune: vi.fn(() => { events.push('prune'); return []; }),
    };
    const clearAiSessionTask = vi.fn((_owner, _sessionId, taskId) => {
      events.push(`clear:${taskId}`);
      return true;
    });

    const result = reconcileMediaRequestOrphans({
      mediaRequestService,
      findAiSession: (_owner, sessionId) => (
        sessionId === 'session-a'
          ? { id: sessionId, pendingTaskId: 'task-a', messages: [] }
          : { id: sessionId, pendingTaskId: 'newer-task', messages: [] }
      ),
      patchAiMessage: vi.fn(),
      clearAiSessionTask,
      settleMediaTask: vi.fn(),
      videoJobStore: { getVideoJob: vi.fn() },
    });

    expect(result.terminalPendingClearedCount).toBe(1);
    expect(clearAiSessionTask).toHaveBeenCalledOnce();
    expect(clearAiSessionTask).toHaveBeenCalledWith(
      { userId: 'owner-a' }, 'session-a', 'task-a',
    );
    expect(events).toEqual(['plan', 'clear:task-a', 'prune']);
  });

  it('charges persisted successful evidence before marking an orphan request completed', () => {
    const events = [];
    const record = {
      key: 'request-completed', userId: 'owner-a', mediaType: 'image', taskId: 'task-a',
      sessionId: 'session-a', messageId: 'message-a', status: 'accepted',
    };
    const mediaRequestService = {
      getRecoveryPlan: vi.fn(() => ({ activeAccepted: [], orphanAccepted: [record] })),
      terminal: vi.fn((_key, status) => { events.push(`terminal:${status}`); }),
      recoverAccepted: vi.fn(),
    };
    const settleMediaTask = vi.fn((_taskId, success) => { events.push(`points:${success}`); });

    const result = reconcileMediaRequestOrphans({
      mediaRequestService,
      activeTaskIds: [],
      findAiSession: () => ({
        id: 'session-a',
        messages: [{ id: 'message-a', status: 'sent', images: ['/uploads/result.png'] }],
      }),
      patchAiMessage: vi.fn(),
      clearAiSessionTask: vi.fn(),
      settleMediaTask,
      videoJobStore: { getVideoJob: vi.fn() },
    });

    expect(result).toMatchObject({ completedCount: 1, failedCount: 0, abortedCount: 0, errors: [] });
    expect(settleMediaTask).toHaveBeenCalledWith('task-a', true);
    expect(mediaRequestService.terminal).toHaveBeenCalledWith(record.key, 'completed');
    expect(events).toEqual(['points:true', 'terminal:completed']);
  });

  it('persists an interruption, releases points, and marks recoverable history failed', () => {
    const record = {
      key: 'request-interrupted', userId: 'owner-a', mediaType: 'image', taskId: 'task-a',
      sessionId: 'session-a', messageId: 'message-a', status: 'accepted',
    };
    const mediaRequestService = {
      getRecoveryPlan: vi.fn(() => ({ activeAccepted: [], orphanAccepted: [record] })),
      terminal: vi.fn(),
      recoverAccepted: vi.fn(),
    };
    const patchAiMessage = vi.fn();
    const clearAiSessionTask = vi.fn();
    const settleMediaTask = vi.fn();

    const result = reconcileMediaRequestOrphans({
      mediaRequestService,
      findAiSession: () => ({
        id: 'session-a',
        messages: [{ id: 'message-a', status: 'streaming', content: '正在生成图片...' }],
      }),
      patchAiMessage,
      clearAiSessionTask,
      settleMediaTask,
      videoJobStore: { getVideoJob: vi.fn() },
    });

    expect(result.failedCount).toBe(1);
    expect(patchAiMessage).toHaveBeenCalledWith(
      { userId: 'owner-a' }, 'session-a', 'message-a',
      expect.objectContaining({ status: 'error' }),
    );
    expect(settleMediaTask).toHaveBeenCalledWith('task-a', false);
    expect(clearAiSessionTask).toHaveBeenCalledWith({ userId: 'owner-a' }, 'session-a', 'task-a');
    expect(mediaRequestService.terminal).toHaveBeenCalledWith(record.key, 'failed');
  });

  it('releases and aborts an accepted orphan whose persisted session is missing', () => {
    const record = {
      key: 'request-missing', userId: 'owner-a', mediaType: 'video', taskId: 'task-a',
      sessionId: 'session-a', messageId: 'message-a', status: 'accepted',
    };
    const mediaRequestService = {
      getRecoveryPlan: vi.fn(() => ({ activeAccepted: [], orphanAccepted: [record] })),
      terminal: vi.fn(),
      recoverAccepted: vi.fn(),
    };
    const settleMediaTask = vi.fn();

    const result = reconcileMediaRequestOrphans({
      mediaRequestService,
      findAiSession: () => null,
      patchAiMessage: vi.fn(),
      clearAiSessionTask: vi.fn(),
      settleMediaTask,
      videoJobStore: { getVideoJob: vi.fn(() => null) },
    });

    expect(result.abortedCount).toBe(1);
    expect(settleMediaTask).toHaveBeenCalledWith('task-a', false);
    expect(mediaRequestService.recoverAccepted).toHaveBeenCalledWith(record.key, 'aborted');
    expect(mediaRequestService.terminal).not.toHaveBeenCalled();
  });

  it('keeps an orphan accepted when points cannot be settled for retry on next startup', () => {
    const settlementError = new Error('disk full');
    const record = {
      key: 'request-retry', userId: 'owner-a', mediaType: 'image', taskId: 'task-a',
      sessionId: 'session-a', messageId: 'message-a', status: 'accepted',
    };
    const mediaRequestService = {
      getRecoveryPlan: vi.fn(() => ({ activeAccepted: [], orphanAccepted: [record] })),
      terminal: vi.fn(),
      recoverAccepted: vi.fn(),
    };

    const result = reconcileMediaRequestOrphans({
      mediaRequestService,
      findAiSession: () => ({
        messages: [{ id: 'message-a', status: 'sent', images: ['/uploads/result.png'] }],
      }),
      patchAiMessage: vi.fn(),
      clearAiSessionTask: vi.fn(),
      settleMediaTask: vi.fn(() => { throw settlementError; }),
      videoJobStore: { getVideoJob: vi.fn() },
    });

    expect(result.errors).toEqual([expect.objectContaining({ taskId: 'task-a', error: settlementError })]);
    expect(mediaRequestService.terminal).not.toHaveBeenCalled();
    expect(mediaRequestService.recoverAccepted).not.toHaveBeenCalled();
  });
});
