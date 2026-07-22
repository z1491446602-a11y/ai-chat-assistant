import type {
  VideoAspectRatio,
  VideoGenerationInputs,
  VideoGenerationModel,
  VideoGenerationStage,
  VideoInputMode,
} from '@/types';

export const MAX_VIDEO_REFERENCE_IMAGES = 9;
export const MAX_VIDEO_REFERENCE_BYTES = 10 * 1024 * 1024;
export const VIDEO_REFERENCE_ACCEPT = 'image/png,image/jpeg,image/webp';
export const DEFAULT_VIDEO_DURATION_SECONDS = 5;
export const AUTO_VIDEO_DURATION_SECONDS = -1;
export const DEFAULT_VIDEO_MODEL: VideoGenerationModel = 'seedance_1_5_pro_720p';
export const GROK_VIDEO_MODEL: VideoGenerationModel = 'grok-imagine-video-1.5';
export const VIDEO_MODEL_OPTIONS: readonly { value: VideoGenerationModel; label: string }[] = [
  { value: 'seedance_1_5_pro_720p', label: 'Seedance 1.5 Pro 720p' },
  { value: 'seedance_1_5_pro_480p', label: 'Seedance 1.5 Pro 480p' },
  { value: GROK_VIDEO_MODEL, label: 'Grok Imagine Video' },
];
export const VIDEO_DURATION_OPTIONS = Object.freeze([-1, ...Array.from({ length: 9 }, (_, index) => index + 4)]);
export const GROK_VIDEO_DURATION_OPTIONS = Object.freeze(Array.from({ length: 15 }, (_, index) => index + 1));
export const DEFAULT_VIDEO_ASPECT_RATIO: VideoAspectRatio = 'adaptive';
export const VIDEO_ASPECT_RATIO_OPTIONS: readonly VideoAspectRatio[] = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'];
export const GROK_VIDEO_ASPECT_RATIO_OPTIONS: readonly VideoAspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];

const VIDEO_REFERENCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type VideoImageTarget = 'image' | 'lastFrame' | 'referenceImages';

export function createEmptyVideoGenerationInputs(): VideoGenerationInputs {
  return {
    videoModel: DEFAULT_VIDEO_MODEL,
    image: '',
    lastFrame: '',
    referenceImages: [],
    inputMode: 'frames',
    durationSeconds: DEFAULT_VIDEO_DURATION_SECONDS,
    aspectRatio: DEFAULT_VIDEO_ASPECT_RATIO,
  };
}

export function getVideoInputMode(inputs: VideoGenerationInputs): VideoInputMode {
  return inputs.inputMode === 'frames' ? 'frames' : 'references';
}

export function isGrokVideoModel(model: VideoGenerationModel | undefined): boolean {
  return model === GROK_VIDEO_MODEL;
}

export function isSeedance15VideoModel(model: VideoGenerationModel | undefined): boolean {
  return model === 'seedance_1_5_pro_720p' || model === 'seedance_1_5_pro_480p';
}

export function getVideoDurationOptions(model: VideoGenerationModel | undefined): readonly number[] {
  return isGrokVideoModel(model) ? GROK_VIDEO_DURATION_OPTIONS : VIDEO_DURATION_OPTIONS;
}

export function getVideoAspectRatioOptions(model: VideoGenerationModel | undefined): readonly VideoAspectRatio[] {
  return isGrokVideoModel(model) ? GROK_VIDEO_ASPECT_RATIO_OPTIONS : VIDEO_ASPECT_RATIO_OPTIONS;
}

export function getVideoReferenceLimit(model: VideoGenerationModel | undefined): number {
  return isGrokVideoModel(model) ? 1 : isSeedance15VideoModel(model) ? 2 : MAX_VIDEO_REFERENCE_IMAGES;
}

export function supportsVideoReferenceImages(model: VideoGenerationModel | undefined): boolean {
  return !isGrokVideoModel(model) && !isSeedance15VideoModel(model);
}

export function normalizeVideoInputsForModel(
  inputs: VideoGenerationInputs,
  videoModel: VideoGenerationModel,
): VideoGenerationInputs {
  if (isSeedance15VideoModel(videoModel)) {
    const durationSeconds = inputs.durationSeconds === AUTO_VIDEO_DURATION_SECONDS
      ? AUTO_VIDEO_DURATION_SECONDS
      : Math.max(4, Math.min(12, inputs.durationSeconds ?? DEFAULT_VIDEO_DURATION_SECONDS));
    const aspectRatio = VIDEO_ASPECT_RATIO_OPTIONS.includes(inputs.aspectRatio || DEFAULT_VIDEO_ASPECT_RATIO)
      ? inputs.aspectRatio
      : DEFAULT_VIDEO_ASPECT_RATIO;
    return { ...inputs, videoModel, referenceImages: [], inputMode: 'frames', durationSeconds, aspectRatio };
  }
  if (!isGrokVideoModel(videoModel)) return { ...inputs, videoModel };
  const aspectRatio = GROK_VIDEO_ASPECT_RATIO_OPTIONS.includes(inputs.aspectRatio || '16:9')
    ? inputs.aspectRatio
    : '16:9';
  const durationSeconds = Math.max(1, Math.min(15, inputs.durationSeconds ?? DEFAULT_VIDEO_DURATION_SECONDS));
  const image = inputs.image || inputs.referenceImages[0] || '';
  return {
    ...inputs,
    videoModel,
    image,
    lastFrame: '',
    referenceImages: [],
    inputMode: 'frames',
    durationSeconds,
    aspectRatio,
  };
}

