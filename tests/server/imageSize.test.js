import { describe, expect, it } from 'vitest';
import {
  extractRequestedImageAspectRatio,
  extractRequestedImageSize,
} from '../../server/imageSize.js';

describe('image aspect ratio requests', () => {
  it.each([
    ['生成一张 1:1 正方形图片', '1:1', '1024x1024'],
    ['生成一张 3:2 横图', '3:2', '1536x1024'],
    ['生成一张 2:3 竖图', '2:3', '1024x1536'],
    ['生成一张 4:3 横图', '4:3', '1365x1024'],
    ['生成一张 3:4 竖图', '3:4', '1024x1365'],
    ['生成一张 16:9 横图', '16:9', '1792x1024'],
    ['生成一张 9:16 竖图', '9:16', '1024x1792'],
    ['按 1920x1080 比例生成', '16:9', '1792x1024'],
  ])('maps %s to its provider request fields', (prompt, ratio, size) => {
    expect(extractRequestedImageAspectRatio(prompt)).toBe(ratio);
    expect(extractRequestedImageSize(prompt)).toBe(size);
  });
});
