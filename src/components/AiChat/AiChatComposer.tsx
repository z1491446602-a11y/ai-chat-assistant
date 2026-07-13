import { useEffect, useRef, type ChangeEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { FileText, ImagePlus, LoaderCircle, Mic, Send, Square, Video, X } from 'lucide-react';
import type { MessageFile } from '@/types';
import type { ImageGenerationProvider } from '@/services/api';
import { AiChatComposerAttachments } from './AiChatComposerAttachments';
import { MAX_VIDEO_REFERENCE_IMAGES } from './videoGeneration';

interface AiChatComposerProps {
  isStreaming: boolean;
  loading: boolean;
  isUploadingImages: boolean;
  isUploadingFile: boolean;
  sendButtonDisabled: boolean;
  input: string;
  placeholder: string;
  showVoiceRecorder: boolean;
  isPressRecordingVoice: boolean;
  pressVoiceLevel: number;
  showMoreActions: boolean;
  showImageProviderMenu: boolean;
  selectedImageProviderLabel: string;
  effectiveImageGenerationMode: boolean;
  isVideoGenerationMode: boolean;
  isGeneratingVideoTask: boolean;
  pendingAiImages: string[];
  pendingAiFiles: MessageFile[];
  pendingAiVideoImages: string[];
  imageProviderOptions: readonly { value: ImageGenerationProvider; label: string }[];
  composerRef: RefObject<HTMLTextAreaElement>;
  aiImageInputRef: RefObject<HTMLInputElement>;
  aiFileInputRef: RefObject<HTMLInputElement>;
  aiVideoImageInputRef: RefObject<HTMLInputElement>;
  mediaEnabled: boolean;
  onRequireLogin: () => void;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  onToggleImageProviderMenu: () => void;
  onSelectImageProvider: (provider: ImageGenerationProvider) => void;
  onToggleImageGenerationMode: () => void;
  onToggleVideoGenerationMode: () => void;
  onRemovePendingAiImage: (index: number) => void;
  onRemovePendingAiFile: (index: number) => void;
  onRemovePendingAiVideoImage: (index: number) => void;
  onPickAiImages: (event: ChangeEvent<HTMLInputElement>) => void;
  onPickAiFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  onPickAiVideoImages: (event: ChangeEvent<HTMLInputElement>) => void;
  onDropFiles: (files: File[]) => void;
  onCancelVoiceRecorder: () => void;
  onStartPressVoiceInput: () => Promise<void> | void;
  onStopPressVoiceInput: () => void;
  onOpenMoreActions: () => void;
  onOpenAiImagePicker: () => void;
  onOpenAiFilePicker: () => void;
  onOpenAiVideoImagePicker: () => void;
  onOpenVoiceRecorder: () => void;
}

export function AiChatComposer(props: AiChatComposerProps) {
  const pressVoiceActiveRef = useRef(false);
  const busy = props.loading || props.isStreaming || props.isUploadingImages || props.isUploadingFile;

  useEffect(() => {
    const textarea = props.composerRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 168)}px`;
  }, [props.composerRef, props.input]);

  async function startPressToTalk(event: ReactPointerEvent<HTMLButtonElement>) {
    if (pressVoiceActiveRef.current || !props.showVoiceRecorder) return;
    pressVoiceActiveRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    await props.onStartPressVoiceInput();
  }
  function stopPressToTalk() {
    if (!pressVoiceActiveRef.current) return;
    pressVoiceActiveRef.current = false;
    props.onStopPressVoiceInput();
  }
  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (busy) return;
    const files = Array.from(event.dataTransfer.files || []).filter(file => file.size > 0);
    if (!files.length) return;
    event.preventDefault();
    props.onDropFiles(files);
  }

  return <>
    <input ref={props.aiImageInputRef} type="file" accept="image/*" multiple disabled={busy} className="hidden" onChange={props.onPickAiImages} />
    <input ref={props.aiVideoImageInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} className="hidden" onChange={props.onPickAiVideoImages} />
    <input ref={props.aiFileInputRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.xls,.xlsx" multiple disabled={busy} className="hidden" onChange={props.onPickAiFiles} />

    {props.showVoiceRecorder ? (
      <div className="px-3 pb-2 pt-1">
        <div className="mx-auto flex max-w-[980px] items-center gap-2 rounded-[20px] border border-sky-100 bg-white px-2.5 py-2 shadow-lg">
          <button type="button" onPointerDown={event => void startPressToTalk(event)} onPointerUp={stopPressToTalk} onPointerCancel={stopPressToTalk} onPointerLeave={stopPressToTalk} disabled={busy} className={`flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium ${props.isPressRecordingVoice ? 'bg-sky-600 text-white' : 'bg-sky-50 text-slate-700'}`}>
            <Mic className="h-4 w-4" /><span>{props.isPressRecordingVoice ? '松开转文字' : '按住说话'}</span><span className="truncate text-xs opacity-75">音量 {Math.round(props.pressVoiceLevel * 100)}%</span>
          </button>
          <button type="button" onClick={props.onCancelVoiceRecorder} className="rounded-full bg-sky-50 p-2" aria-label="关闭语音输入"><X className="h-4 w-4" /></button>
        </div>
      </div>
    ) : (
      <div className="bg-transparent" onDragOver={event => { if (!busy) event.preventDefault(); }} onDrop={handleDrop}>
        {(props.pendingAiImages.length || props.pendingAiFiles.length || props.pendingAiVideoImages.length) ? (
          <div className="px-3 pt-3"><div className="mx-auto flex max-w-[980px] gap-2 overflow-x-auto pb-1">
            {props.pendingAiImages.map((url, index) => <div key={`${url}-${index}`} className="relative shrink-0"><img src={url} alt={`待发送图片 ${index + 1}`} className="h-16 w-16 rounded-lg object-cover" /><button type="button" onClick={() => props.onRemovePendingAiImage(index)} className="absolute -right-1 -top-1 rounded-full bg-slate-900 p-1 text-white" aria-label="移除图片"><X className="h-3 w-3" /></button></div>)}
            {props.pendingAiFiles.map((file, index) => <div key={`${file.fileUrl}-${index}`} className="relative flex min-w-[210px] items-center gap-2 rounded-lg border border-sky-100 bg-white px-3 py-2"><FileText className="h-5 w-5 text-sky-700" /><span className="truncate text-sm">{file.fileName}</span><button type="button" onClick={() => props.onRemovePendingAiFile(index)} className="ml-auto" aria-label="移除文件"><X className="h-3 w-3" /></button></div>)}
            {props.pendingAiVideoImages.map((url, index) => <div key={`${url}-${index}`} className="relative shrink-0"><img src={url} alt={`视频参考图 ${index + 1}`} className="h-16 w-24 rounded-lg object-cover" /><button type="button" onClick={() => props.onRemovePendingAiVideoImage(index)} className="absolute -right-1 -top-1 rounded-full bg-slate-900 p-1 text-white" aria-label="移除参考图"><X className="h-3 w-3" /></button></div>)}
          </div></div>
        ) : null}
        <div className="px-3 pb-2 pt-1"><div className="mx-auto max-w-[980px] rounded-[24px] border border-sky-100 bg-white px-3 py-2 shadow-sm">
          {props.isVideoGenerationMode ? <div className="mb-2 flex items-center gap-2 border-b border-sky-100 px-2 pb-2 text-xs text-slate-700"><Video className="h-4 w-4" /><span className="flex-1">{props.pendingAiVideoImages.length ? '图生视频' : '文生视频'} · {props.pendingAiVideoImages.length}/{MAX_VIDEO_REFERENCE_IMAGES} 张参考图</span><button type="button" onClick={props.onOpenAiVideoImagePicker} disabled={props.pendingAiVideoImages.length >= MAX_VIDEO_REFERENCE_IMAGES || busy} aria-label="添加视频参考图"><ImagePlus className="h-4 w-4" /></button></div> : null}
          <textarea ref={props.composerRef} value={props.input} onChange={event => props.onInputChange(event.target.value)} placeholder={props.placeholder} rows={1} className="block max-h-[168px] min-h-[36px] w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-6 outline-none" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); props.onSendMessage(); } }} disabled={busy} />
          <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
            <AiChatComposerAttachments selectedImageProviderLabel={props.selectedImageProviderLabel} showMoreActions={props.showMoreActions} showImageProviderMenu={props.showImageProviderMenu} imageProviderOptions={props.imageProviderOptions} effectiveImageGenerationMode={props.effectiveImageGenerationMode} isVideoGenerationMode={props.isVideoGenerationMode} isGeneratingVideoTask={props.isGeneratingVideoTask} isUploadingImages={props.isUploadingImages} isUploadingFile={props.isUploadingFile} disabled={props.loading} mediaEnabled={props.mediaEnabled} onRequireLogin={props.onRequireLogin} onToggleImageProviderMenu={props.onToggleImageProviderMenu} onSelectImageProvider={props.onSelectImageProvider} onToggleImageGenerationMode={props.onToggleImageGenerationMode} onToggleVideoGenerationMode={props.onToggleVideoGenerationMode} onOpenMoreActions={props.onOpenMoreActions} onOpenAiImagePicker={props.onOpenAiImagePicker} onOpenAiFilePicker={props.onOpenAiFilePicker} />
            <div className="flex items-center gap-1.5"><button type="button" onClick={props.showVoiceRecorder ? props.onCancelVoiceRecorder : props.onOpenVoiceRecorder} disabled={busy} className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-50" aria-label="语音输入"><Mic className="h-4 w-4" /></button><button type="button" onClick={props.onSendMessage} disabled={props.sendButtonDisabled} className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-white disabled:opacity-50" aria-label={props.isStreaming ? '停止生成' : '发送'}>{props.isGeneratingVideoTask ? <LoaderCircle className="h-4 w-4 animate-spin" /> : props.isStreaming ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-4 w-4" />}</button></div>
          </div>
        </div></div>
      </div>
    )}
  </>;
}