export function getVideoGenerationImageCount(inputs: VideoGenerationInputs): number {
  return Number(Boolean(inputs.image))
    + Number(Boolean(inputs.lastFrame))
    + inputs.referenceImages.length;
}

export function getFilesFromTransfer(transfer: Pick<DataTransfer, 'files' | 'items'> | null | undefined): File[] {
  const directFiles = Array.from(transfer?.files || []).filter(file => file.size > 0);
  if (directFiles.length) return directFiles;
  return Array.from(transfer?.items || [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile?.())
    .filter((file): file is File => Boolean(file && file.size > 0));
}

export function appendVideoImageMarkers(prompt: string, startReferenceIndex: number, count: number): string {
  if (count <= 0) return prompt;
  const markers = Array.from({ length: count }, (_, index) => `[图${startReferenceIndex + index + 1}]`).join(' ');
  const normalizedPrompt = String(prompt || '').trim();
  return normalizedPrompt ? `${normalizedPrompt} ${markers}` : markers;
}

export const VIDEO_STAGE_LABELS: Record<VideoGenerationStage, string> = {
  submitting: '正在提交视频任务',
  queued: '视频任务已排队',
  processing: '视频正在生成中',
  downloading: '正在下载视频',
  validating: '正在验证并保存视频',
};

export function validateVideoInputFiles(
  files: File[],
  target: VideoImageTarget,
  currentReferenceCount: number,
  _currentInputs?: VideoGenerationInputs,
): File[] {
  const usesFrameGuidance = Boolean(_currentInputs?.image || _currentInputs?.lastFrame);
  const usesReferenceGuidance = Boolean(_currentInputs?.referenceImages.length || currentReferenceCount);
  if (target === 'referenceImages' && !supportsVideoReferenceImages(_currentInputs?.videoModel)) {
    throw new Error('This video model supports first and last frames, not reference images');
  }
  if (target === 'referenceImages' && usesFrameGuidance) {
    throw new Error('Reference images cannot be used with first or last frames');
  }
  if (target !== 'referenceImages' && usesReferenceGuidance) {
    throw new Error('First and last frames cannot be used with reference images');
  }
  const selectedFiles = target === 'referenceImages' ? files : files.slice(0, 1);
  const existingImageCount = Number(Boolean(_currentInputs?.image))
    + Number(Boolean(_currentInputs?.lastFrame))
    + (_currentInputs?.referenceImages.length || currentReferenceCount);
  const replacedFrameCount = target === 'image'
    ? Number(Boolean(_currentInputs?.image))
    : target === 'lastFrame' ? Number(Boolean(_currentInputs?.lastFrame)) : 0;
  const nextImageCount = existingImageCount - replacedFrameCount + selectedFiles.length;
  const referenceLimit = getVideoReferenceLimit(_currentInputs?.videoModel);
  if (nextImageCount > referenceLimit) {
    throw new Error('视频图片最多 9 张（包含首帧和尾帧）');
  }
  if (target === 'referenceImages'
    && currentReferenceCount + selectedFiles.length > referenceLimit) {
    throw new Error('视频参考图最多添加 9 张');
  }

  for (const file of selectedFiles) {
    if (!VIDEO_REFERENCE_MIME_TYPES.has(file.type)) {
      throw new Error('参考图仅支持 PNG、JPEG 或 WebP');
    }
    if (file.size > MAX_VIDEO_REFERENCE_BYTES) {
      throw new Error('每张参考图原文件不能超过 10 MB');
    }
  }

  return selectedFiles;
}

export function validateVideoImageDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height)
    || width <= 0 || height <= 0 || width > 6000 || height > 6000) {
    throw new Error('视频图片宽高不能超过 6000 像素');
  }
  const aspectRatio = width / height;
  if (aspectRatio < 0.4 || aspectRatio > 2.5) {
    throw new Error('视频图片宽高比必须在 0.4 到 2.5 之间');
  }
}

export function getVideoImageOutputDimensions(width: number, height: number): { width: number; height: number } {
  validateVideoImageDimensions(width, height);
  let scale = Math.min(1, 1600 / Math.max(width, height));
  if (Math.min(width, height) * scale < 300) {
    scale = 300 / Math.min(width, height);
  }
  return {
    width: Math.max(300, Math.round(width * scale)),
    height: Math.max(300, Math.round(height * scale)),
  };
}

export async function compressVideoReferenceImage(file: File): Promise<string> {
  validateVideoInputFiles([file], 'image', 0);
  const source = await loadImage(await readFileAsDataUrl(file));
  const { width, height } = getVideoImageOutputDimensions(source.naturalWidth, source.naturalHeight);
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
