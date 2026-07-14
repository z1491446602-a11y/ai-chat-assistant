import express from 'express';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as aiRoutesModule from '../../server/aiRoutes.js';
import { createAiSessionStore } from '../../server/aiSessions.js';
import { createVideoJobStore } from '../../server/videoJobs.js';
import { createMediaRequestService } from '../../server/mediaRequestService.js';

const { createGuestOperationLimiter, registerAiRoutes } = aiRoutesModule;

const openServers = new Set();

function createDeferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function resolveOwner(input = {}) {
  if (String(input.userId || '').trim()) {
    const userId = String(input.userId).trim();
    return {
      ownerRef: { userId },
      ownerId: userId,
      ownerType: 'user',
    };
  }
  if (String(input.guestId || '').trim()) {
    const guestId = String(input.guestId).trim();
    return {
      ownerRef: { guestId },
      ownerId: guestId,
      ownerType: 'guest',
    };
  }
  return { error: '缺少用户或访客标识' };
}

function createRouteHarness({
  reserve,
  settle,
  upstreamFetch,
  resolveGeneratedImages,
  runAiTask = vi.fn(),
  resolveImageProvider,
  resolveImageReferences = vi.fn(async images => images),
  upsertAiSession,
  linkMediaTask,
  registerTask,
  cancelTask,
  saveData = vi.fn(),
  useRealStores = false,
  defaultImageApiKey = 'configured',
  defaultChatApiKey = 'configured',
  useMediaRequestService = false,
  mediaRequestService: providedMediaRequestService,
  chatTaskScheduler,
  resolveChatProvider: providedResolveChatProvider,
  buildResponsesInput: providedBuildResponsesInput,
  buildResponsesInstructions: providedBuildResponsesInstructions,
  buildChatCompletionsMessages: providedBuildChatCompletionsMessages,
  buildChatCompletionsPayload: providedBuildChatCompletionsPayload,
  streamResponse: providedStreamResponse,
  baiduSpeechApiKey = '',
  baiduSpeechSecretKey = '',
  baiduSpeechTokenUrl = '',
  baiduSpeechAsrUrl = '',
} = {}) {
  const sessions = new Map();
  const tasks = new Map();
  const data = { aiSessions: {}, videoJobs: {}, mediaRequests: {} };
  let entityCounter = 0;
  const pointsService = {
    reserve: reserve || vi.fn(),
    settle: settle || vi.fn((_taskId, success) => ({
      status: success ? 'settled' : 'released',
      success: Boolean(success),
    })),
    linkMediaTask: linkMediaTask || vi.fn(),
  };
  const sessionStore = useRealStores
    ? createAiSessionStore({
      data,
      saveData,
      normalizeUserId: value => String(value || '').trim(),
      normalizeGuestId: value => String(value || '').trim(),
      generateEntityId: prefix => `${prefix}-${++entityCounter}`,
      getAiTask: id => tasks.get(id) || null,
    })
    : null;
  const videoJobStore = useRealStores
    ? createVideoJobStore({ data, saveData, now: () => Date.now() })
    : { createVideoJob: vi.fn() };
  const mediaRequestService = providedMediaRequestService || (useMediaRequestService
    ? createMediaRequestService({ data, saveData })
    : undefined);
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use((req, _res, next) => {
    const userId = String(req.get('x-test-auth-user') || '').trim();
    if (userId) {
      req.authUser = { id: userId, role: 'user' };
    }
    next();
  });

  const createSession = (ownerRef, input = {}) => {
    const id = `session-${++entityCounter}`;
    const session = {
      id,
      ownerId: ownerRef.userId || ownerRef.guestId,
      ownerType: ownerRef.userId ? 'user' : 'guest',
      model: input.model || '',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    sessions.set(id, session);
    return session;
  };

  const cancelAiTask = vi.fn((taskId, options = {}) => {
    const task = tasks.get(taskId);
    if (task) {
      task.status = 'cancelled';
      delete task.inputMessage;
      delete task.images;
      delete task.prompt;
      if (options.remove) {
        tasks.delete(taskId);
      }
    }
    cancelTask?.(task, options);
    return task || null;
  });

  registerAiRoutes(app, {
    upstreamFetch: upstreamFetch || vi.fn(),
    resolveAiOwnerFromInput: resolveOwner,
    getAiSessions: sessionStore?.getAiSessions || vi.fn(() => []),
    createAiSession: sessionStore?.createAiSession || createSession,
    findAiSession: sessionStore?.findAiSession || vi.fn((_ownerRef, id) => sessions.get(id) || null),
    upsertAiSession: sessionStore?.upsertAiSession || upsertAiSession || vi.fn((_ownerRef, session) => {
      sessions.set(session.id, session);
      return session;
    }),
    appendAiMessage: sessionStore?.appendAiMessage || vi.fn((_ownerRef, sessionId, message) => {
      const saved = { id: `message-${++entityCounter}`, ...message };
      sessions.get(sessionId)?.messages.push(saved);
      return saved;
    }),
    getAiTask: vi.fn(id => tasks.get(id) || null),
    registerAiTask: vi.fn(task => {
      tasks.set(task.id, task);
      registerTask?.(task);
      return task;
    }),
    serializeAiTask: task => task,
    runAiTask,
    cancelAiTask,
    chatTaskScheduler,
    resolveImageReferences,
    pointsService,
    mediaRequestService,
    videoJobStore,
    removeAiSession: sessionStore?.removeAiSession || vi.fn(),
    removeAllAiSessions: sessionStore?.removeAllAiSessions || vi.fn(() => 0),
    generateEntityId: prefix => `${prefix}-${++entityCounter}`,
    normalizeChatModel: model => String(model || 'chat-model'),
    resolveChatProvider: providedResolveChatProvider || vi.fn(),
    resolveImageProvider: resolveImageProvider || (provider => ({
      id: provider === 'grok' ? 'grok' : 'gpt',
      label: provider === 'grok' ? 'Grok' : 'GPT',
      model: provider === 'grok' ? 'grok-image' : 'gpt-image',
      apiKey: 'configured',
    })),
    buildResponsesInput: providedBuildResponsesInput || vi.fn(),
    buildResponsesInstructions: providedBuildResponsesInstructions || vi.fn(),
    buildChatCompletionsMessages: providedBuildChatCompletionsMessages || vi.fn(),
    buildChatCompletionsPayload: providedBuildChatCompletionsPayload || vi.fn(),
    streamResponse: providedStreamResponse || vi.fn(),
    appendOptionalImageSize: value => value,
    buildCompatibleImagePrompt: value => value,
    resolveGeneratedImages: resolveGeneratedImages || vi.fn(),
    DEFAULT_CHAT_API_KEY: defaultChatApiKey,
    DEFAULT_CHAT_MODEL: 'chat-model',
    DEFAULT_ENABLE_WEB_SEARCH: true,
    isKittyVoiceModel: () => false,
    VOICE_STREAMING_TEXT: '正在说话中...',
    DEFAULT_IMAGE_API_URL: 'https://images.invalid',
    DEFAULT_IMAGE_API_KEY: defaultImageApiKey,
    DEFAULT_IMAGE_MODEL: 'gpt-image',
    VIDEO_API_MODEL: 'video-model',
    BAIDU_SPEECH_API_KEY: baiduSpeechApiKey,
    BAIDU_SPEECH_SECRET_KEY: baiduSpeechSecretKey,
    BAIDU_SPEECH_TOKEN_URL: baiduSpeechTokenUrl,
    BAIDU_SPEECH_ASR_URL: baiduSpeechAsrUrl,
    BAIDU_SPEECH_DEV_PID: 1537,
  });

  const server = createServer(app);
  openServers.add(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        pointsService,
        tasks,
        runAiTask,
        videoJobStore,
        data,
        saveData,
        sessionStore,
        sessions,
        cancelAiTask,
        mediaRequestService,
      });
    });
  });
}

