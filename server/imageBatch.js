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
const STORYBOARD_LINE_PATTERN = /^\s*(?:第\s*([一二三四五六七八九十两]|[1-9]\d*)\s*张|([1-9]\d*))\s*[.．、:：]\s*(.*)$/u;
const INLINE_CHINESE_STORYBOARD_PATTERN = /\s+(?=第\s*(?:[一二三四五六七八九十两]|[1-9]\d*)\s*张\s*[.．、:：])/gu;
const SHARED_REQUIREMENT_PATTERN = /^\s*(?:统一|共同|通用|公共|整体|全部|所有|每张|每一张)(?:图片|图像|画面)?(?:要求|设置|均需|都要|都用|使用|保持|采用)?\s*[:：]/u;
const STANDALONE_ASPECT_RATIO_PATTERN = /^\s*(?:1:1|3:2|2:3|4:3|3:4|16:9|9:16)(?:\s*(?:比例|画幅|横版|竖版|横图|竖图|宽屏))?\s*$/u;

function parseCount(value) {
  return CHINESE_COUNTS.get(value) || Number(value);
}

export function getRequestedImageCount(prompt) {
  const match = String(prompt || '').match(IMAGE_BATCH_PATTERN);
  if (!match) return 1;

  const count = parseCount(match[1]);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_IMAGE_BATCH_COUNT) {
    throw new Error(`最多一次生成 ${MAX_IMAGE_BATCH_COUNT} 张图片`);
  }
  return count;
}

export function getSingleImageRequestPrompt(prompt) {
  const normalizedPrompt = String(prompt || '').trim();
  const match = normalizedPrompt.match(IMAGE_BATCH_PATTERN);
  if (!match) return normalizedPrompt;

  const count = parseCount(match[1]);
  if (!Number.isSafeInteger(count) || count <= 1) return normalizedPrompt;

  const singleImageDirective = match[0].replace(IMAGE_COUNT_WITH_UNIT_PATTERN, '一张');
  return normalizedPrompt.replace(match[0], singleImageDirective).trim();
}

export function getImageRequestPrompts(prompt, count = 1) {
  const normalizedPrompt = String(prompt || '').trim();
  const requestedCount = Number.isSafeInteger(count) && count > 0 ? count : 1;
  const singleImagePrompt = getSingleImageRequestPrompt(normalizedPrompt);
  const repeatedPrompt = () => Array(requestedCount).fill(singleImagePrompt);

  if (requestedCount <= 1 || getRequestedImageCount(normalizedPrompt) <= 1) {
    return repeatedPrompt();
  }

  const commonLines = [];
  const storyboardItems = new Map();
  let currentItem = null;
  const lines = normalizedPrompt
    .replace(INLINE_CHINESE_STORYBOARD_PATTERN, '\n')
    .split(/\r?\n/u);

  for (const line of lines) {
    if (STANDALONE_ASPECT_RATIO_PATTERN.test(line.replace(/：/gu, ':'))) {
      commonLines.push(line);
      currentItem = null;
      continue;
    }

    if (SHARED_REQUIREMENT_PATTERN.test(line)) {
      commonLines.push(line);
      currentItem = null;
      continue;
    }

    const marker = line.match(STORYBOARD_LINE_PATTERN);
    if (marker) {
      const itemNumber = parseCount(marker[1] || marker[2]);
      currentItem = Number.isSafeInteger(itemNumber) && itemNumber >= 1 && itemNumber <= requestedCount
        ? { number: itemNumber, lines: [marker[3]] }
        : null;
      if (currentItem && !storyboardItems.has(itemNumber)) {
        storyboardItems.set(itemNumber, currentItem);
      }
      continue;
    }

    if (currentItem) {
      currentItem.lines.push(line);
    } else {
      commonLines.push(line);
    }
  }

  if (!storyboardItems.size) {
    return repeatedPrompt();
  }

  const commonPrompt = getSingleImageRequestPrompt(commonLines.join('\n').trim());
  const fallbackPrompt = commonPrompt || singleImagePrompt;
  return Array.from({ length: requestedCount }, (_, index) => {
    const item = storyboardItems.get(index + 1);
    if (!item) return fallbackPrompt;

    const description = item.lines.join('\n').trim();
    return [commonPrompt, description].filter(Boolean).join('\n').trim() || fallbackPrompt;
  });
}
