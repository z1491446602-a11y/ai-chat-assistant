import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, LoaderCircle } from 'lucide-react';
import type { ImageGenerationStage, Message } from '@/types';
import { ImageLightbox } from './ImageLightbox';

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
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const imageUrls = Array.isArray(message.images) ? message.images.filter(Boolean) : [];
  const isGenerating = Boolean(message.imageGenerationStage && message.status !== 'error' && !imageUrls.length);
  const isLightboxOpen = activeImageIndex !== null;

  useEffect(() => {
    if (!isGenerating) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  useEffect(() => {
    if (!isLightboxOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveImageIndex(null);
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setActiveImageIndex(current => (
          current === null ? null : Math.max(0, current - 1)
        ));
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setActiveImageIndex(current => (
          current === null ? null : Math.min(imageUrls.length - 1, current + 1)
        ));
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previewTriggerRef.current?.focus();
    };
  }, [imageUrls.length, isLightboxOpen]);

  const openLightbox = (index: number, trigger: HTMLButtonElement) => {
    previewTriggerRef.current = trigger;
    setActiveImageIndex(index);
  };

  const scrollGallery = (direction: -1 | 1) => {
    const gallery = galleryRef.current;
    if (!gallery) return;
    gallery.scrollBy({
      left: Math.round(gallery.clientWidth * 0.82) * direction,
      behavior: 'smooth',
    });
  };

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
    const imageRatio = message.imageWidth && message.imageHeight
      ? message.imageWidth / message.imageHeight
      : 0;
    const multiImagePreviewStyle = imageRatio > 0
      ? {
        aspectRatio,
        width: `min(76vw, ${Math.max(12, imageRatio * 30)}rem)`,
      }
      : undefined;

    const lightbox = activeImageIndex !== null ? (
      <ImageLightbox
        imageUrls={imageUrls}
        activeIndex={activeImageIndex}
        closeButtonRef={closeButtonRef}
        onChange={setActiveImageIndex}
        onClose={() => setActiveImageIndex(null)}
      />
    ) : null;

    return (
      <>
        <div className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-100/80 bg-white shadow-[0_2px_16px_rgba(15,23,42,0.06)]">
        {imageUrls.length === 1 ? (
          <div className="grid grid-cols-1 bg-slate-50/40">
            <button
              type="button"
              onClick={event => openLightbox(0, event.currentTarget)}
              className="block min-w-0 w-full cursor-zoom-in bg-slate-50 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
              style={aspectRatio ? { aspectRatio } : undefined}
              aria-label="放大查看图片 1"
            >
              <img
                src={primaryImageUrl}
                alt="AI 生成图片 1"
                className={`w-full object-contain ${aspectRatio ? 'h-full max-h-[32rem]' : 'h-auto max-h-[28rem]'}`}
                loading="lazy"
              />
            </button>
          </div>
        ) : (
          <div className="relative bg-slate-50/40 rounded-xl">
            <div
              ref={galleryRef}
              className="flex touch-pan-x snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain scroll-smooth p-2 pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="region"
              aria-label={`可横向滑动浏览 ${imageUrls.length} 张生成图片`}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  scrollGallery(event.key === 'ArrowLeft' ? -1 : 1);
                }
              }}
            >
              {imageUrls.map((imageUrl, index) => (
                <button
                  key={`${message.id}-generated-image-${index}`}
                  type="button"
                  onClick={event => openLightbox(index, event.currentTarget)}
                  className="block aspect-[4/5] w-[min(76vw,30rem)] shrink-0 snap-start cursor-zoom-in overflow-hidden rounded-xl bg-slate-100 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
                  style={multiImagePreviewStyle}
                  aria-label={`放大查看图片 ${index + 1}`}
                >
                  <img
                    src={imageUrl}
                    alt={`AI 生成图片 ${index + 1}`}
                    className="h-full w-full object-contain"
                    loading={index === 0 ? 'eager' : 'lazy'}
                  />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => scrollGallery(-1)}
              className="absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 sm:inline-flex"
              aria-label="向左浏览图片"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => scrollGallery(1)}
              className="absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 sm:inline-flex"
              aria-label="向右浏览图片"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-50">
          <span className="min-w-0 truncate text-xs text-slate-500">{metadata || message.imageFileName || 'AI 生成图片'}</span>
          <a
            href={primaryImageUrl}
            download={getDownloadName(message, primaryImageUrl)}
            className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-sky-600 hover:text-sky-700 transition-colors"
            aria-label="下载图片"
          >
            <Download className="h-3.5 w-3.5" />
            下载
          </a>
        </div>
        </div>
        {lightbox}
      </>
    );
  }

  if (!message.imageGenerationStage || message.status === 'error') {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - message.timestamp) / 1000));
  return (
    <div className="w-full min-w-0 max-w-[24rem] rounded-2xl border border-slate-100/80 bg-white px-4 py-3.5 shadow-[0_2px_16px_rgba(15,23,42,0.06)]" role="status">
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
