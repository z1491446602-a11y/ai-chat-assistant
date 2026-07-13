export const MAX_IMAGE_BATCH_COUNT = 5;

const CHINESE_COUNTS = new Map([
  ['一', 1],
  ['二', 2],
  ['两', 2],
  ['三', 3],
  ['四', 4],
  ['五', 5],
  ['六', 6],
  ['七', 7],
  ['八', 8],
  ['九', 9],
  ['十', 10],
]);

const IMAGE_BATCH_PATTERN = /(?:生成|画|绘制|出图|创作|制作|给我|帮我|我要|来)\s*([1-9]\d*|[一二三四五六七八九十两])\s*张(?:图片|图|图像)?/u;
const IMAGE_COUNT_WITH_UNIT_PATTERN = /\s*([1-9]\d*|[一二三四五六七八九十两])\s*张/u;

export function getRequestedImageCount(prompt) {
  const match = String(prompt || '').match(IMAGE_BATCH_PATTERN);
  if (!match) return 1;

  const count = CHINESE_COUNTS.get(match[1]) || Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_IMAGE_BATCH_COUNT) {
    throw new Error(`最多一次生成 ${MAX_IMAGE_BATCH_COUNT} 张图片`);
  }
  return count;
}

export function getSingleImageRequestPrompt(prompt) {
  const normalizedPrompt = String(prompt || '').trim();
  const match = normalizedPrompt.match(IMAGE_BATCH_PATTERN);
  if (!match) return normalizedPrompt;

  const count = CHINESE_COUNTS.get(match[1]) || Number(match[1]);
  if (!Number.isSafeInteger(count) || count <= 1) return normalizedPrompt;

  const singleImageDirective = match[0].replace(IMAGE_COUNT_WITH_UNIT_PATTERN, '一张');
  return normalizedPrompt.replace(match[0], singleImageDirective).trim();
}
