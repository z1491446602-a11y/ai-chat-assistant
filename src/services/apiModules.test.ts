import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as api from './api';
import {
  cancelServerAiTask,
  clearServerAiSessions,
  createClientRequestId,
  createServerAiChatTask,
  createServerAiImageTask,
  createServerAiSession,
  createServerAiVideoTask,
  deleteServerAiSession,
  fetchServerAiSessions,
  fetchServerAiTask,
  transcribeAiCallAudio,
} from './aiTasksApi';
import type {
  AiTaskOwner,
  ImageGenerationProvider,
  ServerAiTask,
} from './aiTasksApi';
import { subscribeToSessionExpired } from './http';
import type {
  AiTaskOwner as BarrelAiTaskOwner,
  ImageGenerationProvider as BarrelImageGenerationProvider,
  ServerAiTask as BarrelServerAiTask,
} from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fetchMock() {
  return vi.mocked(fetch);
}

function queueJsonResponse(body: unknown, status = 200): void {
  fetchMock().mockResolvedValueOnce(jsonResponse(body, status));
}

function queueNonJsonResponse(body: string | null, status = 502): void {
  fetchMock().mockResolvedValueOnce(new Response(body, {
    status,
    headers: body === null ? undefined : { 'Content-Type': 'text/html' },
  }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const INVALID_AI_TASK_OWNER_ERROR =
  'Invalid AI task owner: provide exactly one non-empty userId or guestId';

const invalidAiTaskOwners: ReadonlyArray<readonly [string, string | AiTaskOwner]> = [
  [
    'both userId and guestId',
    { userId: 'user-1', guestId: 'guest-1' } as unknown as AiTaskOwner,
  ],
  ['no owner ID', {} as unknown as AiTaskOwner],
  ['an empty userId', { userId: '' } as AiTaskOwner],
  ['a blank guestId', { guestId: '   ' } as AiTaskOwner],
  ['a blank legacy string', '   '],
];

const aiTaskOwnerRequestCases: ReadonlyArray<
  readonly [string, (owner: string | AiTaskOwner) => Promise<unknown>]
> = [
  ['fetch sessions', owner => fetchServerAiSessions(owner)],
  ['create session', owner => createServerAiSession(owner)],
  ['delete session', owner => deleteServerAiSession(owner, 'session-1')],
  ['clear sessions', owner => clearServerAiSessions(owner)],
  [
    'create chat task',
    owner => createServerAiChatTask(owner, null, 'hello', [], [], {
      endpoint: '/api/chat',
      apiKey: 'key',
      model: 'model',
      temperature: 0.7,
      maxTokens: 1024,
      topP: 1,
    }),
  ],
  ['create image task', owner => createServerAiImageTask(owner, null, 'draw', [], 'gpt', 'request-1')],
  ['create video task', owner => createServerAiVideoTask(owner, null, 'animate', [], 'request-1')],
  ['fetch task', owner => fetchServerAiTask('task-1', owner)],
  ['cancel task', owner => cancelServerAiTask('task-1', owner)],
];

describe('AI task owner contract', () => {
  it('exposes a strict XOR owner object type', () => {
    expectTypeOf<AiTaskOwner>().toEqualTypeOf<
      | { userId: string; guestId?: never }
      | { userId?: never; guestId: string }
    >();
  });

  it('trims legacy string and object IDs before serializing path, query, and body', async () => {
    const session = {
      id: 'session-1',
      title: 'session',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    };
    const task = {
      id: 'task-1',
      userId: 'guest/id',
      sessionId: 'session-1',
      messageId: 'message-1',
      type: 'chat' as const,
      status: 'pending' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    queueJsonResponse({ sessions: [session] });
    queueJsonResponse({ task });
    queueJsonResponse({ session });

    await expect(fetchServerAiSessions('  user id  ')).resolves.toEqual([session]);
    await expect(fetchServerAiTask('task/id', { guestId: '  guest/id  ' })).resolves.toEqual(task);
    await expect(createServerAiSession({ userId: '  user id  ' }, 'model')).resolves.toEqual(session);

    expect(fetchMock()).toHaveBeenNthCalledWith(1, '/api/ai-sessions/user%20id');
    expect(fetchMock()).toHaveBeenNthCalledWith(2, '/api/ai-task/task%2Fid?guestId=guest%2Fid');
    expect(fetchMock()).toHaveBeenNthCalledWith(3, '/api/ai-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user id', model: 'model' }),
    });
  });

  describe.each(aiTaskOwnerRequestCases)('%s owner validation', (_apiName, request) => {
    it.each(invalidAiTaskOwners)('rejects %s before fetch', async (_ownerCase, owner) => {
      await expect(request(owner)).rejects.toThrow(INVALID_AI_TASK_OWNER_ERROR);
      expect(fetchMock()).not.toHaveBeenCalled();
    });
  });
});

describe('AI sessions API module', () => {
  const session = {
    id: 'session-1',
    title: '会话',
    messages: [],
    createdAt: 1,
    updatedAt: 2,
  };

  it('keeps user and guest session owner paths and queries unchanged', async () => {
    queueJsonResponse({ sessions: [session] });
    queueJsonResponse({ sessions: [] });

    await expect(fetchServerAiSessions({ userId: 'user id' })).resolves.toEqual([session]);
    await expect(fetchServerAiSessions({ guestId: 'guest/id' })).resolves.toEqual([]);

    expect(fetchMock()).toHaveBeenNthCalledWith(1, '/api/ai-sessions/user%20id');
    expect(fetchMock()).toHaveBeenNthCalledWith(2, '/api/ai-sessions/guest%2Fid?ownerType=guest');
  });

  it('keeps create, delete, and clear session requests unchanged', async () => {
    queueJsonResponse({ session });
    queueJsonResponse({ ok: true });
    queueJsonResponse({ deletedCount: '3' });

    await expect(createServerAiSession({ guestId: 'guest/id' }, 'deepseek-v4')).resolves.toEqual(session);
    await deleteServerAiSession({ userId: 'user id' }, 'session/id');
    await expect(clearServerAiSessions({ guestId: 'guest/id' })).resolves.toBe(3);

    expect(fetchMock()).toHaveBeenNthCalledWith(1, '/api/ai-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestId: 'guest/id', model: 'deepseek-v4' }),
    });
    expect(fetchMock()).toHaveBeenNthCalledWith(
      2,
      '/api/ai-sessions/user%20id/session%2Fid',
      { method: 'DELETE' },
    );
    expect(fetchMock()).toHaveBeenNthCalledWith(
      3,
      '/api/ai-sessions/guest%2Fid?ownerType=guest',
      { method: 'DELETE' },
    );
  });
});

