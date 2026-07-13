import { useEffect, useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import type { ImageGenerationStage, Message } from '@/types';

interface ImageMessageProps {
  message: Message;
}

const IMAGE_STAGE_LABELS: Record<ImageGenerationStage, string> = {
  submitting: '正在提交图片任务',
  generating: '图片正在生成中',
  receiving: '正在接收图片结果',
  persisting: '正在保存图片结果',
};

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  const megabytes = bytes / (1024 * 1024);
  return `${Number(megabytes.toFixed(megabytes >= 10 ? 0 : 1))} MB`;
}

function getDownloadName(message: Message, imageUrl: string): string {
  if (message.imageFileName) {
    return message.imageFileName;
  }
  const extension = message.imageMimeType?.split('/')[1]
    || imageUrl.match(/\.([a-zA-Z0-9]+)(?:[?#].*)?$/)?.[1]
    || 'png';
  return `ai-image-${message.timestamp}.${extension}`;
}

export function ImageMessage({ message }: ImageMessageProps) {
  const [now, setNow] = useState(() => Date.now());
  const imageUrls = Array.isArray(message.images) ? message.images.filter(Boolean) : [];
  const isGenerating = Boolean(message.imageGenerationStage && message.status !== 'error' && !imageUrls.length);

  useEffect(() => {
    if (!isGenerating) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  if (imageUrls.length) {
    const providerLabel = message.imageProvider === 'gpt'
      ? 'GPT'
      : (message.imageProvider === 'grok' ? 'Grok' : null);
    const metadata = [
      providerLabel,
      message.imageWidth && message.imageHeight ? `${message.imageWidth}×${message.imageHeight}` : null,
      typeof message.imageFileSize === 'number' ? formatFileSize(message.imageFileSize) : null,
    ].filter(Boolean).join(' · ');
    const primaryImageUrl = imageUrls[0];
    const aspectRatio = message.imageWidth && message.imageHeight
      ? `${message.imageWidth} / ${message.imageHeight}`
      : undefined;

    return (
      <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-sky-100 bg-white shadow-sm">
        <div className={`grid gap-px bg-sky-100 ${imageUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {imageUrls.map((imageUrl, index) => (
            <a
              key={`${message.id}-generated-image-${index}`}
              href={imageUrl}
              target="_blank"
              rel="noreferrer"
              className="block min-w-0 bg-slate-50"
              style={imageUrls.length === 1 && aspectRatio ? { aspectRatio } : undefined}
              aria-label={`查看原图 ${index + 1}`}
            >
              <img
                src={imageUrl}
                alt={`AI 生成图片 ${index + 1}`}
                className={`w-full object-contain ${imageUrls.length === 1 && aspectRatio ? 'h-full max-h-[32rem]' : 'h-auto max-h-[28rem]'}`}
                loading="lazy"
              />
            </a>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="min-w-0 truncate text-xs text-slate-500">{metadata || message.imageFileName || 'AI 生成图片'}</span>
          <a
            href={primaryImageUrl}
            download={getDownloadName(message, primaryImageUrl)}
            className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900"
            aria-label="下载图片"
          >
            <Download className="h-3.5 w-3.5" />
            下载
          </a>
        </div>
      </div>
    );
  }

  if (!message.imageGenerationStage || message.status === 'error') {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - message.timestamp) / 1000));
  return (
    <div className="w-full min-w-0 max-w-[24rem] rounded-lg border border-sky-100 bg-white px-4 py-3.5 shadow-sm" role="status">
      <div className="flex items-center gap-3">
        <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-sky-600" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">{IMAGE_STAGE_LABELS[message.imageGenerationStage]}</p>
          <p className="mt-1 text-xs text-slate-500">已用时 {formatDuration(elapsedSeconds)}</p>
        </div>
      </div>
      <p className="mt-3 border-t border-sky-50 pt-2 text-xs text-slate-400">可以离开页面，稍后回来查看</p>
    </div>
  );
}
