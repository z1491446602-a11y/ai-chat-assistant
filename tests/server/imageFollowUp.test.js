import { describe, expect, it, vi } from 'vitest';
import {
  isPreviousImageEditPrompt,
  prepareImageTaskInput,
  resolveImageTaskReferences,
} from '../../server/imageFollowUp.js';

describe('image follow-up references', () => {
  it.each([
    '根据上一张图片进行阔图',
    '继续把刚才那张图向右扩图',
    '沿用前一张图补全画面',
    '继续把背景换成夜晚',
    '接着移除画面中的路人',
    '再添加一轮月亮',
    '再去掉图片上的文字',
  ])('recognizes previous-image edits: %s', (prompt) => {
    expect(isPreviousImageEditPrompt(prompt)).toBe(true);
  });

  it('uses the latest assistant-generated image from the same session', () => {
    const session = {
      messages: [
        { role: 'assistant', images: ['/uploads/older.png'] },
        { role: 'user', content: '再改一下' },
        { role: 'assistant', images: ['/uploads/latest.png'] },
      ],
    };

    expect(resolveImageTaskReferences({
      prompt: '根据上一张图片进行扩图',
      explicitImages: [],
      session,
    })).toEqual(['/uploads/latest.png']);
  });

  it('keeps explicitly uploaded references higher priority than history', () => {
    expect(resolveImageTaskReferences({
      prompt: '根据上一张图扩图',
      explicitImages: ['data:image/png;base64,explicit'],
      session: { messages: [{ role: 'assistant', images: ['/uploads/history.png'] }] },
    })).toEqual(['data:image/png;base64,explicit']);
  });

  it('rejects a previous-image edit when the session has no image', () => {
    expect(() => resolveImageTaskReferences({
      prompt: '扩展上一张图',
      explicitImages: [],
      session: { messages: [{ role: 'assistant', content: '没有图片' }] },
    })).toThrow('当前会话中没有可用于编辑的上一张图片');
  });

  it('leaves a normal text-to-image request without references', () => {
    expect(resolveImageTaskReferences({
      prompt: '生成一张海边日落',
      explicitImages: [],
      session: null,
    })).toEqual([]);
    expect(isPreviousImageEditPrompt('把刚才的回答修改一下')).toBe(false);
    expect(isPreviousImageEditPrompt('继续修改刚才的回答')).toBe(false);
  });

  it('keeps the history URL for display while hydrating the provider input', async () => {
    const resolveImageReferences = vi.fn().mockResolvedValue(['data:image/png;base64,hydrated']);

    await expect(prepareImageTaskInput({
      prompt: '根据上一张图扩图',
      explicitImages: [],
      session: { messages: [{ role: 'assistant', images: ['/uploads/latest.png'] }] },
      resolveImageReferences,
    })).resolves.toEqual({
      displayImages: ['/uploads/latest.png'],
      requestImages: ['data:image/png;base64,hydrated'],
    });
    expect(resolveImageReferences).toHaveBeenCalledWith(['/uploads/latest.png']);
  });
});
