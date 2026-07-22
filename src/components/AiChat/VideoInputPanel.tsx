import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Clock3, ImagePlus, Images, Ratio, Sparkles, X } from 'lucide-react';
import type {
  VideoAspectRatio,
  VideoGenerationInputs,
  VideoGenerationModel,
  VideoInputMode,
} from '@/types';
import {
  DEFAULT_VIDEO_ASPECT_RATIO,
  DEFAULT_VIDEO_DURATION_SECONDS,
  DEFAULT_VIDEO_MODEL,
  getVideoAspectRatioOptions,
  getVideoDurationOptions,
  getVideoInputMode,
  getVideoReferenceLimit,
  isGrokVideoModel,
  isSeedance15VideoModel,
  VIDEO_MODEL_OPTIONS,
  type VideoImageTarget,
} from './videoGeneration';

type VideoMenu = 'materials' | 'model' | 'duration' | 'ratio';

interface VideoInputPanelProps {
  inputs: VideoGenerationInputs;
  busy: boolean;
  onPick: (target: VideoImageTarget) => void;
  onRemove: (target: VideoImageTarget, index?: number) => void;
  onInputModeChange: (inputMode: VideoInputMode) => void;
  onModelChange?: (videoModel: VideoGenerationModel) => void;
  onDurationChange: (durationSeconds: number) => void;
  onAspectRatioChange?: (aspectRatio: VideoAspectRatio) => void;
  onOpenMenu?: () => void;
}

interface PreviewProps {
  src: string;
  alt: string;
  removeLabel: string;
  onRemove: () => void;
}

function VideoInputPreview({ src, alt, removeLabel, onRemove }: PreviewProps) {
  return (
    <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
      <img src={src} alt={alt} className="h-full w-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-0 top-0 flex h-9 w-9 items-start justify-end p-1 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-500"
        aria-label={removeLabel}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/85">
          <X className="h-3 w-3" />
        </span>
      </button>
    </div>
  );
}