afterEach(async () => {
  await Promise.all([...openServers].map(server => new Promise(resolve => {
    server.close(() => resolve());
  })));
  openServers.clear();
});

async function postJson(baseUrl, path, body, userId = '', extraHeaders = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'x-test-auth-user': userId } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function getJson(baseUrl, path, userId = '') {
  return fetch(`${baseUrl}${path}`, {
    headers: userId ? { 'x-test-auth-user': userId } : {},
  });
}

function finishHarnessImageTask(harness, taskId, {
  images = ['/uploads/generated.png'],
  status = 'completed',
  error = '',
} = {}) {
  const task = harness.tasks.get(taskId);
  if (!task) throw new Error(`Missing task ${taskId}`);
  task.status = status;
  task.error = error;
  task.partialImages = status === 'completed' ? images : undefined;
  task.updatedAt = Date.now();

  const ownerRef = { userId: task.ownerId };
  const session = harness.sessionStore.findAiSession(ownerRef, task.sessionId);
  const messages = session.messages.map(message => (
    message.id === task.messageId
      ? {
          ...message,
          content: status === 'completed' ? '图片已生成。' : `错误: ${error}`,
          images: status === 'completed' ? images : undefined,
          imageProvider: task.imageProvider,
          imageGenerationStage: undefined,
          status: status === 'completed' ? 'sent' : 'error',
        }
      : message
  ));
  const nextSession = { ...session, messages, updatedAt: Date.now() };
  delete nextSession.pendingTaskId;
  harness.sessionStore.upsertAiSession(ownerRef, nextSession);
  harness.pointsService.settle(task.id, status === 'completed');
  harness.mediaRequestService.terminal(task.mediaRequestKey, status);
}

