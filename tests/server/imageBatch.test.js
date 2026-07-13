import { describe, expect, it } from 'vitest';
import { getRequestedImageCount } from '../../server/imageBatch.js';

describe('image batch prompt parsing', () => {
  it.each([
    ['生成2张赛博朋克海报', 2],
    ['帮我画三张猫咪图片', 3],
    ['生成 5 张产品图', 5],
    ['生成一张风景图', 1],
    ['画一幅 3:2 的横图', 1],
  ])('reads %s as %d image requests', (prompt, count) => {
    expect(getRequestedImageCount(prompt)).toBe(count);
  });

  it('rejects requests above the five-image batch maximum', () => {
    expect(() => getRequestedImageCount('生成6张图片')).toThrow('最多一次生成 5 张图片');
  });
});
