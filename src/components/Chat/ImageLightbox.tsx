import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface ImageLightboxProps {
  imageUrls: string[];
  activeIndex: number;
  closeButtonRef: RefObject<HTMLButtonElement>;
  onChange: (index: number) => void;
  onClose: () => void;
}

export function ImageLightbox({
  imageUrls,
  activeIndex,
  closeButtonRef,
  onChange,
  onClose,
}: ImageLightboxProps) {
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-3 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="图片大图预览"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        aria-label="关闭大图预览"
      >
        <X className="h-6 w-6" />
      </button>

      {imageUrls.length > 1 ? (
        <>
          <button
            type="button"
            onClick={() => onChange(Math.max(0, activeIndex - 1))}
            disabled={activeIndex === 0}
            className="absolute left-3 top-1/2 z-10 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 disabled:cursor-default disabled:opacity-30 sm:left-6"
            aria-label="查看上一张大图"
          >
            <ChevronLeft className="h-7 w-7" />
          </button>
          <button
            type="button"
            onClick={() => onChange(Math.min(imageUrls.length - 1, activeIndex + 1))}
            disabled={activeIndex === imageUrls.length - 1}
            className="absolute right-3 top-1/2 z-10 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 disabled:cursor-default disabled:opacity-30 sm:right-6"
            aria-label="查看下一张大图"
          >
            <ChevronRight className="h-7 w-7" />
          </button>
        </>
      ) : null}

      <img
        src={imageUrls[activeIndex]}
        alt={`放大预览图片 ${activeIndex + 1}`}
        className="max-h-[calc(100dvh-5rem)] max-w-full select-none object-contain sm:max-w-[calc(100vw-8rem)]"
      />

      {imageUrls.length > 1 ? (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-sm font-medium text-white"
          aria-live="polite"
        >
          {activeIndex + 1} / {imageUrls.length}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
