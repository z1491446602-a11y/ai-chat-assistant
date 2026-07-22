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

  const resolveAiOwnerFromInput = vi.fn(({ userId, guestId } = {}) => {
    if (userId) {
      return {
        ownerRef: { userId },
        ownerId: userId,
        ownerType: 'user',
      };
    }
    return {
      ownerRef: { guestId },
      ownerId: guestId,
      ownerType: 'guest',
    };
  });
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

function post(baseUrl, path, headers = {}, body = { prompt: '' }) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('AI media availability', () => {
  it.each([
    ['/api/ai-task/image', '图片'],
    ['/api/ai-task/video', '视频'],
    ['/api/image-generation', '图片'],
  ])('allows an unauthenticated guest to reach %s validation', async (path) => {
    const { baseUrl } = await startApp();
    const response = await post(baseUrl, path, {}, { prompt: '', guestId: 'guest-1' });
    expect(response.status).toBe(400);
  });

  it('falls back to an IP-scoped guest owner when no owner is provided', async () => {
    const { baseUrl } = await startApp();
    expect((await post(baseUrl, '/api/ai-task/image')).status).toBe(400);
  });
});