describe('AI route ownership and media billing', () => {
  it('expires guest rate windows and bounds the in-memory IP registry', () => {
    let now = 1_000;
    const limiter = createGuestOperationLimiter({
      limit: 2,
      windowMs: 100,
      maxKeys: 2,
      now: () => now,
    });

    expect(limiter.consume('ip-a')).toBe(true);
    expect(limiter.consume('ip-a')).toBe(true);
    expect(limiter.consume('ip-a')).toBe(false);
    now += 101;
    expect(limiter.consume('ip-a')).toBe(true);
    expect(limiter.consume('ip-b')).toBe(true);
    expect(limiter.consume('ip-c')).toBe(true);

    expect(limiter.size()).toBe(2);
  });

  it('normalizes bounded chat task input before it can enter the queue', () => {
    expect(aiRoutesModule.normalizeChatTaskInput).toBeTypeOf('function');
    const normalized = aiRoutesModule.normalizeChatTaskInput({
      content: ' 你好 ',
      images: ['data:image/png;base64,AA=='],
      files: [{
        fileName: ' notes.txt ',
        fileUrl: '/uploads/notes.txt',
        fileSize: 12,
        mimeType: 'text/plain',
        ignoredPayload: 'must-not-enter-the-queue',
      }],
      apiKey: ' configured-key ',
    });

    expect(normalized).toEqual({
      content: '你好',
      images: ['data:image/png;base64,AA=='],
      files: [{
        fileName: 'notes.txt',
        fileUrl: '/uploads/notes.txt',
        fileSize: 12,
        mimeType: 'text/plain',
      }],
      apiKey: 'configured-key',
    });
    expect(JSON.stringify(normalized)).not.toContain('must-not-enter-the-queue');
  });

  it('rejects oversized chat content and aggregate queued input', () => {
    expect(aiRoutesModule.MAX_CHAT_CONTENT_LENGTH).toBeGreaterThan(0);
    expect(aiRoutesModule.MAX_CHAT_QUEUED_INPUT_BYTES).toBeGreaterThan(0);
    expect(() => aiRoutesModule.normalizeChatTaskInput({
      content: 'x'.repeat(aiRoutesModule.MAX_CHAT_CONTENT_LENGTH + 1),
    })).toThrowError(expect.objectContaining({ code: 'CHAT_INPUT_TOO_LARGE' }));
    expect(() => aiRoutesModule.normalizeChatTaskInput({
      images: [`data:image/jpeg;base64,${'A'.repeat(aiRoutesModule.MAX_CHAT_QUEUED_INPUT_BYTES)}`],
    })).toThrowError(expect.objectContaining({ code: 'CHAT_INPUT_TOO_LARGE' }));
  });

  it('runs the legacy chat proxy inside the injected shared chat scheduler', async () => {
    const chatTaskScheduler = {
      schedule: vi.fn(input => input.run()),
    };
    const upstreamFetch = vi.fn().mockResolvedValue({ ok: true });
    const { baseUrl } = await createRouteHarness({
      chatTaskScheduler,
      upstreamFetch,
      resolveChatProvider: () => ({
        apiKey: 'configured',
        apiUrl: 'https://chat.invalid',
        model: 'chat-model',
        protocol: 'responses',
        provider: 'openai',
      }),
      buildResponsesInput: async messages => messages,
      buildResponsesInstructions: () => undefined,
      streamResponse: (res) => res.json({ ok: true }),
    });

    const response = await postJson(baseUrl, '/api/chat', {
      messages: [{ role: 'user', content: '你好' }],
    });

    expect(response.status).toBe(200);
    expect(chatTaskScheduler.schedule).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: expect.stringContaining('guest'),
      run: expect.any(Function),
    }));
  });

  it('runs voice transcription inside the injected shared chat scheduler', async () => {
    const chatTaskScheduler = {
      schedule: vi.fn(input => input.run()),
    };
    const upstreamFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'speech-token', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ err_no: 0, result: ['你好'] }),
      });
    const { baseUrl } = await createRouteHarness({
      chatTaskScheduler,
      upstreamFetch,
      baiduSpeechApiKey: 'speech-key',
      baiduSpeechSecretKey: 'speech-secret',
      baiduSpeechTokenUrl: 'https://speech.invalid/token',
      baiduSpeechAsrUrl: 'https://speech.invalid/asr',
    });

    const response = await postJson(baseUrl, '/api/voice/transcribe', {
      audioData: 'data:audio/wav;base64,AA==',
      mimeType: 'audio/wav',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: '你好' });
    expect(chatTaskScheduler.schedule).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: expect.stringContaining('guest'),
      run: expect.any(Function),
    }));
  });

  it('shares the guest IP rate limit across legacy chat and voice endpoints', async () => {
    const { baseUrl } = await createRouteHarness();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (let index = 0; index < 20; index += 1) {
        await postJson(baseUrl, '/api/chat', { messages: [] });
      }

      const response = await postJson(baseUrl, '/api/voice/transcribe', {
        audioData: 'data:audio/wav;base64,AA==',
      });

      expect(response.status).toBe(429);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('rejects oversized decoded voice input before calling the upstream service', async () => {
    expect(aiRoutesModule.MAX_VOICE_AUDIO_BYTES).toBeGreaterThan(0);
    const upstreamFetch = vi.fn();
    const { baseUrl } = await createRouteHarness({ upstreamFetch });
    const oversizedBase64 = 'A'.repeat(
      Math.ceil((aiRoutesModule.MAX_VOICE_AUDIO_BYTES + 1) * 4 / 3),
    );

    const response = await postJson(baseUrl, '/api/voice/transcribe', {
      audioData: `data:audio/wav;base64,${oversizedBase64}`,
      mimeType: 'audio/wav',
    });

    expect(response.status).toBe(413);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('keeps ordinary guest chat available', async () => {
    const { baseUrl } = await createRouteHarness();

    const response = await postJson(baseUrl, '/api/ai-task/chat', {
      guestId: 'guest-browser',
      content: '你好',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('task.type', 'chat');
  });

  it('returns 409 instead of deleting a session with a pending task', async () => {
    const { baseUrl, sessionStore, tasks } = await createRouteHarness({ useRealStores: true });
    const ownerRef = { userId: 'signed-in-user' };
    const session = sessionStore.createAiSession(ownerRef);
    tasks.set('running-task', { id: 'running-task', status: 'running' });
    sessionStore.upsertAiSession(ownerRef, { ...session, pendingTaskId: 'running-task' });

    const response = await fetch(
      `${baseUrl}/api/ai-sessions/signed-in-user/${session.id}`,
      { method: 'DELETE', headers: { 'x-test-auth-user': 'signed-in-user' } },
    );

    expect(response.status).toBe(409);
    expect(sessionStore.findAiSession(ownerRef, session.id)).toMatchObject({
      id: session.id,
      pendingTaskId: 'running-task',
    });
  });

  it('returns 409 instead of deleting all sessions when any task is pending', async () => {
    const { baseUrl, sessionStore, tasks } = await createRouteHarness({ useRealStores: true });
    const ownerRef = { userId: 'signed-in-user' };
    const first = sessionStore.createAiSession(ownerRef);
    const second = sessionStore.createAiSession(ownerRef);
    tasks.set('running-task', { id: 'running-task', status: 'pending' });
    sessionStore.upsertAiSession(ownerRef, { ...second, pendingTaskId: 'running-task' });

    const response = await fetch(
      `${baseUrl}/api/ai-sessions/signed-in-user`,
      { method: 'DELETE', headers: { 'x-test-auth-user': 'signed-in-user' } },
    );

    expect(response.status).toBe(409);
    expect(sessionStore.findAiSession(ownerRef, first.id)).not.toBeNull();
    expect(sessionStore.findAiSession(ownerRef, second.id)).toMatchObject({
      pendingTaskId: 'running-task',
    });
  });

  it('rate-limits combined guest session creation and chat submissions by client IP', async () => {
    const { baseUrl } = await createRouteHarness();

    for (let index = 0; index < 10; index += 1) {
      const response = await postJson(baseUrl, '/api/ai-sessions', {
        guestId: `session-guest-${index}`,
      });
      expect(response.status).toBe(200);
    }
    for (let index = 0; index < 10; index += 1) {
      const response = await postJson(baseUrl, '/api/ai-task/chat', {
        guestId: `chat-guest-${index}`,
        content: `message ${index}`,
      });
      expect(response.status).toBe(200);
    }

    const limited = await postJson(baseUrl, '/api/ai-task/chat', {
      guestId: 'chat-guest-overflow',
      content: 'too many requests',
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: '访客操作过于频繁，请稍后再试' });
  });

  it('persists chat input, assistant placeholder, and pending task in one session transaction', async () => {
    const { baseUrl, data, saveData, tasks } = await createRouteHarness({ useRealStores: true });

    const response = await postJson(baseUrl, '/api/ai-task/chat', {
      guestId: 'guest-browser',
      content: '一次事务提交',
    });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(saveData).toHaveBeenCalledTimes(1);
    expect(data.aiSessions['guest:guest-browser'][0]).toMatchObject({
      pendingTaskId: result.task.id,
      messages: [
        expect.objectContaining({ role: 'user', content: '一次事务提交' }),
        expect.objectContaining({ role: 'assistant', status: 'streaming' }),
      ],
    });
    expect(tasks.get(result.task.id)?.inputMessage.content).toBe('一次事务提交');
  });

  it('rejects more than eight chat images before creating a task', async () => {
    const { baseUrl, tasks } = await createRouteHarness();

    const response = await postJson(baseUrl, '/api/ai-task/chat', {
      guestId: 'guest-browser',
      content: '查看这些图片',
      images: Array.from({ length: 9 }, (_, index) => `/uploads/image-${index}.png`),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '最多只能使用 8 张参考图' });
    expect(tasks.size).toBe(0);
  });

  it.each([
    ['/api/ai-task/chat', { content: '第二条消息' }],
    ['/api/ai-task/image', { prompt: '第二个生图任务', imageProvider: 'gpt' }],
    ['/api/ai-task/video', { prompt: '第二个视频任务', images: [] }],
  ])('rejects a second task for the same pending session without replacing it: %s', async (path, body) => {
    const resolveImageReferences = vi.fn(async images => images);
    const { baseUrl, data, tasks, pointsService } = await createRouteHarness({
      useRealStores: true,
      resolveImageReferences,
    });
    const firstResponse = await postJson(baseUrl, '/api/ai-task/chat', {
      content: '第一条消息',
    }, 'signed-in-user');
    const first = await firstResponse.json();

    const response = await postJson(baseUrl, path, {
      ...body,
      sessionId: first.sessionId,
    }, 'signed-in-user');

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: '当前会话已有任务正在处理，请等待完成后再试' });
    expect(data.aiSessions['signed-in-user'][0].pendingTaskId).toBe(first.task.id);
    expect(data.aiSessions['signed-in-user'][0].messages).toHaveLength(2);
    expect(tasks.size).toBe(1);
    expect(pointsService.reserve).not.toHaveBeenCalled();
    expect(resolveImageReferences).not.toHaveBeenCalled();
  });

  it('rolls back a chat transaction and removes raw task input when activation fails', async () => {
    const activationError = new Error('activation failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { baseUrl, data, tasks, cancelAiTask } = await createRouteHarness({
        useRealStores: true,
        registerTask: () => { throw activationError; },
      });

      const response = await postJson(baseUrl, '/api/ai-task/chat', {
        guestId: 'guest-browser',
        content: '不应残留',
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: '聊天任务提交失败，请稍后重试' });
      expect(data.aiSessions['guest:guest-browser'] || []).toEqual([]);
      expect(tasks.size).toBe(0);
      expect(cancelAiTask).toHaveBeenCalledWith(expect.any(String), { remove: true });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps guest chat data URLs task-local while removing them from session persistence', async () => {
    const { baseUrl, data, tasks } = await createRouteHarness({ useRealStores: true });
    const inputImage = 'data:image/png;base64,AA==';

    const response = await postJson(baseUrl, '/api/ai-task/chat', {
      guestId: 'guest-browser',
      content: '看看这张图',
      images: [inputImage],
    });
    const result = await response.json();

    expect(response.status).toBe(200);
    const task = tasks.get(result.task.id);
    expect(task.inputMessage).toMatchObject({
      id: task.userMessageId,
      content: '看看这张图',
      images: [inputImage],
    });
    const persistedUserMessage = data.aiSessions['guest:guest-browser'][0].messages[0];
    expect(persistedUserMessage.images).toBeUndefined();
  });

  it.each([
    ['/api/ai-task/image', { guestId: 'guest-browser', prompt: '画一只猫', imageProvider: 'gpt' }],
    ['/api/ai-task/video', { guestId: 'guest-browser', prompt: '海边日落', images: [] }],
    ['/api/image-generation', { prompt: '兼容接口生图' }],
  ])('requires login for media endpoint %s', async (path, body) => {
    const { baseUrl, pointsService } = await createRouteHarness();

    const response = await postJson(baseUrl, path, body);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: '请先登录后再使用图片或视频生成功能' });
    expect(pointsService.reserve).not.toHaveBeenCalled();
  });

  it('uses the authenticated cookie identity instead of a body userId', async () => {
    const { baseUrl, tasks } = await createRouteHarness();

    const response = await postJson(baseUrl, '/api/ai-task/chat', {
      userId: 'victim-user',
      content: '不能冒充其他账号',
    }, 'signed-in-user');
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(tasks.get(result.task.id)).toMatchObject({
      ownerId: 'signed-in-user',
      ownerType: 'user',
    });
  });

  it.each([
    ['gpt', 2],
    ['grok', 1],
  ])('reserves the configured %s image cost before task submission', async (provider, costUnits) => {
    const { baseUrl, pointsService } = await createRouteHarness();

    const response = await postJson(baseUrl, '/api/ai-task/image', {
      userId: 'ignored-body-user',
      prompt: '生成一张图片',
      imageProvider: provider,
    }, 'signed-in-user');
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(pointsService.reserve).toHaveBeenCalledWith({
      taskId: result.task.id,
      userId: 'signed-in-user',
      costUnits,
      taskType: 'image',
    });
    expect(pointsService.linkMediaTask).toHaveBeenCalledWith(result.task.id, {
      sessionId: result.sessionId,
      messageId: result.messageId,
    });
  });

  it('reserves five image costs when the prompt requests five images', async () => {
    const { baseUrl, pointsService } = await createRouteHarness();

    const response = await postJson(baseUrl, '/api/ai-task/image', {
      prompt: '生成5张城市夜景图片',
      imageProvider: 'gpt',
    }, 'signed-in-user');
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.task.imageCount).toBe(5);
    expect(pointsService.reserve).toHaveBeenCalledWith(expect.objectContaining({ costUnits: 10 }));
  });

  it('returns 402 without creating a media task when points are insufficient', async () => {
    const reserve = vi.fn(() => {
      const error = new Error('Insufficient points');
      error.code = 'INSUFFICIENT_POINTS';
      throw error;
    });
    const { baseUrl, tasks } = await createRouteHarness({ reserve });

    const response = await postJson(baseUrl, '/api/ai-task/video', {
      prompt: '生成视频',
      images: [],
    }, 'signed-in-user');

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: '积分不足，无法提交本次生成任务' });
    expect(tasks.size).toBe(0);
  });

  it('runs points admission before reading image references from disk', async () => {
    const reserve = vi.fn(() => {
      const error = new Error('Insufficient points');
      error.code = 'INSUFFICIENT_POINTS';
      throw error;
    });
    const resolveImageReferences = vi.fn(async images => images);
    const { baseUrl } = await createRouteHarness({ reserve, resolveImageReferences });

    const response = await postJson(baseUrl, '/api/ai-task/image', {
      prompt: '编辑已有图片',
      images: ['/uploads/existing.png'],
      imageProvider: 'gpt',
    }, 'signed-in-user');

    expect(response.status).toBe(402);
    expect(resolveImageReferences).not.toHaveBeenCalled();
  });

  it('replays an accepted media request without duplicating points, messages, or provider work', async () => {
    const resolveImageReferences = vi.fn(async images => images);
    const { baseUrl, data, tasks, pointsService } = await createRouteHarness({
      useRealStores: true,
      useMediaRequestService: true,
      resolveImageReferences,
    });
    const body = {
      prompt: '幂等生图',
      images: [],
      imageProvider: 'gpt',
      requestId: 'request-replay-1',
    };

    const firstResponse = await postJson(baseUrl, '/api/ai-task/image', body, 'signed-in-user');
    const first = await firstResponse.json();
    const replayResponse = await postJson(baseUrl, '/api/ai-task/image', body, 'signed-in-user');
    const replay = await replayResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(200);
    expect(replay.task.id).toBe(first.task.id);
    expect(replay.sessionId).toBe(first.sessionId);
    expect(tasks.size).toBe(1);
    expect(pointsService.reserve).toHaveBeenCalledTimes(1);
    expect(resolveImageReferences).toHaveBeenCalledTimes(1);
    expect(data.aiSessions['signed-in-user'][0].messages).toHaveLength(2);
    expect(Object.values(data.mediaRequests)[0]).toMatchObject({
      taskId: first.task.id,
      status: 'accepted',
    });
  });

  it('rejects a concurrent retry while its idempotency claim is still being prepared', async () => {
    const hydration = createDeferred();
    const resolveImageReferences = vi.fn(() => hydration.promise);
    const { baseUrl, data, pointsService, mediaRequestService } = await createRouteHarness({
      useRealStores: true,
      useMediaRequestService: true,
      resolveImageReferences,
    });
    const claimSpy = vi.spyOn(mediaRequestService, 'claim');
    const body = {
      prompt: '并发幂等生图',
      images: ['/uploads/existing.png'],
      imageProvider: 'gpt',
      requestId: 'request-concurrent-1',
    };

    const firstResponsePromise = postJson(baseUrl, '/api/ai-task/image', body, 'signed-in-user');
    await vi.waitFor(() => expect(resolveImageReferences).toHaveBeenCalledTimes(1));
    const concurrentResponsePromise = postJson(baseUrl, '/api/ai-task/image', body, 'signed-in-user');
    await vi.waitFor(() => expect(claimSpy).toHaveBeenCalledTimes(2));
    const recordsWhileClaimed = Object.values(data.mediaRequests);
    hydration.resolve(['data:image/png;base64,AA==']);
    const [firstResponse, concurrentResponse] = await Promise.all([
      firstResponsePromise,
      concurrentResponsePromise,
    ]);
    const concurrentResult = await concurrentResponse.json();

    expect(concurrentResponse.status).toBe(409);
    expect(concurrentResult).toEqual({ error: '该生成请求正在提交，请稍后重试' });
    expect(recordsWhileClaimed).toEqual([expect.objectContaining({ status: 'claimed' })]);
    expect(firstResponse.status).toBe(200);
    expect(pointsService.reserve).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of one media request id with a different payload', async () => {
    const { baseUrl, pointsService } = await createRouteHarness({
      useRealStores: true,
      useMediaRequestService: true,
    });

    const firstResponse = await postJson(baseUrl, '/api/ai-task/image', {
      prompt: '原始内容',
      imageProvider: 'gpt',
      requestId: 'request-conflict-1',
    }, 'signed-in-user');
    const conflictResponse = await postJson(baseUrl, '/api/ai-task/image', {
      prompt: '不同内容',
      imageProvider: 'gpt',
      requestId: 'request-conflict-1',
    }, 'signed-in-user');

    expect(firstResponse.status).toBe(200);
    expect(conflictResponse.status).toBe(409);
    expect(await conflictResponse.json()).toEqual({ error: '请求标识已用于不同的生成内容，请更换请求标识' });
    expect(pointsService.reserve).toHaveBeenCalledTimes(1);
  });

  it('aborts a failed media claim so the same request can be submitted again', async () => {
    const activationError = new Error('first activation failed');
    const registerTask = vi.fn()
      .mockImplementationOnce(() => { throw activationError; })
      .mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { baseUrl, data } = await createRouteHarness({
        useRealStores: true,
        useMediaRequestService: true,
        registerTask,
      });
      const body = {
        prompt: '失败后重试',
        imageProvider: 'gpt',
        requestId: 'request-abort-1',
      };

      const failedResponse = await postJson(baseUrl, '/api/ai-task/image', body, 'signed-in-user');
      expect(failedResponse.status).toBe(500);
      expect(Object.values(data.mediaRequests)[0]).toMatchObject({ status: 'aborted' });

      const retriedResponse = await postJson(baseUrl, '/api/ai-task/image', body, 'signed-in-user');
      expect(retriedResponse.status).toBe(200);
      expect(Object.values(data.mediaRequests)[0]).toMatchObject({ status: 'accepted' });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('replays a persisted terminal media result after the in-memory task is gone', async () => {
    const { baseUrl, data, tasks, mediaRequestService, sessionStore } = await createRouteHarness({
      useRealStores: true,
      useMediaRequestService: true,
    });
    const body = {
      prompt: '持久化结果',
      imageProvider: 'gpt',
      requestId: 'request-terminal-1',
    };
    const firstResponse = await postJson(baseUrl, '/api/ai-task/image', body, 'signed-in-user');
    const first = await firstResponse.json();
    const record = Object.values(data.mediaRequests)[0];
    sessionStore.patchAiMessage(
      { userId: 'signed-in-user' },
      first.sessionId,
      first.messageId,
      { content: '已生成图片。', images: ['/uploads/persisted.png'], status: 'sent' },
    );
    mediaRequestService.terminal(record.key, 'completed');
    tasks.delete(first.task.id);

    const replayResponse = await postJson(baseUrl, '/api/ai-task/image', body, 'signed-in-user');
    const replay = await replayResponse.json();

    expect(replayResponse.status).toBe(200);
    expect(replay).toMatchObject({
      sessionId: first.sessionId,
      messageId: first.messageId,
      task: {
        id: first.task.id,
        status: 'completed',
        partialImages: ['/uploads/persisted.png'],
      },
    });
  });

  it('keeps the video endpoint compatible when an older caller omits requestId', async () => {
    const { baseUrl, pointsService, data } = await createRouteHarness({
      useMediaRequestService: true,
    });

    const response = await postJson(baseUrl, '/api/ai-task/video', {
      prompt: '缺少请求标识',
      images: [],
    }, 'signed-in-user');

    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('task.type', 'video');
    expect(pointsService.reserve).toHaveBeenCalledTimes(1);
    const [requestRecord] = Object.values(data.mediaRequests);
    expect(requestRecord).toMatchObject({
      mediaType: 'video',
      status: 'accepted',
    });
    expect(requestRecord.requestId).toMatch(/^media_request-/);
  });

  it('accepts distinct first, last, and three subject-reference images', async () => {
    const { baseUrl, pointsService } = await createRouteHarness();
    const referenceImages = [
      'data:image/png;base64,AA==',
      'data:image/jpeg;base64,AQ==',
      'data:image/webp;base64,Ag==',
    ];
    const image = 'data:image/png;base64,Aw==';
    const lastFrame = 'data:image/jpeg;base64,BA==';

    const response = await postJson(baseUrl, '/api/ai-task/video', {
      prompt: '使用三张参考图生成视频',
      image,
      lastFrame,
      referenceImages,
    }, 'signed-in-user');

    expect(response.status).toBe(200);
    expect((await response.json()).task).toMatchObject({
      image,
      lastFrame,
      referenceImages,
      durationSeconds: 8,
    });
    expect(pointsService.reserve).toHaveBeenCalledTimes(1);
  });

  it('rejects a last frame without a first frame and more than three subject references', async () => {
    const { baseUrl, pointsService } = await createRouteHarness();
    const tailOnly = await postJson(baseUrl, '/api/ai-task/video', {
      prompt: '尾帧不能单独使用',
      lastFrame: 'data:image/png;base64,AA==',
      referenceImages: [],
    }, 'signed-in-user');
    expect(tailOnly.status).toBe(400);
    expect(await tailOnly.json()).toEqual({ error: '添加尾帧前请先添加首帧' });

    const excessReferences = await postJson(baseUrl, '/api/ai-task/video', {
      prompt: '参考图过多',
      referenceImages: Array.from({ length: 4 }, () => 'data:image/png;base64,AA=='),
    }, 'signed-in-user');
    expect(excessReferences.status).toBe(400);
    expect(await excessReferences.json()).toEqual({ error: '最多上传 3 张角色参考图' });
    expect(pointsService.reserve).not.toHaveBeenCalled();
  });

  it.each([
    ['one legacy image as the first frame', ['data:image/png;base64,AA=='], {
      image: 'data:image/png;base64,AA==', referenceImages: [],
    }],
    ['multiple legacy images as subject references', [
      'data:image/png;base64,AA==', 'data:image/jpeg;base64,AQ==',
    ], {
      image: '',
      referenceImages: ['data:image/png;base64,AA==', 'data:image/jpeg;base64,AQ=='],
    }],
  ])('maps %s for old clients', async (_label, images, expected) => {
    const { baseUrl } = await createRouteHarness();
    const response = await postJson(baseUrl, '/api/ai-task/video', {
      prompt: '旧客户端兼容', images,
    }, 'signed-in-user');

    expect(response.status).toBe(200);
    expect((await response.json()).task).toMatchObject({
      ...expected, lastFrame: '', durationSeconds: 8,
    });
  });

  it('rejects mixing legacy images with explicit video input fields', async () => {
    const { baseUrl } = await createRouteHarness();
    const response = await postJson(baseUrl, '/api/ai-task/video', {
      prompt: '字段不能混用',
      images: ['data:image/png;base64,AA=='],
      image: 'data:image/png;base64,AQ==',
    }, 'signed-in-user');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '旧版图片参数不能与首帧、尾帧或角色参考图同时使用' });
  });

  it('claims an image session before asynchronous reference reads so concurrent submissions conflict', async () => {
    const hydration = createDeferred();
    const resolveImageReferences = vi.fn(() => hydration.promise);
    const { baseUrl, pointsService } = await createRouteHarness({
      useRealStores: true,
      resolveImageReferences,
    });
    const sessionResponse = await postJson(baseUrl, '/api/ai-sessions', {}, 'signed-in-user');
    const { session } = await sessionResponse.json();

    const firstResponsePromise = postJson(baseUrl, '/api/ai-task/image', {
      sessionId: session.id,
      prompt: '第一个任务',
      images: ['/uploads/existing.png'],
      imageProvider: 'gpt',
    }, 'signed-in-user');
    await vi.waitFor(() => expect(resolveImageReferences).toHaveBeenCalledTimes(1));

    const secondResponse = await postJson(baseUrl, '/api/ai-task/image', {
      sessionId: session.id,
      prompt: '第二个任务',
      imageProvider: 'gpt',
    }, 'signed-in-user');

    expect(secondResponse.status).toBe(409);
    hydration.resolve(['data:image/png;base64,AA==']);
    const firstResponse = await firstResponsePromise;
    expect(firstResponse.status).toBe(200);
    expect(pointsService.reserve).toHaveBeenCalledTimes(1);
  });

  it('does not persist or activate a video job when pending-session persistence fails', async () => {
    const saveError = new Error('session persistence failed');
    const saveData = vi.fn(() => {
      throw saveError;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { baseUrl, data, tasks, pointsService } = await createRouteHarness({
        saveData,
        useRealStores: true,
      });

      const response = await postJson(baseUrl, '/api/ai-task/video', {
        prompt: '生成视频',
        images: [],
      }, 'signed-in-user');

      expect(response.status).toBe(500);
      expect(tasks.size).toBe(0);
      expect(data.aiSessions['signed-in-user'] || []).toEqual([]);
      expect(data.videoJobs).toEqual({});
      const reservation = pointsService.reserve.mock.calls[0]?.[0];
      expect(pointsService.settle).toHaveBeenCalledWith(reservation.taskId, false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('persists a complete image task session in one save while keeping data URLs task-local', async () => {
    const saveData = vi.fn();
    const { baseUrl, data, saveData: observedSaveData, tasks } = await createRouteHarness({
      saveData,
      useRealStores: true,
    });
    const inputImage = 'data:image/png;base64,AA==';

    const response = await postJson(baseUrl, '/api/ai-task/image', {
      prompt: '编辑图片',
      images: [inputImage],
      imageProvider: 'gpt',
    }, 'signed-in-user');
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(observedSaveData).toHaveBeenCalledTimes(1);
    expect(tasks.get(result.task.id)?.images).toEqual([inputImage]);
    const persistedSession = data.aiSessions['signed-in-user'][0];
    expect(persistedSession.pendingTaskId).toBe(result.task.id);
    expect(persistedSession.messages).toHaveLength(2);
    expect(persistedSession.messages[0].images).toBeUndefined();
  });

  it('compensates the task session when linking media points fails', async () => {
    const linkError = new Error('link persistence failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { baseUrl, data, tasks, pointsService } = await createRouteHarness({
        linkMediaTask: vi.fn(() => {
          throw linkError;
        }),
        useRealStores: true,
      });

      const response = await postJson(baseUrl, '/api/ai-task/image', {
        prompt: '生成图片',
        imageProvider: 'gpt',
      }, 'signed-in-user');

      expect(response.status).toBe(500);
      expect(tasks.size).toBe(0);
      expect(data.aiSessions['signed-in-user'] || []).toEqual([]);
      expect(data.videoJobs).toEqual({});
      const reservation = pointsService.reserve.mock.calls[0]?.[0];
      expect(pointsService.settle).toHaveBeenCalledWith(reservation.taskId, false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('removes the task session and partial video job when video-job persistence fails', async () => {
    const saveError = new Error('video job persistence failed');
    let saveAttempt = 0;
    const saveData = vi.fn(() => {
      saveAttempt += 1;
      if (saveAttempt === 2) {
        throw saveError;
      }
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { baseUrl, data, tasks, pointsService } = await createRouteHarness({
        saveData,
        useRealStores: true,
      });

      const response = await postJson(baseUrl, '/api/ai-task/video', {
        prompt: '生成视频',
        images: [],
      }, 'signed-in-user');

      expect(response.status).toBe(500);
      expect(tasks.size).toBe(0);
      expect(data.aiSessions['signed-in-user'] || []).toEqual([]);
      expect(data.videoJobs).toEqual({});
      const reservation = pointsService.reserve.mock.calls[0]?.[0];
      expect(pointsService.settle).toHaveBeenCalledWith(reservation.taskId, false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps video data URLs task-local while persisting a recoverable video job', async () => {
    const { baseUrl, data, tasks } = await createRouteHarness({ useRealStores: true });
    const image = 'data:image/png;base64,AA==';
    const referenceImages = ['data:image/jpeg;base64,AQ=='];

    const response = await postJson(baseUrl, '/api/ai-task/video', {
      prompt: '让图片动起来',
      image,
      referenceImages,
    }, 'signed-in-user');
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(tasks.get(result.task.id)).toMatchObject({ image, referenceImages });
    const persistedSession = data.aiSessions['signed-in-user'][0];
    expect(persistedSession.messages[0].images).toBeUndefined();
    expect(data.videoJobs[result.task.id]).toMatchObject({
      sessionId: result.sessionId,
      messageId: result.messageId,
      status: 'pending',
    });
  });

  it('cleans up the staged session and video job when task activation fails', async () => {
    const activationError = new Error('task activation failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { baseUrl, data, tasks, pointsService } = await createRouteHarness({
        registerTask: () => {
          throw activationError;
        },
        useRealStores: true,
      });

      const response = await postJson(baseUrl, '/api/ai-task/video', {
        prompt: '生成视频',
        images: [],
      }, 'signed-in-user');

      expect(response.status).toBe(500);
      expect([...tasks.values()]).toHaveLength(0);
      expect(data.aiSessions['signed-in-user'] || []).toEqual([]);
      expect(data.videoJobs).toEqual({});
      const reservation = pointsService.reserve.mock.calls[0]?.[0];
      expect(pointsService.settle).toHaveBeenCalledWith(reservation.taskId, false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps the legacy image endpoint compatible when requestId is omitted', async () => {
    let harness;
    const runAiTask = vi.fn(async taskId => finishHarnessImageTask(harness, taskId));
    harness = await createRouteHarness({
      runAiTask,
      useRealStores: true,
      useMediaRequestService: true,
    });

    const response = await postJson(harness.baseUrl, '/api/image-generation', {
      prompt: '兼容接口生图',
      imageProvider: 'gpt',
    }, 'signed-in-user');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      images: ['/uploads/generated.png'],
      mode: 'generate',
      model: 'gpt-image',
    });
    expect(harness.pointsService.reserve).toHaveBeenCalledTimes(1);
    expect(runAiTask).toHaveBeenCalledTimes(1);
    const [requestRecord] = Object.values(harness.data.mediaRequests);
    expect(requestRecord.requestId).toMatch(/^media_request-/);
  });

  it.each([
    ['body requestId', { requestId: 'legacy-body-id' }, {}],
    ['Idempotency-Key', {}, { 'Idempotency-Key': 'legacy-header-id' }],
    ['X-Request-Id', {}, { 'X-Request-Id': 'legacy-request-header-id' }],
  ])('waits for the shared image task and preserves the synchronous response for %s', async (_label, bodyPatch, headers) => {
    let harness;
    const runAiTask = vi.fn(async taskId => finishHarnessImageTask(harness, taskId));
    harness = await createRouteHarness({
      runAiTask,
      useRealStores: true,
      useMediaRequestService: true,
    });

    const response = await postJson(harness.baseUrl, '/api/image-generation', {
      prompt: '兼容接口生图',
      imageProvider: 'gpt',
      ...bodyPatch,
    }, 'signed-in-user', headers);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      images: ['/uploads/generated.png'],
      mode: 'generate',
      model: 'gpt-image',
    });
    expect(runAiTask).toHaveBeenCalledTimes(1);
    expect(harness.pointsService.reserve).toHaveBeenCalledTimes(1);
    expect(harness.pointsService.settle).toHaveBeenCalledWith(expect.any(String), true);
  });

  it('coalesces concurrent legacy retries into one task and one reservation', async () => {
    const started = createDeferred();
    const release = createDeferred();
    let harness;
    const runAiTask = vi.fn(async (taskId) => {
      started.resolve();
      await release.promise;
      finishHarnessImageTask(harness, taskId);
    });
    harness = await createRouteHarness({
      runAiTask,
      useRealStores: true,
      useMediaRequestService: true,
    });
    const body = {
      requestId: 'legacy-concurrent-id',
      prompt: '同一张图片只生成一次',
      imageProvider: 'gpt',
    };

    const firstResponsePromise = postJson(harness.baseUrl, '/api/image-generation', body, 'signed-in-user');
    await started.promise;
    const duplicateResponsePromise = postJson(harness.baseUrl, '/api/image-generation', body, 'signed-in-user');
    release.resolve();
    const [firstResponse, duplicateResponse] = await Promise.all([
      firstResponsePromise,
      duplicateResponsePromise,
    ]);

    expect(firstResponse.status).toBe(200);
    expect(duplicateResponse.status).toBe(200);
    expect(await firstResponse.json()).toEqual(await duplicateResponse.json());
    expect(runAiTask).toHaveBeenCalledTimes(1);
    expect(harness.pointsService.reserve).toHaveBeenCalledTimes(1);
    expect(harness.pointsService.settle).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight task between the asynchronous and legacy image endpoints', async () => {
    const started = createDeferred();
    const release = createDeferred();
    let harness;
    const runAiTask = vi.fn(async (taskId) => {
      started.resolve();
      await release.promise;
      finishHarnessImageTask(harness, taskId);
    });
    harness = await createRouteHarness({
      runAiTask,
      useRealStores: true,
      useMediaRequestService: true,
    });
    const body = {
      requestId: 'cross-endpoint-image-id',
      prompt: '跨接口重试只生成一次',
      imageProvider: 'gpt',
    };

    const acceptedResponse = await postJson(
      harness.baseUrl,
      '/api/ai-task/image',
      body,
      'signed-in-user',
    );
    expect(acceptedResponse.status).toBe(200);
    await started.promise;
    const legacyResponsePromise = postJson(
      harness.baseUrl,
      '/api/image-generation',
      body,
      'signed-in-user',
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    const callsWhileBlocked = runAiTask.mock.calls.length;
    release.resolve();
    const legacyResponse = await legacyResponsePromise;

    expect(legacyResponse.status).toBe(200);
    expect(callsWhileBlocked).toBe(1);
    expect(runAiTask).toHaveBeenCalledTimes(1);
    expect(harness.pointsService.reserve).toHaveBeenCalledTimes(1);
    expect(harness.pointsService.settle).toHaveBeenCalledTimes(1);
  });

  it('replays a completed legacy image from persisted session data after task eviction', async () => {
    let harness;
    const runAiTask = vi.fn(async taskId => finishHarnessImageTask(harness, taskId, {
      images: ['/uploads/persisted.png'],
    }));
    harness = await createRouteHarness({
      runAiTask,
      useRealStores: true,
      useMediaRequestService: true,
    });
    const body = {
      requestId: 'legacy-replay-id',
      prompt: '持久化重放',
      imageProvider: 'grok',
    };

    const firstResponse = await postJson(harness.baseUrl, '/api/image-generation', body, 'signed-in-user');
    const [taskId] = harness.tasks.keys();
    harness.tasks.delete(taskId);
    const replayResponse = await postJson(harness.baseUrl, '/api/image-generation', body, 'signed-in-user');

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toEqual({
      images: ['/uploads/persisted.png'],
      mode: 'generate',
      model: 'grok-image',
    });
    expect(runAiTask).toHaveBeenCalledTimes(1);
    expect(harness.pointsService.reserve).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of a legacy request id with a different payload', async () => {
    let harness;
    const runAiTask = vi.fn(async taskId => finishHarnessImageTask(harness, taskId));
    harness = await createRouteHarness({
      runAiTask,
      useRealStores: true,
      useMediaRequestService: true,
    });

    await postJson(harness.baseUrl, '/api/image-generation', {
      requestId: 'legacy-conflict-id',
      prompt: '第一张图',
      imageProvider: 'gpt',
    }, 'signed-in-user');
    const conflictResponse = await postJson(harness.baseUrl, '/api/image-generation', {
      requestId: 'legacy-conflict-id',
      prompt: '不同的第二张图',
      imageProvider: 'gpt',
    }, 'signed-in-user');

    expect(conflictResponse.status).toBe(409);
    expect(harness.pointsService.reserve).toHaveBeenCalledTimes(1);
    expect(runAiTask).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['gpt', 2],
    ['grok', 1],
  ])('charges the %s image cost through the shared task transaction', async (provider, costUnits) => {
    let harness;
    const runAiTask = vi.fn(async taskId => finishHarnessImageTask(harness, taskId));
    harness = await createRouteHarness({
      runAiTask,
      useRealStores: true,
      useMediaRequestService: true,
    });

    const response = await postJson(harness.baseUrl, '/api/image-generation', {
      requestId: `legacy-cost-${provider}`,
      prompt: '兼容接口生图',
      imageProvider: provider,
    }, 'signed-in-user');

    expect(response.status).toBe(200);
    expect(harness.pointsService.reserve).toHaveBeenCalledWith({
      taskId: expect.any(String),
      userId: 'signed-in-user',
      costUnits,
      taskType: 'image',
    });
    expect(harness.pointsService.settle).toHaveBeenCalledWith(expect.any(String), true);
    expect(harness.pointsService.settle).toHaveBeenCalledTimes(1);
  });

  it('returns Chinese validation errors from the legacy image endpoint', async () => {
    const { baseUrl } = await createRouteHarness();

    const response = await postJson(baseUrl, '/api/image-generation', {
      requestId: 'legacy-validation-id',
      prompt: '   ',
      imageProvider: 'gpt',
    }, 'signed-in-user');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '图片描述不能为空' });
  });

  it('rejects more than eight legacy image references before billing or upstream work', async () => {
    const upstreamFetch = vi.fn();
    const { baseUrl, pointsService } = await createRouteHarness({ upstreamFetch });

    const response = await postJson(baseUrl, '/api/image-generation', {
      requestId: 'legacy-too-many-images-id',
      prompt: '编辑多张图片',
      images: Array.from({ length: 9 }, (_, index) => `data:image/png;base64,${index}A==`),
      imageProvider: 'gpt',
    }, 'signed-in-user');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '最多只能使用 8 张参考图' });
    expect(pointsService.reserve).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('does not expose an English provider validation error', async () => {
    const { baseUrl } = await createRouteHarness({
      resolveImageProvider: () => {
        throw new Error('Unknown image provider');
      },
    });

    const response = await postJson(baseUrl, '/api/ai-task/image', {
      prompt: '生成一张图片',
      imageProvider: 'unknown',
    }, 'signed-in-user');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '不支持的图片生成模型' });
  });

  it('does not expose an English image-reference validation error', async () => {
    const { baseUrl } = await createRouteHarness({
      resolveImageReferences: vi.fn().mockRejectedValue(new Error('ENOENT /secret/path')),
    });

    const response = await postJson(baseUrl, '/api/ai-task/image', {
      prompt: '编辑这张图片',
      images: ['data:image/png;base64,AA=='],
      imageProvider: 'gpt',
    }, 'signed-in-user');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '图片引用不可用，请重新上传图片' });
  });

  it('returns a Chinese error when the selected legacy image provider is not configured', async () => {
    const { baseUrl } = await createRouteHarness({
      defaultImageApiKey: '',
      defaultChatApiKey: '',
      resolveImageProvider: provider => ({
        id: provider === 'grok' ? 'grok' : 'gpt',
        label: provider === 'grok' ? 'Grok' : 'GPT',
        model: 'image-model',
        apiKey: '',
      }),
    });

    const response = await postJson(baseUrl, '/api/image-generation', {
      requestId: 'legacy-unconfigured-id',
      prompt: '生成一张图片',
      imageProvider: 'gpt',
    }, 'signed-in-user');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'GPT 图片模型尚未配置' });
  });

  it('catches a rejected background AI task promise', async () => {
    const backgroundError = new Error('background task failed');
    const runAiTask = vi.fn().mockRejectedValue(backgroundError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { baseUrl, tasks, cancelAiTask } = await createRouteHarness({ runAiTask });

      const response = await postJson(baseUrl, '/api/ai-task/image', {
        prompt: '生成一张图片',
        imageProvider: 'gpt',
      }, 'signed-in-user');

      expect(response.status).toBe(200);
      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('Background AI task'),
          backgroundError,
        );
      });
      const [task] = tasks.values();
      expect(task.status).toBe('cancelled');
      expect(cancelAiTask).toHaveBeenCalledWith(task.id);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('releases legacy image points and returns a Chinese task error', async () => {
    let harness;
    const runAiTask = vi.fn(async taskId => finishHarnessImageTask(harness, taskId, {
      status: 'failed',
      error: '图片内容可能不符合安全规范，请调整描述后重试。',
    }));
    harness = await createRouteHarness({
      runAiTask,
      useRealStores: true,
      useMediaRequestService: true,
    });

    const response = await postJson(harness.baseUrl, '/api/image-generation', {
      requestId: 'legacy-failure-id',
      prompt: '兼容接口生图',
    }, 'signed-in-user');
    const result = await response.json();

    expect(response.status).toBe(502);
    expect(result.error).toBe('图片内容可能不符合安全规范，请调整描述后重试。');
    expect(result.error).not.toMatch(/unsafe|generated images/iu);
    expect(harness.pointsService.settle).toHaveBeenCalledWith(expect.any(String), false);
    expect(harness.pointsService.settle).toHaveBeenCalledTimes(1);
  });

  it('returns 401 for an unauthenticated protected task and 404 for another account', async () => {
    const { baseUrl } = await createRouteHarness();
    const createdResponse = await postJson(baseUrl, '/api/ai-task/image', {
      prompt: '私有图片任务',
      imageProvider: 'gpt',
    }, 'owner-a');
    const created = await createdResponse.json();

    const unauthenticatedQuery = await getJson(baseUrl, `/api/ai-task/${created.task.id}`);
    const unauthenticatedCancel = await postJson(baseUrl, `/api/ai-task/${created.task.id}/cancel`, {});
    const otherAccountQuery = await getJson(baseUrl, `/api/ai-task/${created.task.id}`, 'owner-b');

    expect(unauthenticatedQuery.status).toBe(401);
    expect(unauthenticatedCancel.status).toBe(401);
    expect(otherAccountQuery.status).toBe(404);
  });
});
