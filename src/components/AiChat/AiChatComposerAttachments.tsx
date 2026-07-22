import { FileUp, ImagePlus, Images, Video, X } from 'lucide-react';

interface AiChatComposerAttachmentsProps {
  showMoreActions: boolean;
  effectiveImageGenerationMode: boolean;
  isVideoGenerationMode: boolean;
  isGeneratingVideoTask: boolean;
  isUploadingImages: boolean;
  isUploadingFile: boolean;
  disabled: boolean;
  onToggleImageGenerationMode: () => void;
  onToggleVideoGenerationMode: () => void;
  onOpenMoreActions: () => void;
  onOpenAiImagePicker: () => void;
  onOpenAiFilePicker: () => void;
}

export function AiChatComposerAttachments(props: AiChatComposerAttachmentsProps) {
  const runMediaAction = (action: () => void) => {
    if (props.disabled) return;
    action();
  };
  const inactiveClass = 'border border-sky-100 bg-sky-50 text-slate-700 hover:bg-sky-100';
  const activeClass = 'border border-sky-200 bg-sky-100 text-sky-800 hover:bg-sky-200';

  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-visible">
      <div className="relative">
        <button type="button" onClick={props.onOpenMoreActions} disabled={props.disabled || props.isUploadingImages || props.isUploadingFile} className="tech-hover-float flex h-8 w-8 items-center justify-center rounded-full border border-sky-100 bg-sky-50 text-slate-700 disabled:opacity-50" aria-label="更多操作">
          <ImagePlus className="h-4 w-4" />
        </button>
        {props.showMoreActions ? (
          <div className="absolute bottom-12 left-0 z-40 min-w-[148px] space-y-1 rounded-lg border border-sky-200 bg-white p-2 shadow-[0_14px_32px_rgba(15,23,42,0.16)]">
            <button type="button" onClick={props.onOpenAiImagePicker} disabled={props.disabled} className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-sky-50 disabled:opacity-50">
              <ImagePlus className="h-4 w-4 text-sky-600" /><span>上传图片</span>
            </button>
            <button type="button" onClick={props.onOpenAiFilePicker} disabled={props.disabled} className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-sky-50 disabled:opacity-50">
              <FileUp className="h-4 w-4 text-cyan-600" /><span>上传文档</span>
            </button>
          </div>
        ) : null}
      </div>

      {props.isVideoGenerationMode ? (
        <button type="button" onClick={() => runMediaAction(props.onToggleVideoGenerationMode)} disabled={props.disabled || props.isGeneratingVideoTask} className={`flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${activeClass}`} aria-label="关闭视频生成">
          <Video className="h-3.5 w-3.5" /><span>视频生成</span><X className="h-3.5 w-3.5" />
        </button>
      ) : props.effectiveImageGenerationMode ? (
        <button type="button" onClick={() => runMediaAction(props.onToggleImageGenerationMode)} disabled={props.disabled} className={`flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${activeClass}`} aria-label="关闭图片生成">
          <Images className="h-3.5 w-3.5" /><span>图片生成</span><X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <>
          <button type="button" onClick={() => runMediaAction(props.onToggleImageGenerationMode)} disabled={props.disabled} className={`flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${inactiveClass}`} aria-label="生成图片">
            <Images className="h-3.5 w-3.5" /><span className="max-[360px]:hidden">生成图片</span>
          </button>
          <button type="button" onClick={() => runMediaAction(props.onToggleVideoGenerationMode)} disabled={props.disabled || props.isGeneratingVideoTask} className={`flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${inactiveClass}`} aria-label="生成视频">
            <Video className="h-3.5 w-3.5" /><span className="max-[360px]:hidden">生成视频</span>
          </button>
        </>
      )}
    </div>
  );
}
