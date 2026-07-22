import { createServer } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAiRoutes } from '../../server/aiRoutes.js';

const openServers = new Set();

afterEach(async () => {
  await Promise.all([...openServers].map(server => new Promise(resolve => server.close(resolve))));
  openServers.clear();
});

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.get('x-test-role');
    if (role) {
      req.authUser = {
        id: 'account-1',
        role,
        mediaPermissions: {
          imageGeneration: req.get('x-test-image') === 'true',
          videoGeneration: req.get('x-test-video') === 'true',
        },
      };
    }
    next();
  });

  const resolveAiOwnerFromInput = vi.fn(() => ({
    ownerRef: { userId: 'account-1' },
    ownerId: 'account-1',
    ownerType: 'user',
  }));
  registerAiRoutes(app, {
    resolveAiOwnerFromInput,
    resolveImageProvider: vi.fn(() => ({ id: 'gpt', apiKey: 'configured' })),
    resolveImageReferences: vi.fn(async value => value),
    getAiSessions: vi.fn(() => []),
    findAiSession: vi.fn(() => null),
    createAiSession: vi.fn(),
    upsertAiSession: vi.fn(),
    appendAiMessage: vi.fn(),
    removeAiSession: vi.fn(),
    removeAllAiSessions: vi.fn(),
    getAiTask: vi.fn(),
    registerAiTask: vi.fn(),
    serializeAiTask: value => value,
    runAiTask: vi.fn(),
    cancelAiTask: vi.fn(),
    saveUploadedFile: vi.fn(),
    videoJobStore: { createVideoJob: vi.fn() },
    generateEntityId: prefix => `${prefix}-1`,
    normalizeChatModel: value => value,
    resolveChatProvider: vi.fn(),
    buildResponsesInput: vi.fn(),
    buildResponsesInstructions: vi.fn(),
    buildChatCompletionsMessages: vi.fn(),
    buildChatCompletionsPayload: vi.fn(),
    streamResponse: vi.fn(),
    appendOptionalImageSize: value => value,
    buildCompatibleImagePrompt: value => value,
    resolveGeneratedImages: vi.fn(),
    DEFAULT_CHAT_API_KEY: 'configured',
    DEFAULT_CHAT_MODEL: 'chat-model',
    DEFAULT_IMAGE_API_URL: 'https://images.invalid',
    DEFAULT_IMAGE_API_KEY: 'configured',
    DEFAULT_IMAGE_MODEL: 'image-model',
    VIDEO_API_MODEL: 'seedance_1_5_pro_720p',
    isKittyVoiceModel: () => false,
  });

  const server = createServer(app);
  openServers.add(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { baseUrl: `http://127.0.0.1:${address.port}`, resolveAiOwnerFromInput };
}

function post(baseUrl, path, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ prompt: '' }),
  });
}

describe('AI media account permissions', () => {
  it.each([
    ['/api/ai-task/image', '图片'],
    ['/api/ai-task/video', '视频'],
    ['/api/image-generation', '图片'],
  ])('requires login for %s', async (path) => {
    const { baseUrl } = await startApp();
    const response = await post(baseUrl, path);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: '请先登录后再使用图片或视频生成功能' });
  });

  it('blocks an ordinary account without image or video authorization', async () => {
    const { baseUrl, resolveAiOwnerFromInput } = await startApp();
    const headers = { 'x-test-role': 'user' };
    const image = await post(baseUrl, '/api/ai-task/image', headers);
    const video = await post(baseUrl, '/api/ai-task/video', headers);
    expect(image.status).toBe(403);
    expect(await image.json()).toEqual({ error: '该账号尚未获得图片生成功能授权，请联系管理员' });
    expect(video.status).toBe(403);
    expect(await video.json()).toEqual({ error: '该账号尚未获得视频生成功能授权，请联系管理员' });
    expect(resolveAiOwnerFromInput).not.toHaveBeenCalled();
  });

  it('allows image-only authorization without allowing video', async () => {
    const { baseUrl } = await startApp();
    const headers = { 'x-test-role': 'user', 'x-test-image': 'true' };
    const image = await post(baseUrl, '/api/ai-task/image', headers);
    const video = await post(baseUrl, '/api/ai-task/video', headers);
    expect(image.status).toBe(400);
    expect(video.status).toBe(403);
  });

  it('lets administrators pass both media permission gates', async () => {
    const { baseUrl } = await startApp();
    const headers = { 'x-test-role': 'admin' };
    expect((await post(baseUrl, '/api/ai-task/image', headers)).status).toBe(400);
    expect((await post(baseUrl, '/api/ai-task/video', headers)).status).toBe(400);
  });
});
