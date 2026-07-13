import { describe, expect, it } from 'vitest';
import * as imageBatch from '../../server/imageBatch.js';

const { getRequestedImageCount } = imageBatch;

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

  it.each([
    ['生成3张蝴蝶在小溪旁边飞舞的图片', '生成一张蝴蝶在小溪旁边飞舞的图片'],
    ['帮我画三张猫咪图片', '帮我画一张猫咪图片'],
    ['生成 5 张 16:9 产品图', '生成一张 16:9 产品图'],
    ['画一幅 3:2 的横图', '画一幅 3:2 的横图'],
  ])('turns the batch directive in %s into a single-image upstream prompt', (prompt, expected) => {
    expect(imageBatch.getSingleImageRequestPrompt(prompt)).toBe(expected);
  });
});