describe('AI task API module', () => {
  const task = {
    id: 'task-1',
    userId: 'user-1',
    sessionId: 'session-1',
    messageId: 'message-1',
    type: 'chat' as const,
    status: 'pending' as const,
    createdAt: 1,
    updatedAt: 1,
  };
  const taskResult = { task, sessionId: 'session-1', messageId: 'message-1' };

  it('uses crypto.randomUUID for a new client request ID when available', () => {
    const randomUUID = vi.fn(() => '018f9f36-659a-7c92-bca1-8f2cc4b747f0');
    const getRandomValues = vi.fn();
    vi.stubGlobal('crypto', { randomUUID, getRandomValues });

    expect(createClientRequestId()).toBe('018f9f36-659a-7c92-bca1-8f2cc4b747f0');
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('uses getRandomValues for a secure UUID fallback', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.forEach((_, index) => {
        bytes[index] = index;
      });
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    expect(createClientRequestId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: 'image',
      path: '/api/ai-task/image',
      request: () => Reflect.apply(createServerAiImageTask, undefined, [
        { userId: 'user-1' },
        'session-1',
        'draw',
        [],
        'gpt',
      ]),
    },
    {
      name: 'video',
      path: '/api/ai-task/video',
      request: () => Reflect.apply(createServerAiVideoTask, undefined, [
        { userId: 'user-1' },
        'session-1',
        'animate',
        [],
      ]),
    },
  ])('generates one stable requestId for an older $name helper call', async ({ path, request }) => {
    const randomUUID = vi.fn(() => 'compatibility-request-id');
    vi.stubGlobal('crypto', { randomUUID });
    queueJsonResponse(taskResult);

    await expect(request()).resolves.toEqual(taskResult);

    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    const [requestPath, requestInit] = fetchMock().mock.calls[0];
    expect(requestPath).toBe(path);
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      requestId: 'compatibility-request-id',
    });
  });

  it.each([
    ['the secure random API is unavailable', {}],
    ['randomUUID throws', { randomUUID: () => { throw new Error('crypto provider failed'); } }],
    ['getRandomValues throws', { getRandomValues: () => { throw new Error('crypto provider failed'); } }],
  ])('localizes request ID generation failure when %s', (_case, cryptoApi) => {
    vi.stubGlobal('crypto', cryptoApi);

    expect(() => createClientRequestId())
      .toThrow('无法生成安全请求标识，请刷新页面后重试');
  });

  it('keeps the chat task path and complete request body unchanged', async () => {
    queueJsonResponse(taskResult);
    const files = [{ fileName: 'note.txt', fileUrl: '/files/note.txt', fileSize: 4, mimeType: 'text/plain' }];
    const config = {
      endpoint: '/api/chat',
      apiKey: 'key',
      model: 'deepseek-v4',
      temperature: 0.6,
      maxTokens: 4096,
      topP: 0.9,
    };

    await expect(
      createServerAiChatTask(
        { userId: 'user-1' },
        'session-1',
        'hello',
        ['data:image/png;base64,x'],
        files,
        config,
      ),
    ).resolves.toEqual(taskResult);
    expect(fetchMock()).toHaveBeenCalledWith('/api/ai-task/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-1',
        sessionId: 'session-1',
        content: 'hello',
        images: ['data:image/png;base64,x'],
        files,
        apiKey: 'key',
        model: 'deepseek-v4',
        temperature: 0.6,
        maxTokens: 4096,
        topP: 0.9,
      }),
    });
  });

  it('does not retry an ordinary chat POST and localizes its network failure', async () => {
    fetchMock().mockRejectedValue(new TypeError('fetch failed'));

    await expect(createServerAiChatTask(
      { guestId: 'guest-1' },
      'session-1',
      'hello',
      [],
      [],
      {
        endpoint: '/api/chat',
        apiKey: '',
        model: 'deepseek-v4',
        temperature: 0.7,
        maxTokens: 2048,
        topP: 1,
      },
    )).rejects.toThrow('聊天请求失败，请检查网络后重试');
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('keeps a structured server business error for an ordinary chat request', async () => {
    queueJsonResponse({ error: '模型服务额度不足' }, 429);

    await expect(createServerAiChatTask(
      { userId: 'user-1' },
      'session-1',
      'hello',
      [],
      [],
      {
        endpoint: '/api/chat',
        apiKey: '',
        model: 'deepseek-v4',
        temperature: 0.7,
        maxTokens: 2048,
        topP: 1,
      },
    )).rejects.toThrow('模型服务额度不足');
  });

  it('keeps the video task path and body unchanged', async () => {
    queueJsonResponse(taskResult);

    await expect(
      createServerAiVideoTask(
        { guestId: 'guest-1' },
        undefined,
        'animate',
        ['image-1'],
        'request-video-1',
      ),
    ).resolves.toEqual(taskResult);
    expect(fetchMock()).toHaveBeenCalledWith('/api/ai-task/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestId: 'guest-1',
        sessionId: undefined,
        prompt: 'animate',
        images: ['image-1'],
        requestId: 'request-video-1',
      }),
    });
  });

  it.each([
    {
      name: 'image',
      request: (requestId: string) => createServerAiImageTask(
        { userId: 'user-1' },
        'session-1',
        'draw',
        [],
        'gpt',
        requestId,
      ),
    },
    {
      name: 'video',
      request: (requestId: string) => createServerAiVideoTask(
        { userId: 'user-1' },
        'session-1',
        'animate',
        [],
        requestId,
      ),
    },
  ])('retries one $name network failure with the same requestId and request body', async ({ request }) => {
    fetchMock()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(taskResult));

    await expect(request('request-network-retry')).resolves.toEqual(taskResult);

    expect(fetchMock()).toHaveBeenCalledTimes(2);
    const firstRequest = fetchMock().mock.calls[0];
    const secondRequest = fetchMock().mock.calls[1];
    expect(secondRequest).toEqual(firstRequest);
    const body = JSON.parse(String(firstRequest?.[1]?.body));
    expect(body.requestId).toBe('request-network-retry');
  });

  it.each([
    {
      name: 'image',
      fallback: '图片请求失败，请稍后重试',
      request: () => createServerAiImageTask(
        { userId: 'user-1' },
        'session-1',
        'draw',
        [],
        'gpt',
        'request-image-failure',
      ),
    },
    {
      name: 'video',
      fallback: '视频请求失败，请稍后重试',
      request: () => createServerAiVideoTask(
        { userId: 'user-1' },
        'session-1',
        'animate',
        [],
        'request-video-failure',
      ),
    },
  ])('stops after two $name network attempts', async ({ fallback, request }) => {
    fetchMock().mockRejectedValue(new TypeError('fetch failed'));

    await expect(request()).rejects.toThrow(fallback);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: 'image',
      request: () => createServerAiImageTask(
        { userId: 'user-1' },
        'session-1',
        'draw',
        [],
        'gpt',
        'request-image-http',
      ),
    },
    {
      name: 'video',
      request: () => createServerAiVideoTask(
        { userId: 'user-1' },
        'session-1',
        'animate',
        [],
        'request-video-http',
      ),
    },
  ])('does not retry a $name HTTP error response', async ({ request }) => {
    fetchMock().mockResolvedValue(jsonResponse({ error: '服务暂时不可用' }, 503));

    await expect(request()).rejects.toThrow('服务暂时不可用');
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: 'image',
      request: () => createServerAiImageTask(
        { userId: 'user-1' },
        'session-1',
        'draw',
        [],
        'gpt',
        '   ',
      ),
    },
    {
      name: 'video',
      request: () => createServerAiVideoTask(
        { userId: 'user-1' },
        'session-1',
        'animate',
        [],
        '',
      ),
    },
  ])('rejects a blank $name requestId before fetch', async ({ request }) => {
    await expect(request()).rejects.toThrow('Invalid media requestId');
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('keeps task owner queries, cancel method, and transcription body unchanged', async () => {
    queueJsonResponse({ task });
    queueJsonResponse({ task });
    queueJsonResponse({ text: '  识别文本  ' });

    await expect(fetchServerAiTask('task/id', { guestId: 'guest/id' })).resolves.toEqual(task);
    await expect(cancelServerAiTask('task/id', { userId: 'user id' })).resolves.toEqual(task);
    await expect(transcribeAiCallAudio('base64-audio')).resolves.toBe('识别文本');

    expect(fetchMock()).toHaveBeenNthCalledWith(1, '/api/ai-task/task%2Fid?guestId=guest%2Fid');
    expect(fetchMock()).toHaveBeenNthCalledWith(
      2,
      '/api/ai-task/task%2Fid/cancel?userId=user+id',
      { method: 'POST' },
    );
    expect(fetchMock()).toHaveBeenNthCalledWith(3, '/api/voice/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioData: 'base64-audio', mimeType: 'audio/wav' }),
    });
  });
});

