const SUPPORTED_IMAGE_SIZES = [
  { size: '1024x1024', ratio: 1 },
  { size: '1536x1024', ratio: 1536 / 1024 },
  { size: '1024x1536', ratio: 1024 / 1536 },
];

const COMMON_ASPECT_RATIO_SIZES = new Map([
  ['1:1', '1024x1024'],
  ['3:2', '1536x1024'],
  ['2:3', '1024x1536'],
  ['4:3', '1365x1024'],
  ['3:4', '1024x1365'],
  ['16:9', '1792x1024'],
  ['9:16', '1024x1792'],
]);

function greatestCommonDivisor(left, right) {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

function normalizeAspectRatio(width, height) {
  const normalizedWidth = normalizeRatioNumber(width);
  const normalizedHeight = normalizeRatioNumber(height);
  if (!normalizedWidth || !normalizedHeight) {
    return '';
  }

  const divisor = greatestCommonDivisor(normalizedWidth, normalizedHeight);
  const ratio = `${Math.round(normalizedWidth / divisor)}:${Math.round(normalizedHeight / divisor)}`;
  return COMMON_ASPECT_RATIO_SIZES.has(ratio) ? ratio : '';
}

export function extractRequestedImageAspectRatio(prompt) {
  const compactText = String(prompt || '')
    .trim()
    .replace(/：/g, ':')
    .replace(/[×X]/g, 'x')
    .replace(/\s+/g, '');
  if (!compactText) {
    return '';
  }

  const ratioMatch = compactText.match(/(?:^|[^0-9])(\d{1,2})[:/](\d{1,2})(?:[^0-9]|$)/);
  if (ratioMatch) {
    return normalizeAspectRatio(ratioMatch[1], ratioMatch[2]);
  }

  const pixelMatch = compactText.match(/(?:^|[^0-9])(\d{3,4})x(\d{3,4})(?:[^0-9]|$)/i);
  if (pixelMatch) {
    return normalizeAspectRatio(pixelMatch[1], pixelMatch[2]);
  }

  if (/(正方形|方图|头像)/.test(compactText)) {
    return '1:1';
  }

  return '';
}

function normalizeRatioNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  return number;
}

function getClosestSupportedImageSize(ratio) {
  const normalizedRatio = normalizeRatioNumber(ratio);
  if (!normalizedRatio) {
    return '';
  }

  return SUPPORTED_IMAGE_SIZES
    .map(option => ({
      ...option,
      distance: Math.abs(Math.log(normalizedRatio / option.ratio)),
    }))
    .sort((left, right) => left.distance - right.distance)[0]?.size || '';
}

export function extractRequestedImageSize(prompt) {
  const text = String(prompt || '').trim();
  if (!text) {
    return '';
  }

  const compactText = text
    .replace(/[：∶]/g, ':')
    .replace(/[×＊✕]/g, 'x')
    .replace(/\s+/g, '');

  const requestedAspectRatio = extractRequestedImageAspectRatio(text);
  if (requestedAspectRatio) {
    return COMMON_ASPECT_RATIO_SIZES.get(requestedAspectRatio) || '';
  }

  const pixelSizeMatch = compactText.match(/(?:^|[^0-9])((?:1024|1536)x(?:1024|1536))(?:[^0-9]|$)/i);
  if (pixelSizeMatch) {
    const size = pixelSizeMatch[1].toLowerCase();
    if (SUPPORTED_IMAGE_SIZES.some(option => option.size === size)) {
      return size;
    }
  }

  const ratioMatch = compactText.match(/(?:比例|画幅|宽高比|尺寸|生成|图片|图|海报|壁纸|^)?(\d{1,2})(?:[:/比])(\d{1,2})(?:比例|画幅|宽高比|尺寸|图|图片|海报|壁纸|$)?/);
  if (ratioMatch) {
    const width = normalizeRatioNumber(ratioMatch[1]);
    const height = normalizeRatioNumber(ratioMatch[2]);
    if (width && height) {
      return getClosestSupportedImageSize(width / height);
    }
  }

  if (/(正方形|方图|头像|1比1|1:1|1\/1)/.test(compactText)) {
    return '1024x1024';
  }

  if (/(横版|横屏|宽屏|横图|电脑壁纸|封面图|banner|16比9|16:9|16\/9|3比2|3:2|3\/2|4比3|4:3|4\/3)/i.test(compactText)) {
    return '1536x1024';
  }

  if (/(竖版|竖屏|竖图|手机壁纸|小红书|海报|9比16|9:16|9\/16|2比3|2:3|2\/3|3比4|3:4|3\/4)/i.test(compactText)) {
    return '1024x1536';
  }

  return '';
}

export function resolveImageRequestSize(prompt, fallbackSize = '') {
  const requestedSize = extractRequestedImageSize(prompt);
  if (requestedSize) {
    return requestedSize;
  }

  const normalizedFallback = String(fallbackSize || '').trim().toLowerCase();
  if (
    SUPPORTED_IMAGE_SIZES.some(option => option.size === normalizedFallback)
    || [...COMMON_ASPECT_RATIO_SIZES.values()].includes(normalizedFallback)
  ) {
    return normalizedFallback;
  }

  return '';
}

export function appendImageRequestSize(target, prompt, fallbackSize = '') {
  const size = resolveImageRequestSize(prompt, fallbackSize);
  if (!size) {
    return target;
  }

  if (target instanceof FormData) {
    target.set('size', size);
    return target;
  }

  return {
    ...target,
    size,
  };
}
