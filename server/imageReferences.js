import fs from 'fs';
import path from 'path';

const imageDataUrlPattern = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i;
const storedUploadPattern = /^\/uploads\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const maxReferenceBytes = 25 * 1024 * 1024;
export const MAX_IMAGE_REFERENCE_COUNT = 8;
export const MAX_IMAGE_REFERENCE_TOTAL_BYTES = 25 * 1024 * 1024;

function getDecodedBase64Size(base64) {
  const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function normalizeImageReferenceList(images) {
  const sources = Array.isArray(images)
    ? images
      .filter(item => typeof item === 'string' && item.trim())
      .map(item => item.trim())
    : [];
  const uniqueSources = [...new Set(sources)];
  if (uniqueSources.length > MAX_IMAGE_REFERENCE_COUNT) {
    throw new Error(`最多只能使用 ${MAX_IMAGE_REFERENCE_COUNT} 张参考图`);
  }
  let totalInlineBytes = 0;
  for (const source of uniqueSources) {
    const match = source.match(imageDataUrlPattern);
    if (!match) continue;
    const referenceBytes = getDecodedBase64Size(match[1]);
    if (referenceBytes > maxReferenceBytes) {
      throw new Error('单张参考图不能超过 25 MB');
    }
    totalInlineBytes += referenceBytes;
    if (totalInlineBytes > MAX_IMAGE_REFERENCE_TOTAL_BYTES) {
      throw new Error('参考图总大小不能超过 25 MB');
    }
  }
  return uniqueSources;
}

function detectImageMimeType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) {
    return 'image/gif';
  }
  throw new Error('图片引用无效：文件格式不受支持');
}

export function createImageReferenceResolver({
  uploadDir,
  readFile = fs.promises.readFile,
} = {}) {
  const resolvedUploadDir = path.resolve(String(uploadDir || ''));

  return async function resolveImageReferences(images) {
    const sources = normalizeImageReferenceList(images);
    const resolvedReferences = [];
    let totalBytes = 0;

    for (const source of sources) {
      const dataUrlMatch = source.match(imageDataUrlPattern);
      if (dataUrlMatch) {
        const referenceBytes = getDecodedBase64Size(dataUrlMatch[1]);
        if (!referenceBytes || referenceBytes > maxReferenceBytes) {
          throw new Error('图片引用无效：文件为空或过大');
        }
        totalBytes += referenceBytes;
        if (totalBytes > MAX_IMAGE_REFERENCE_TOTAL_BYTES) {
          throw new Error('参考图总大小不能超过 25 MB');
        }
        resolvedReferences.push(source);
        continue;
      }

      const match = source.match(storedUploadPattern);
      if (!match) {
        throw new Error('图片引用无效：仅支持已上传图片或当前站点生成的图片');
      }

      const filePath = path.join(resolvedUploadDir, match[1]);
      let buffer;
      try {
        buffer = await readFile(filePath);
      } catch {
        throw new Error('上一张图片文件已不存在，请重新上传图片');
      }
      if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maxReferenceBytes) {
        throw new Error('图片引用无效：文件为空或过大');
      }
      totalBytes += buffer.length;
      if (totalBytes > MAX_IMAGE_REFERENCE_TOTAL_BYTES) {
        throw new Error('参考图总大小不能超过 25 MB');
      }
      const mimeType = detectImageMimeType(buffer);
      resolvedReferences.push(`data:${mimeType};base64,${buffer.toString('base64')}`);
    }

    return resolvedReferences;
  };
}
