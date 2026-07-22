import { describe, expect, it, vi } from 'vitest';
import { createAiTaskStore } from '../../server/aiTasks.js';

describe('Seedance video submission', () => {
  it('shows a specific public message when the Seedance upstream cannot create a task', async () => {
    const patchAiMessage = vi.fn(() => ({}));
    const store = createAiTaskStore({
      findAiSession: () => ({ id: 'session-1', messages: [] }),
      upsertAiSession: vi.fn(),
      patchAiMessage,
      clearAiSessionTask: vi.fn(),
      sanitizeAiMessage: message => message,
      buildVoiceReplyMessages: messages => messages,
      ensureVoiceReplyText: vi.fn(),
      performVoiceSynthesis: vi.fn(),
      performStreamingChatCompletion: vi.fn(),
      performImageGeneration: vi.fn(),
      videoProvider: {
        submit: vi.fn().mockRejectedValue(new Error('GlobalAI did not return a task id')),
        poll: vi.fn(),
      },
      seedanceAssetProvider: { cleanupAssets: vi.fn() },
      videoFileStore: { inspectExistingVideo: vi.fn().mockResolvedValue(null) },
      videoJobStore: {
        patchVideoJob: vi.fn(),
        getRecoveryPlan: vi.fn(() => ({ recoverable: [], unknownSubmission: [], staleAssets: [] })),
      },
      isKittyVoiceModel: () => false,
      resolveKittyVoiceProfile: vi.fn(),
      VOICE_STREAMING_TEXT: 'speaking',
      VOICE_REPLY_TEMPERATURE: 0.5,
      VOICE_REPLY_MAX_TOKENS: 100,
      VOICE_REPLY_TOP_P: 1,
    });
    store.registerAiTask({
      id: 'seedance-upstream-failed', type: 'video', ownerType: 'user', ownerId: 'user-1', userId: 'user-1',
      sessionId: 'session-1', messageId: 'message-1', status: 'pending', prompt: 'A cat waves.', image: '',
      lastFrame: '', referenceImages: [], durationSeconds: 5, aspectRatio: 'adaptive', videoModel: 'seedance_1_5_pro_720p',
      videoStage: 'submitting', createdAt: Date.now(), updatedAt: Date.now(),
    });

    await store.runAiTask('seedance-upstream-failed');

    expect(patchAiMessage).toHaveBeenCalledWith(expect.anything(), 'session-1', 'message-1', expect.objectContaining({
      content: 'Seedance 上游服务暂不可用，任务尚未创建，请稍后重试。',
      status: 'error',
    }));
  });

  it('passes documented public frame URLs to the video create request without asset preparation', async () => {
    const seedanceAssetProvider = {
      prepareImages: vi.fn(),
      cleanupAssets: vi.fn(),
    };
    const videoProvider = {
      submit: vi.fn().mockResolvedValue({
        id: 'video-upstream-1',
        status: 'completed',
        videoUrl: 'https://cdn.example.com/result.mp4',
      }),
      poll: vi.fn(),
    };
    const store = createAiTaskStore({
      findAiSession: () => ({ id: 'session-1', messages: [] }),
      upsertAiSession: vi.fn(),
      patchAiMessage: vi.fn(() => ({})),
      clearAiSessionTask: vi.fn(),
      sanitizeAiMessage: message => message,
      buildVoiceReplyMessages: messages => messages,
      ensureVoiceReplyText: vi.fn(),
      performVoiceSynthesis: vi.fn(),
      performStreamingChatCompletion: vi.fn(),
      performImageGeneration: vi.fn(),
      videoProvider,
      seedanceAssetProvider,
      videoFileStore: {
        inspectExistingVideo: vi.fn().mockResolvedValue(null),
        downloadValidateAndSave: vi.fn().mockResolvedValue({
          videoUrl: '/videos/result.mp4',
          videoMimeType: 'video/mp4',
        }),
      },
      videoJobStore: { patchVideoJob: vi.fn(), getRecoveryPlan: vi.fn(() => ({ recoverable: [], unknownSubmission: [], staleAssets: [] })) },
      isKittyVoiceModel: () => false,
      resolveKittyVoiceProfile: vi.fn(),
      VOICE_STREAMING_TEXT: 'speaking',
      VOICE_REPLY_TEMPERATURE: 0.5,
      VOICE_REPLY_MAX_TOKENS: 100,
      VOICE_REPLY_TOP_P: 1,
    });
    store.registerAiTask({
      id: 'video-task-1',
      type: 'video',
      ownerType: 'user',
      ownerId: 'user-1',
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: 'message-1',
      status: 'pending',
      prompt: 'A cat waves.',
      image: 'https://www.koyue.top/uploads/first.png',
      lastFrame: 'https://www.koyue.top/uploads/last.png',
      referenceImages: [],
      durationSeconds: 5,
      aspectRatio: 'adaptive',
      videoModel: 'seedance_1_5_pro_720p',
      videoStage: 'submitting',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await store.runAiTask('video-task-1');

    expect(seedanceAssetProvider.prepareImages).not.toHaveBeenCalled();
    expect(videoProvider.submit).toHaveBeenCalledWith(expect.objectContaining({
      image: 'https://www.koyue.top/uploads/first.png',
      lastFrame: 'https://www.koyue.top/uploads/last.png',
      referenceImages: [],
    }));
  });

  it('dispatches Grok tasks to the separate provider without changing the Seedance provider', async () => {
    const videoProvider = { submit: vi.fn(), poll: vi.fn() };
    const grokVideoProvider = {
      submit: vi.fn().mockResolvedValue({ id: 'grok-upstream-1', status: 'completed', videoUrl: 'https://vidgen.x.ai/video.mp4' }),
      poll: vi.fn(),
    };
    const store = createAiTaskStore({
      findAiSession: () => ({ id: 'session-1', messages: [] }), upsertAiSession: vi.fn(), patchAiMessage: vi.fn(() => ({})),
      clearAiSessionTask: vi.fn(), sanitizeAiMessage: message => message, buildVoiceReplyMessages: messages => messages,
      ensureVoiceReplyText: vi.fn(), performVoiceSynthesis: vi.fn(), performStreamingChatCompletion: vi.fn(), performImageGeneration: vi.fn(),
      videoProvider, grokVideoProvider, seedanceAssetProvider: { cleanupAssets: vi.fn() },
      videoFileStore: { inspectExistingVideo: vi.fn().mockResolvedValue(null), downloadValidateAndSave: vi.fn().mockResolvedValue({ videoUrl: '/videos/grok.mp4' }) },
      videoJobStore: { patchVideoJob: vi.fn(), getRecoveryPlan: vi.fn(() => ({ recoverable: [], unknownSubmission: [], staleAssets: [] })) },
      isKittyVoiceModel: () => false, resolveKittyVoiceProfile: vi.fn(), VOICE_STREAMING_TEXT: 'speaking', VOICE_REPLY_TEMPERATURE: 0.5, VOICE_REPLY_MAX_TOKENS: 100, VOICE_REPLY_TOP_P: 1,
    });
    store.registerAiTask({
      id: 'grok-task-1', type: 'video', ownerType: 'user', ownerId: 'user-1', userId: 'user-1', sessionId: 'session-1', messageId: 'message-1',
      status: 'pending', prompt: 'A paper boat moves through a sunlit stream.', image: 'https://www.koyue.top/uploads/boat.jpg', lastFrame: '', referenceImages: [],
      durationSeconds: 4, aspectRatio: '16:9', videoModel: 'grok-imagine-video-1.5', videoStage: 'submitting', createdAt: Date.now(), updatedAt: Date.now(),
    });

    await store.runAiTask('grok-task-1');

    expect(grokVideoProvider.submit).toHaveBeenCalledWith(expect.objectContaining({ image: 'https://www.koyue.top/uploads/boat.jpg' }));
    expect(videoProvider.submit).not.toHaveBeenCalled();
  });

  it('keeps completed Grok output playable when the server cannot reach vidgen.x.ai', async () => {
    const patchAiMessage = vi.fn(() => ({}));
    const createExternalVideoReference = vi.fn(() => ({
      videoUrl: 'https://vidgen.x.ai/xai-vidgen-bucket/temporary.mp4',
      videoMimeType: 'video/mp4',
    }));
    const store = createAiTaskStore({
      findAiSession: () => ({ id: 'session-1', messages: [] }), upsertAiSession: vi.fn(), patchAiMessage, clearAiSessionTask: vi.fn(),
      sanitizeAiMessage: message => message, buildVoiceReplyMessages: messages => messages, ensureVoiceReplyText: vi.fn(),
      performVoiceSynthesis: vi.fn(), performStreamingChatCompletion: vi.fn(), performImageGeneration: vi.fn(),
      videoProvider: { submit: vi.fn(), poll: vi.fn() },
      grokVideoProvider: { submit: vi.fn().mockResolvedValue({ id: 'grok-upstream-2', status: 'completed', videoUrl: 'https://vidgen.x.ai/xai-vidgen-bucket/temporary.mp4' }), poll: vi.fn() },
      seedanceAssetProvider: { cleanupAssets: vi.fn() },
      videoFileStore: { inspectExistingVideo: vi.fn().mockResolvedValue(null), downloadValidateAndSave: vi.fn().mockRejectedValue(new Error('fetch failed')), createExternalVideoReference },
      videoJobStore: { patchVideoJob: vi.fn(), getRecoveryPlan: vi.fn(() => ({ recoverable: [], unknownSubmission: [], staleAssets: [] })) },
      isKittyVoiceModel: () => false, resolveKittyVoiceProfile: vi.fn(), VOICE_STREAMING_TEXT: 'speaking', VOICE_REPLY_TEMPERATURE: 0.5, VOICE_REPLY_MAX_TOKENS: 100, VOICE_REPLY_TOP_P: 1,
    });
    store.registerAiTask({
      id: 'grok-task-download-fallback', type: 'video', ownerType: 'user', ownerId: 'user-1', userId: 'user-1', sessionId: 'session-1', messageId: 'message-1',
      status: 'pending', prompt: 'A dog runs happily.', image: '', lastFrame: '', referenceImages: [], durationSeconds: 4, aspectRatio: '16:9',
      videoModel: 'grok-imagine-video-1.5', videoStage: 'submitting', createdAt: Date.now(), updatedAt: Date.now(),
    });

    await store.runAiTask('grok-task-download-fallback');

    expect(createExternalVideoReference).toHaveBeenCalledWith('https://vidgen.x.ai/xai-vidgen-bucket/temporary.mp4');
    expect(patchAiMessage).toHaveBeenCalledWith(expect.anything(), 'session-1', 'message-1', expect.objectContaining({
      videoUrl: 'https://vidgen.x.ai/xai-vidgen-bucket/temporary.mp4', status: 'sent',
    }));
  });
});