export function VideoInputPanel({
  inputs,
  busy,
  onPick,
  onRemove,
  onInputModeChange,
  onModelChange,
  onDurationChange,
  onAspectRatioChange,
  onOpenMenu,
}: VideoInputPanelProps) {
  const [openMenu, setOpenMenu] = useState<VideoMenu | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Partial<Record<VideoMenu, HTMLButtonElement | null>>>({});
  const videoModel = inputs.videoModel || DEFAULT_VIDEO_MODEL;
  const isGrok = isGrokVideoModel(videoModel);
  const isSeedance15 = isSeedance15VideoModel(videoModel);
  const framesOnly = isGrok || isSeedance15;
  const inputMode = framesOnly || inputs.inputMode === 'frames' || inputs.image || inputs.lastFrame
    ? 'frames'
    : getVideoInputMode(inputs);
  const referenceLimit = getVideoReferenceLimit(videoModel);
  const durationOptions = getVideoDurationOptions(videoModel);
  const aspectRatioOptions = getVideoAspectRatioOptions(videoModel);
  const durationSeconds = inputs.durationSeconds ?? DEFAULT_VIDEO_DURATION_SECONDS;
  const aspectRatio = inputs.aspectRatio || DEFAULT_VIDEO_ASPECT_RATIO;
  const materialCount = Number(Boolean(inputs.image))
    + Number(Boolean(inputs.lastFrame))
    + inputs.referenceImages.length;
  const compactModelLabel = isGrok
    ? 'Grok'
    : videoModel === 'seedance_1_5_pro_480p' ? '480p' : '720p';

  useEffect(() => {
    if (busy) setOpenMenu(null);
  }, [busy]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !openMenu) return;
      const activeMenu = openMenu;
      setOpenMenu(null);
      triggerRefs.current[activeMenu]?.focus();
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenu]);

  function toggleMenu(menu: VideoMenu) {
    if (busy) return;
    setOpenMenu(current => {
      const next = current === menu ? null : menu;
      if (next) onOpenMenu?.();
      return next;
    });
  }

  function chooseValue(action: () => void) {
    action();
    setOpenMenu(null);
  }

  const triggerClass = 'flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-45';
  const menuClass = 'absolute bottom-[calc(100%+8px)] z-50 max-h-[min(420px,70vh)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.16)]';
  const menuItemClass = 'flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45';

  return (
    <div ref={rootRef} role="group" aria-label="视频生成选项" className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
      <div className="relative">
        <button
          ref={element => { triggerRefs.current.materials = element; }}
          type="button"
          onClick={() => toggleMenu('materials')}
          disabled={busy}
          className={triggerClass}
          aria-label={`素材 ${materialCount}`}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'materials'}
        >
          <Images className="h-3.5 w-3.5 text-sky-600" />
          <span>素材 {materialCount}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${openMenu === 'materials' ? 'rotate-180' : ''}`} />
        </button>
        {openMenu === 'materials' ? (
          <div role="menu" aria-label="选择视频素材" className={`${menuClass} left-0 w-80 max-w-[calc(100vw-2rem)]`}>
            <div className="px-3 pb-1.5 pt-2 text-xs font-semibold text-slate-500">素材</div>
            {framesOnly ? (
              <div className="flex min-h-10 items-center justify-center gap-1.5 rounded-md bg-sky-50 px-2 text-xs font-medium text-sky-700">
                <ImagePlus className="h-3.5 w-3.5" />
                图片引导
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1">
                {([
                  ['references', '参考图模式', Images],
                  ['frames', '首尾帧模式', ImagePlus],
                ] as const).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={inputMode === value}
                  onClick={() => onInputModeChange(value)}
                  className={`flex min-h-10 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${inputMode === value ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-600 hover:bg-white/70'}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
                ))}
              </div>
            )}

            {inputMode === 'references' ? (
              <div className="mt-1">
                <button type="button" role="menuitem" aria-label="添加参考图" onClick={() => onPick('referenceImages')} disabled={busy || inputs.referenceImages.length >= referenceLimit} className={menuItemClass}>
                  <Images className="h-4 w-4 text-sky-600" />
                  <span className="flex-1">添加参考图</span>
                  <span className="text-xs tabular-nums text-slate-400">{inputs.referenceImages.length}/{referenceLimit}</span>
                </button>
              </div>
            ) : (
              <div className="mt-1 grid grid-cols-2 gap-1">
                <button type="button" role="menuitem" onClick={() => onPick('image')} disabled={busy} className={menuItemClass} aria-label={inputs.image ? '更换首帧' : '添加首帧'}>
                  <ImagePlus className="h-4 w-4 text-sky-600" />
                  <span>{inputs.image ? '更换首帧' : '添加首帧'}</span>
                </button>
                {!isGrok ? (
                  <button type="button" role="menuitem" onClick={() => onPick('lastFrame')} disabled={busy || !inputs.image} className={menuItemClass} aria-label={inputs.lastFrame ? '更换尾帧' : '添加尾帧'} title={!inputs.image ? '请先添加首帧' : undefined}>
                    <ImagePlus className="h-4 w-4 text-sky-600" />
                    <span>{inputs.lastFrame ? '更换尾帧' : '添加尾帧'}</span>
                  </button>
                ) : null}
              </div>
            )}

            {materialCount > 0 ? (
              <div className="mt-1 border-t border-slate-100 px-2 pb-2 pt-3">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {inputs.image ? <VideoInputPreview src={inputs.image} alt="视频首帧" removeLabel="移除首帧" onRemove={() => onRemove('image')} /> : null}
                  {inputs.lastFrame ? <VideoInputPreview src={inputs.lastFrame} alt="视频尾帧" removeLabel="移除尾帧" onRemove={() => onRemove('lastFrame')} /> : null}
                  {inputs.referenceImages.map((src, index) => (
                    <div key={`${src}-${index}`} className="relative shrink-0">
                      <VideoInputPreview src={src} alt={`角色参考图 ${index + 1}`} removeLabel={`移除角色参考图 ${index + 1}`} onRemove={() => onRemove('referenceImages', index)} />
                      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">图{index + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="relative">
        <button
          ref={element => { triggerRefs.current.model = element; }}
          type="button"
          onClick={() => toggleMenu('model')}
          disabled={busy}
          className={triggerClass}
          aria-label={`模型 ${compactModelLabel}`}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'model'}
        >
          <Sparkles className="h-3.5 w-3.5 text-violet-600" />
          <span>模型 {compactModelLabel}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${openMenu === 'model' ? 'rotate-180' : ''}`} />
        </button>
        {openMenu === 'model' ? (
          <div role="menu" aria-label="选择视频模型" className={`${menuClass} left-1/2 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2`}>
            <div className="px-3 pb-1.5 pt-2 text-xs font-semibold text-slate-500">模型</div>
            {VIDEO_MODEL_OPTIONS.map(option => {
              const selected = videoModel === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => chooseValue(() => onModelChange?.(option.value))}
                  className={menuItemClass}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${selected ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}><Sparkles className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-800">{option.label}</span>
                    <span className="block text-xs text-slate-500">{option.value === 'seedance_1_5_pro_480p' ? '较快生成 · 480p' : option.value === 'grok-imagine-video-1.5' ? '720p · 1-15 秒 · 图片引导' : '标准清晰度 · 720p'}</span>
                  </span>
                  {selected ? <Check className="h-4 w-4 shrink-0 text-sky-600" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="relative">
        <button
          ref={element => { triggerRefs.current.duration = element; }}
          type="button"
          onClick={() => toggleMenu('duration')}
          disabled={busy}
          className={triggerClass}
          aria-label={`时长 ${durationSeconds === -1 ? '自动' : `${durationSeconds} 秒`}`}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'duration'}
        >
          <Clock3 className="h-3.5 w-3.5 text-emerald-600" />
          <span>时长 {durationSeconds === -1 ? '自动' : `${durationSeconds} 秒`}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${openMenu === 'duration' ? 'rotate-180' : ''}`} />
        </button>
        {openMenu === 'duration' ? (
          <div role="menu" aria-label="选择视频时长" className={`${menuClass} left-0 grid w-36 grid-cols-2 gap-1`}>
            {durationOptions.map(option => (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={durationSeconds === option}
                onClick={() => chooseValue(() => onDurationChange(option))}
                className={`flex min-h-10 items-center justify-center rounded-md px-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${durationSeconds === option ? 'bg-sky-50 font-semibold text-sky-700' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                {option === -1 ? '自动' : `${option} 秒`}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="relative">
        <button
          ref={element => { triggerRefs.current.ratio = element; }}
          type="button"
          onClick={() => toggleMenu('ratio')}
          disabled={busy}
          className={triggerClass}
          aria-label={`比例 ${aspectRatio === 'adaptive' ? '自适应' : aspectRatio}`}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'ratio'}
        >
          <Ratio className="h-3.5 w-3.5 text-amber-600" />
          <span>比例 {aspectRatio === 'adaptive' ? '自适应' : aspectRatio}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${openMenu === 'ratio' ? 'rotate-180' : ''}`} />
        </button>
        {openMenu === 'ratio' ? (
          <div role="menu" aria-label="选择视频比例" className={`${menuClass} right-0 w-36`}>
            {aspectRatioOptions.map(option => (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={aspectRatio === option}
                onClick={() => chooseValue(() => onAspectRatioChange?.(option))}
                className={`${menuItemClass} justify-between`}
              >
                <span>{option === 'adaptive' ? '自适应' : option}</span>
                {aspectRatio === option ? <Check className="h-4 w-4 text-sky-600" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