describe('AI API non-JSON errors', () => {
  const config = {
    endpoint: '/api/chat',
    apiKey: 'key',
    model: 'deepseek-v4',
    temperature: 0.7,
    maxTokens: 2048,
    topP: 1,
  };

  it.each([
    {
      name: 'fetch sessions',
      body: '<html>bad gateway</html>',
      fallback: '加载 AI 历史失败',
      request: () => fetchServerAiSessions('user-1'),
    },
    {
      name: 'create session',
      body: null,
      fallback: '创建 AI 会话失败',
      request: () => createServerAiSession('user-1'),
    },
    {
      name: 'delete session',
      body: '<html>bad gateway</html>',
      fallback: '删除聊天记录失败',
      request: () => deleteServerAiSession('user-1', 'session-1'),
    },
    {
      name: 'clear sessions',
      body: null,
      fallback: '清空聊天记录失败',
      request: () => clearServerAiSessions('user-1'),
    },
    {
      name: 'create chat task',
      body: '<html>bad gateway</html>',
      fallback: '提交 AI 任务失败',
      request: () => createServerAiChatTask('user-1', null, 'hello', [], [], config),
    },
    {
      name: 'create image task',
      body: null,
      fallback: '提交图片生成任务失败',
      request: () => createServerAiImageTask('user-1', null, 'draw', [], 'gpt', 'request-image-error'),
    },
    {
      name: 'create video task',
      body: '<html>bad gateway</html>',
      fallback: '提交视频生成任务失败',
      request: () => createServerAiVideoTask('user-1', null, 'animate', [], 'request-video-error'),
    },
    {
      name: 'fetch task',
      body: null,
      fallback: '加载任务状态失败',
      request: () => fetchServerAiTask('task-1', 'user-1'),
    },
    {
      name: 'cancel task',
      body: '<html>bad gateway</html>',
      fallback: '停止任务失败',
      request: () => cancelServerAiTask('task-1', 'user-1'),
    },
  ])('uses the localized fallback when $name returns HTML or an empty body', async ({
    body,
    fallback,
    request,
  }) => {
    queueNonJsonResponse(body);

    await expect(request()).rejects.toThrow(fallback);
  });

  it('continues to surface a structured server error', async () => {
    queueJsonResponse({ error: '服务端详细错误' }, 500);

    await expect(fetchServerAiTask('task-1', 'user-1')).rejects.toThrow('服务端详细错误');
  });

  it('reports a 401 through the shared session-expiry channel', async () => {
    const onSessionExpired = vi.fn();
    const unsubscribe = subscribeToSessionExpired(onSessionExpired);
    queueJsonResponse({ error: '登录已过期' }, 401);

    await expect(fetchServerAiTask('task-1', 'user-1')).rejects.toMatchObject({
      message: '登录已过期',
      status: 401,
    });

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('AI API network errors', () => {
  const config = {
    endpoint: '/api/chat',
    apiKey: 'key',
    model: 'deepseek-v4',
    temperature: 0.7,
    maxTokens: 2048,
    topP: 1,
  };

  it.each([
    ['fetch sessions', '加载 AI 历史失败，请检查网络后重试', () => fetchServerAiSessions('user-1')],
    ['create session', '创建 AI 会话失败，请检查网络后重试', () => createServerAiSession('user-1')],
    ['delete session', '删除聊天记录失败，请检查网络后重试', () => deleteServerAiSession('user-1', 'session-1')],
    ['clear sessions', '清空聊天记录失败，请检查网络后重试', () => clearServerAiSessions('user-1')],
    ['create chat task', '聊天请求失败，请检查网络后重试', () => createServerAiChatTask('user-1', null, 'hello', [], [], config)],
    ['fetch task', '加载任务状态失败，请检查网络后重试', () => fetchServerAiTask('task-1', 'user-1')],
    ['cancel task', '停止任务失败，请检查网络后重试', () => cancelServerAiTask('task-1', 'user-1')],
    ['transcribe audio', '语音转文字失败，请检查网络后重试', () => transcribeAiCallAudio('base64-audio')],
  ])('localizes a $s network failure', async (_name, fallback, request) => {
    fetchMock().mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(request()).rejects.toThrow(fallback);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });
});

describe('compatibility barrel', () => {
  it('reexports every active runtime API from the focused modules', () => {
    expect(api.fetchServerAiSessions).toBe(fetchServerAiSessions);
    expect(api.createServerAiSession).toBe(createServerAiSession);
    expect(api.deleteServerAiSession).toBe(deleteServerAiSession);
    expect(api.clearServerAiSessions).toBe(clearServerAiSessions);
    expect(api.createServerAiChatTask).toBe(createServerAiChatTask);
    expect(api.createServerAiImageTask).toBe(createServerAiImageTask);
    expect(api.createServerAiVideoTask).toBe(createServerAiVideoTask);
    expect(api.fetchServerAiTask).toBe(fetchServerAiTask);
    expect(api.cancelServerAiTask).toBe(cancelServerAiTask);
    expect(api.transcribeAiCallAudio).toBe(transcribeAiCallAudio);
  });

  it('reexports the active public types', () => {
    expectTypeOf<BarrelAiTaskOwner>().toEqualTypeOf<AiTaskOwner>();
    expectTypeOf<BarrelImageGenerationProvider>().toEqualTypeOf<ImageGenerationProvider>();
    expectTypeOf<BarrelServerAiTask>().toEqualTypeOf<ServerAiTask>();
  });
});
