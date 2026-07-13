import { Check, ChevronDown, FileUp, ImagePlus, Sparkles, Video } from 'lucide-react';
import type { ImageGenerationProvider } from '@/services/api';

interface ImageProviderOption {
  value: ImageGenerationProvider;
  label: string;
}

interface AiChatComposerAttachmentsProps {
  selectedImageProviderLabel: string;
  showMoreActions: boolean;
  showImageProviderMenu: boolean;
  imageProviderOptions: readonly ImageProviderOption[];
  effectiveImageGenerationMode: boolean;
  isVideoGenerationMode: boolean;
  isGeneratingVideoTask: boolean;
  isUploadingImages: boolean;
  isUploadingFile: boolean;
  onToggleImageProviderMenu: () => void;
  onSelectImageProvider: (provider: ImageGenerationProvider) => void;
  onToggleImageGenerationMode: () => void;
  onToggleVideoGenerationMode: () => void;
  onOpenMoreActions: () => void;
  onOpenAiImagePicker: () => void;
  onOpenAiFilePicker: () => void;
}

export function AiChatComposerAttachments(props: AiChatComposerAttachmentsProps) {
  const compactLabel = props.selectedImageProviderLabel.endsWith('Grok') ? 'Grok 生图' : 'GPT 生图';

  return (
    <div className="mt-2 flex min-w-0 flex-1 items-center gap-1.5 overflow-visible">
      <div className="relative">
        <button type="button" onClick={props.onOpenMoreActions} disabled={props.isUploadingImages || props.isUploadingFile} className="tech-hover-float flex h-8 w-8 items-center justify-center rounded-full border border-sky-100 bg-sky-50 text-slate-700 disabled:opacity-50" aria-label="更多操作">
          <ImagePlus className="h-4 w-4" />
        </button>
        {props.showMoreActions ? (
          <div className="absolute bottom-12 left-0 z-40 min-w-[148px] space-y-1 rounded-2xl border border-sky-200 bg-white p-2 shadow-[0_14px_32px_rgba(15,23,42,0.16)]">
            <button type="button" onClick={props.onOpenAiImagePicker} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-sky-50">
              <ImagePlus className="h-4 w-4 text-sky-600" /><span>上传图片</span>
            </button>
            <button type="button" onClick={props.onOpenAiFilePicker} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-sky-50">
              <FileUp className="h-4 w-4 text-cyan-600" /><span>上传文档</span>
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-visible">
        <div className="relative flex min-w-0 shrink overflow-visible">
          <div className={`flex h-8 min-w-0 overflow-hidden rounded-full ${props.effectiveImageGenerationMode ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white' : 'border border-sky-100 bg-sky-50 text-slate-700'}`}>
            <button type="button" onClick={props.onToggleImageGenerationMode} className="flex min-w-0 items-center gap-1 px-2.5 text-xs font-medium" aria-label={props.selectedImageProviderLabel}>
              <Sparkles className="h-3.5 w-3.5 shrink-0" /><span className="sm:hidden">{compactLabel}</span><span className="hidden sm:inline">{props.selectedImageProviderLabel}</span>
            </button>
            <button type="button" onClick={props.onToggleImageProviderMenu} className="flex w-7 items-center justify-center border-l border-sky-100" aria-label="选择图片生成模型" aria-expanded={props.showImageProviderMenu}>
              <ChevronDown className={`h-3.5 w-3.5 ${props.showImageProviderMenu ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {props.showImageProviderMenu ? (
            <div className="absolute bottom-12 left-0 z-40 min-w-[176px] rounded-2xl border border-sky-200 bg-white p-2 shadow-[0_18px_42px_rgba(15,23,42,0.18)]">
              {props.imageProviderOptions.map((option) => (
                <button type="button" key={option.value} onClick={() => props.onSelectImageProvider(option.value)} aria-pressed={props.selectedImageProviderLabel === option.label} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm ${props.selectedImageProviderLabel === option.label ? 'bg-sky-50 font-medium text-sky-800' : 'text-slate-700 hover:bg-sky-50'}`}>
                  <span>{option.label}</span>{props.selectedImageProviderLabel === option.label ? <Check className="h-4 w-4" /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" onClick={props.onToggleVideoGenerationMode} disabled={props.isGeneratingVideoTask} className={`flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium disabled:opacity-50 ${props.isVideoGenerationMode ? 'bg-rose-500 text-white' : 'border border-sky-100 bg-sky-50 text-slate-700'}`} aria-label="生成视频">
          <Video className="h-3.5 w-3.5" /><span>生成视频</span>
        </button>
      </div>
    </div>
  );
}
