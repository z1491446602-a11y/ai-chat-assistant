import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ImagePlus, Images, Sparkles, X } from 'lucide-react';
import type { ImageGenerationProvider } from '@/services/api';

type ImageMenu = 'materials' | 'model';

interface ImageProviderOption {
  value: ImageGenerationProvider;
  label: string;
}

interface ImageInputPanelProps {
  images: string[];
  selectedProvider: ImageGenerationProvider;
  providerOptions: readonly ImageProviderOption[];
  busy: boolean;
  onPick: () => void;
  onRemove: (index: number) => void;
  onSelectProvider: (provider: ImageGenerationProvider) => void;
  onOpenMenu?: () => void;
}

export function ImageInputPanel({
  images,
  selectedProvider,
  providerOptions,
  busy,
  onPick,
  onRemove,
  onSelectProvider,
  onOpenMenu,
}: ImageInputPanelProps) {
  const [openMenu, setOpenMenu] = useState<ImageMenu | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Partial<Record<ImageMenu, HTMLButtonElement | null>>>({});
  const compactModelLabel = selectedProvider === 'grok' ? 'Grok' : 'GPT';

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

  function toggleMenu(menu: ImageMenu) {
    if (busy) return;
    setOpenMenu(current => {
      const next = current === menu ? null : menu;
      if (next) onOpenMenu?.();
      return next;
    });
  }

  const triggerClass = 'flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-45';
  const menuClass = 'absolute bottom-[calc(100%+8px)] z-50 max-h-[min(360px,70vh)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.16)]';
  const menuItemClass = 'flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45';

  return (
    <div ref={rootRef} role="group" aria-label="图片生成选项" className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
      <div className="relative">
        <button
          ref={element => { triggerRefs.current.materials = element; }}
          type="button"
          onClick={() => toggleMenu('materials')}
          disabled={busy}
          className={triggerClass}
          aria-label={`素材 ${images.length}`}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'materials'}
        >
          <Images className="h-3.5 w-3.5 text-sky-600" />
          <span>素材 {images.length}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${openMenu === 'materials' ? 'rotate-180' : ''}`} />
        </button>
        {openMenu === 'materials' ? (
          <div role="menu" aria-label="选择图片素材" className={`${menuClass} left-0 w-72 max-w-[calc(100vw-2rem)]`}>
            <div className="px-3 pb-1.5 pt-2 text-xs font-semibold text-slate-500">参考素材</div>
            <button type="button" role="menuitem" aria-label="添加参考图" onClick={onPick} disabled={busy || images.length >= 3} className={menuItemClass}>
              <ImagePlus className="h-4 w-4 text-sky-600" />
              <span className="flex-1">添加参考图</span>
              <span className="text-xs tabular-nums text-slate-400">{images.length}/3</span>
            </button>
            {images.length ? (
              <div className="mt-1 border-t border-slate-100 px-2 pb-2 pt-3">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {images.map((src, index) => (
                    <div key={`${src}-${index}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                      <img src={src} alt={`图片参考图 ${index + 1}`} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => onRemove(index)}
                        className="absolute right-0 top-0 flex h-9 w-9 items-start justify-end p-1 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-500"
                        aria-label={`移除图片参考图 ${index + 1}`}
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/85"><X className="h-3 w-3" /></span>
                      </button>
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
          <div role="menu" aria-label="选择图片模型" className={`${menuClass} left-1/2 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2`}>
            <div className="px-3 pb-1.5 pt-2 text-xs font-semibold text-slate-500">模型</div>
            {providerOptions.map(option => {
              const selected = selectedProvider === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-label={option.label}
                  aria-checked={selected}
                  onClick={() => {
                    onSelectProvider(option.value);
                    setOpenMenu(null);
                  }}
                  className={menuItemClass}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${selected ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}><Sparkles className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-800">{option.label}</span>
                    <span className="block text-xs text-slate-500">{option.value === 'grok' ? '创意图片生成' : '精细生成与图片编辑'}</span>
                  </span>
                  {selected ? <Check className="h-4 w-4 shrink-0 text-sky-600" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
