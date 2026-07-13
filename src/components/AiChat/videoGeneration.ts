import type { VideoGenerationStage } from '@/types';

export const MAX_VIDEO_REFERENCE_IMAGES = 3;
export const MAX_VIDEO_REFERENCE_BYTES = 10 * 1024 * 1024;
export const VIDEO_REFERENCE_ACCEPT = 'image/png,image/jpeg,image/webp';

const VIDEO_REFERENCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export const VIDEO_STAGE_LABELS: Record<VideoGenerationStage, string> = {
  submitting: '正在提交视频任务',
  queued: '视频任务已排队',
  processing: '视频正在生成中',
  downloading: '正在下载视频',
  validating: '正在验证并保存视频',
};

export function validateVideoReferenceFiles(files: File[], currentCount: number): File[] {
  if (currentCount + files.length > MAX_VIDEO_REFERENCE_IMAGES) {
    throw new Error('视频参考图最多添加 3 张');
  }

  for (const file of files) {
    if (!VIDEO_REFERENCE_MIME_TYPES.has(file.type)) {
      throw new Error('参考图仅支持 PNG、JPEG 或 WebP');
    }
    if (file.size > MAX_VIDEO_REFERENCE_BYTES) {
      throw new Error('每张参考图原文件不能超过 10 MB');
    }
  }

  return files;
}

export async function compressVideoReferenceImage(file: File): Promise<string> {
  validateVideoReferenceFiles([file], 0);
  const source = await loadImage(await readFileAsDataUrl(file));
  const scale = Math.min(1, 1600 / Math.max(source.naturalWidth, source.naturalHeight));
  const width = Math.max(1, Math.round(source.naturalWidth * scale));
  const height = Math.max(1, Math.round(source.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('浏览器无法处理参考图');
  }
  context.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('参考图压缩失败')), 'image/jpeg', 0.82);
  });
  return readFileAsDataUrl(blob);
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('参考图读取失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('参考图格式无效'));
    image.src = url;
  });
}
