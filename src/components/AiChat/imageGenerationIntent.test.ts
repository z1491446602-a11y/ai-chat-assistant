import { describe, expect, it } from 'vitest';
import { detectImageGenerationMode } from './imageGenerationIntent';

describe('image generation intent', () => {
  it.each([
    '根据上一张图片进行阔图',
    '把上一张图向左扩图',
    '参考刚才的图片向四周延展',
    '沿用前一张图补全画面',
    '继续把背景换成夜晚',
    '接着移除画面中的路人',
    '再添加一轮月亮',
    '再去掉图片上的文字',
  ])('recognizes a previous-image edit request: %s', (prompt) => {
    expect(detectImageGenerationMode(prompt, 0)).toBe('edit');
  });

  it('keeps normal generation and unrelated chat behavior unchanged', () => {
    expect(detectImageGenerationMode('帮我生成一张海报', 0)).toBe('generate');
    expect(detectImageGenerationMode('根据这张图修改颜色', 1)).toBe('edit');
    expect(detectImageGenerationMode('今天天气怎么样', 0)).toBeNull();
    expect(detectImageGenerationMode('把刚才的回答修改一下', 0)).toBeNull();
    expect(detectImageGenerationMode('继续修改刚才的回答', 0)).toBeNull();
    expect(detectImageGenerationMode('解释一下海报设计原则', 0)).toBeNull();
    expect(detectImageGenerationMode('帮我生成一份周报', 0)).toBeNull();
    expect(detectImageGenerationMode('帮我生成一个 Word 文档', 0)).toBeNull();
    expect(detectImageGenerationMode('生成一张海边日落', 0)).toBe('generate');
  });
});
