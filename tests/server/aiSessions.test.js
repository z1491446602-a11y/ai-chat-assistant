import { describe, expect, it, vi } from 'vitest';
import { createAiSessionStore } from '../../server/aiSessions.js';

describe('AI session image metadata', () => {
  it('preserves generated image metadata and real generation stages', () => {
    const store = createAiSessionStore({
      data: { aiSessions: {} },
      saveData: vi.fn(),
      normalizeUserId: value => String(value || '').trim(),
      normalizeGuestId: value => String(value || '').trim(),
      generateEntityId: prefix => `${prefix}-1`,
      getAiTask: () => null,
    });

    expect(store.sanitizeAiMessage({
      id: 'message-1',
      role: 'assistant',
      content: '正在保存图片结果...',
      images: ['/uploads/generated.png'],
      imageFileName: 'generated.png',
      imageFileSize: 2_048,
      imageMimeType: 'image/png',
      imageWidth: 1536,
      imageHeight: 1024,
      imageProvider: 'gpt',
      imageGenerationStage: 'persisting',
      timestamp: 10_000,
      status: 'streaming',
    })).toMatchObject({
      imageFileName: 'generated.png',
      imageFileSize: 2_048,
      imageMimeType: 'image/png',
      imageWidth: 1536,
      imageHeight: 1024,
      imageProvider: 'gpt',
      imageGenerationStage: 'persisting',
    });
  });
});
