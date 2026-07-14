import { Film, ImagePlus, Images, Timer, X } from 'lucide-react';
import type { VideoGenerationInputs } from '@/types';
import type { VideoImageTarget } from './videoGeneration';

interface VideoInputPanelProps {
  inputs: VideoGenerationInputs;
  busy: boolean;
  onPick: (target: VideoImageTarget) => void;
  onRemove: (target: VideoImageTarget, index?: number) => void;
}

interface PreviewProps {
  src: string;
  alt: string;
  removeLabel: string;
  onRemove: () => void;
}

function VideoInputPreview({ src, alt, removeLabel, onRemove }: PreviewProps) {
  return (
    <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-lg border border-sky-100 bg-slate-50">
      <img src={src} alt={alt} className="h-full w-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-0 top-0 flex h-11 w-11 items-start justify-end p-1 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-500"
        aria-label={removeLabel}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/85">
          <X className="h-3 w-3" />
        </span>
      </button>
    </div>
  );
}

export function VideoInputPanel({ inputs, busy, onPick, onRemove }: VideoInputPanelProps) {
  const referenceCount = inputs.referenceImages.length;
  const controlClass = 'flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-sky-100 bg-sky-50 px-2 text-xs font-medium text-slate-700 transition-colors hover:border-sky-200 hover:bg-sky-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-45';

  return (
    <section aria-label="视频镜头输入" className="mb-2 border-b border-sky-100 px-1 pb-2">
      <div className="mb-2 flex min-w-0 items-center gap-2 text-xs text-slate-700">
        <Film className="h-4 w-4 shrink-0 text-rose-500" />
        <span className="min-w-0 flex-1 truncate font-medium">Veo 3.1 Fast</span>
        <span className="flex shrink-0 items-center gap-1 text-slate-500">
          <Timer className="h-3.5 w-3.5" />8 秒
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => onPick('image')}
          disabled={busy}
          className={controlClass}
          aria-label={inputs.image ? '更换首帧' : '添加首帧'}
        >
          <ImagePlus className="h-4 w-4 shrink-0" />
          <span className="truncate">首帧</span>
        </button>
        <button
          type="button"
          onClick={() => onPick('lastFrame')}
          disabled={busy || !inputs.image}
          className={controlClass}
          aria-label={inputs.lastFrame ? '更换尾帧' : '添加尾帧'}
          title={!inputs.image ? '请先添加首帧' : undefined}
        >
          <ImagePlus className="h-4 w-4 shrink-0" />
          <span className="truncate">尾帧</span>
        </button>
        <button
          type="button"
          onClick={() => onPick('referenceImages')}
          disabled={busy || referenceCount >= 3}
          className={controlClass}
          aria-label="添加角色参考图"
        >
          <Images className="h-4 w-4 shrink-0 max-[360px]:hidden" />
          <span className="whitespace-nowrap">三视图 {referenceCount}/3</span>
        </button>
      </div>

      {(inputs.image || inputs.lastFrame || referenceCount > 0) ? (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {inputs.image ? (
            <VideoInputPreview
              src={inputs.image}
              alt="视频首帧"
              removeLabel="移除首帧"
              onRemove={() => onRemove('image')}
            />
          ) : null}
          {inputs.lastFrame ? (
            <VideoInputPreview
              src={inputs.lastFrame}
              alt="视频尾帧"
              removeLabel="移除尾帧"
              onRemove={() => onRemove('lastFrame')}
            />
          ) : null}
          {inputs.referenceImages.map((src, index) => (
            <VideoInputPreview
              key={`${src}-${index}`}
              src={src}
              alt={`角色参考图 ${index + 1}`}
              removeLabel={`移除角色参考图 ${index + 1}`}
              onRemove={() => onRemove('referenceImages', index)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
