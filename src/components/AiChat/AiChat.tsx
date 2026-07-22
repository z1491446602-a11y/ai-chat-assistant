import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '@/store';
import { transcribeAiCallAudio, type AiTaskOwner, type ImageGenerationProvider } from '@/services/api';
import type { MessageFile, Session, VideoInputMode } from '@/types';
import { MessageList } from '@/components/Chat/MessageList';
import { AiChatComposer } from './AiChatComposer';
import { AiChatHeader } from './AiChatHeader';
import { useAiChatSync } from './useAiChatSync';
import { useAiChatActions } from './useAiChatActions';
import { detectImageGenerationMode } from './imageGenerationIntent';
import { blobToDataUrl, createWavRecorder, type WavRecorderHandle } from '@/utils/audioCapture';
import {
  appendVideoImageMarkers,
  compressVideoReferenceImage,
  createEmptyVideoGenerationInputs,
  getVideoInputMode,
  normalizeVideoInputsForModel,
  validateVideoInputFiles,
  type VideoImageTarget,
} from './videoGeneration';
import type { AuthStatus, AuthUser } from '@/services/authApi';
import { uploadAiDocument } from '@/services/aiUploadsApi';

interface AiChatProps {
  aiOwner: AiTaskOwner;
  authStatus: AuthStatus;
  interactionEnabled: boolean;
  user: AuthUser | null;
  sidebarOpen: boolean;
  refreshAiSessions: (preferredSessionId?: string | null, shouldApply?: () => boolean) => Promise<Session[]>;
  onRequireLogin: () => void;
  onAccountClick: () => void;
}

const IMAGE_PROVIDER_OPTIONS = [
  { value: 'gpt', label: '生成图片-GPT' },
  { value: 'grok', label: '生成图片-Grok' },
] as const;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('加载图片失败'));
    image.src = dataUrl;
  });
}
async function compressImage(file: File): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return dataUrl;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}
const AI_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.txt', '.md', '.csv', '.json', '.xls', '.xlsx']);
function isAiDocumentFile(file: File) {
  const dot = file.name.lastIndexOf('.');
  return AI_DOCUMENT_EXTENSIONS.has(dot >= 0 ? file.name.slice(dot).toLowerCase() : '');
}
export function AiChat({
  aiOwner,
  authStatus,
  interactionEnabled,
  user,
  sidebarOpen,
  refreshAiSessions,
  onRequireLogin,
  onAccountClick,
}: AiChatProps) {
  const { sessions, currentSessionId, isStreaming, patchMessage, selectSession, setStreaming, streamingMessageId, setStreamingMessageId } = useChatStore();
  const [input, setInput] = useState('');
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [isPressRecordingVoice, setIsPressRecordingVoice] = useState(false);
  const [pressVoiceLevel, setPressVoiceLevel] = useState(0);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [isImageGenerationMode, setIsImageGenerationMode] = useState(false);
  const [suppressAutoImageMode, setSuppressAutoImageMode] = useState(false);
  const [selectedImageProvider, setSelectedImageProvider] = useState<ImageGenerationProvider>('gpt');
  const [isVideoGenerationMode, setIsVideoGenerationMode] = useState(false);
  const [pendingAiImages, setPendingAiImages] = useState<string[]>([]);
  const [pendingAiVideoInputs, setPendingAiVideoInputs] = useState(createEmptyVideoGenerationInputs);
  const [pendingAiFiles, setPendingAiFiles] = useState<MessageFile[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const aiImageInputRef = useRef<HTMLInputElement>(null);
  const aiFileInputRef = useRef<HTMLInputElement>(null);
  const aiVideoImageInputRef = useRef<HTMLInputElement>(null);
  const aiVideoImageTargetRef = useRef<VideoImageTarget>('referenceImages');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pressVoiceRecorderRef = useRef<WavRecorderHandle | null>(null);

  const aiSessions = useMemo(() => sessions.filter(session => 'guestId' in aiOwner
    ? session.ownerType === 'guest' && session.ownerId === aiOwner.guestId
    : session.ownerType !== 'guest' && session.ownerId === aiOwner.userId).sort((a, b) => b.updatedAt - a.updatedAt), [aiOwner, sessions]);
  const currentAiSession = useMemo(() => aiSessions.find(session => session.id === currentSessionId) || null, [aiSessions, currentSessionId]);
  const currentAiMessages = currentAiSession?.messages || [];
  const imageGenerationAllowed = user?.mediaPermissions.imageGeneration === true;
  const videoGenerationAllowed = user?.mediaPermissions.videoGeneration === true;
  const autoImageMode = useMemo(() => detectImageGenerationMode(input, pendingAiImages.length), [input, pendingAiImages.length]);
  const effectiveImageGenerationMode = imageGenerationAllowed && !isVideoGenerationMode && !suppressAutoImageMode && (isImageGenerationMode || autoImageMode !== null);
  const activeVideoMessage = [...currentAiMessages].reverse().find(message => message.role === 'assistant' && message.status === 'streaming' && message.videoGenerationStage);

  const sync = useAiChatSync({ aiOwner, interactionEnabled, refreshAiSessions, currentSessionId, currentAiSession, patchMessage, setStreaming, setStreamingMessageId });
  const isGeneratingVideoTask = Boolean(isStreaming && (activeVideoMessage || sync.currentAiTaskTypeRef.current === 'video'));
  const actions = useAiChatActions({
    enabled: interactionEnabled,
    aiOwner,
    currentSessionId,
    aiSessions,
    setStreaming,
    setStreamingMessageId,
    selectSession,
    startServerTaskPolling: sync.startServerTaskPolling,
    syncServerAiSessions: sync.syncServerAiSessions,
    currentAiTaskIdRef: sync.currentAiTaskIdRef,
    currentAiSessionIdRef: sync.currentAiSessionIdRef,
    currentAiTaskTypeRef: sync.currentAiTaskTypeRef,
    input,
    pendingAiImages,
    pendingAiFiles,
    pendingAiVideoInputs,
    selectedImageProvider,
    effectiveImageGenerationMode,
    isVideoGenerationMode,
    setInput,
    setPendingAiImages,
    setPendingAiFiles,
    setPendingAiVideoInputs,
    setShowMoreActions,
    setIsImageGenerationMode,
    setIsVideoGenerationMode,
  });

  useEffect(() => {
    if (currentSessionId && aiSessions.some(session => session.id === currentSessionId)) return;
    if (aiSessions[0]) selectSession(aiSessions[0].id);
  }, [aiSessions, currentSessionId, selectSession]);
  useEffect(() => {
    if (!sidebarOpen) return;
    setShowMoreActions(false);
  }, [sidebarOpen]);
  useEffect(() => {
    if (!imageGenerationAllowed) {
      setIsImageGenerationMode(false);
      setSuppressAutoImageMode(false);
    }
    if (!videoGenerationAllowed) {
      setIsVideoGenerationMode(false);
      setPendingAiVideoInputs(createEmptyVideoGenerationInputs());
    }
  }, [imageGenerationAllowed, user, videoGenerationAllowed]);
  useEffect(() => {
    if (!input.trim()) setSuppressAutoImageMode(false);
  }, [input]);
  useEffect(() => () => { void cancelPressVoiceInput(); }, []);

  async function handleSendMessage() {
    if (!interactionEnabled) {
      if (authStatus === 'error') onRequireLogin();
      return;
    }
    if (isStreaming) {
      if (!isGeneratingVideoTask) sync.handleAbortAiResponse();
      return;
    }
    if ((!imageGenerationAllowed && effectiveImageGenerationMode) || (!videoGenerationAllowed && isVideoGenerationMode)) {
      onRequireLogin();
      return;
    }
    await actions.handleSendAiMessage();
  }
  async function handleAiVoiceInput(audioBlob: Blob) {
    if (!interactionEnabled) return;
    try {
      const transcript = await transcribeAiCallAudio(await blobToDataUrl(audioBlob), audioBlob.type || 'audio/wav');
      if (!transcript) throw new Error('未识别到有效语音内容');
      setInput(current => current.trim() ? `${current.trim()} ${transcript}` : transcript);
      setShowVoiceRecorder(false);
      window.setTimeout(() => composerRef.current?.focus(), 0);
    } catch (error) {
      console.error('Failed to transcribe AI voice input', error);
      alert(error instanceof Error ? error.message : '语音转文字失败，请稍后再试');
    }
  }
  async function handleAddAiImages(files: File[]) {
    if (!interactionEnabled) return;
    const images = files.filter(file => file.type.startsWith('image/'));
    if (!images.length) return;
    setIsUploadingImages(true);
    try {
      const compressed = await Promise.all(images.slice(0, 3).map(compressImage));
      setPendingAiImages(current => [...current, ...compressed].slice(0, 3));
    }
    catch (error) { console.error('Failed to process AI images', error); alert('图片处理失败，请换一张图片再试'); }
    finally { setIsUploadingImages(false); setShowMoreActions(false); }
  }
  async function handleAddAiVideoImages(
    files: File[],
    target: VideoImageTarget = aiVideoImageTargetRef.current,
  ): Promise<number> {
    if (!interactionEnabled) return 0;
    setIsUploadingImages(true);
    try {
      const selected = validateVideoInputFiles(
        files,
        target,
        pendingAiVideoInputs.referenceImages.length,
        pendingAiVideoInputs,
      );
      const compressed = await Promise.all(selected.map(compressVideoReferenceImage));
      setPendingAiVideoInputs(current => target === 'referenceImages'
        ? { ...current, referenceImages: [...current.referenceImages, ...compressed] }
        : { ...current, [target]: compressed[0] || current[target] });
      return compressed.length;
    }
    catch (error) { console.error('Failed to process video input images', error); alert(error instanceof Error ? error.message : '视频图片处理失败'); return 0; }
    finally { setIsUploadingImages(false); setShowMoreActions(false); }
  }
  function openAiVideoImagePicker(target: VideoImageTarget) {
    aiVideoImageTargetRef.current = target;
    aiVideoImageInputRef.current?.click();
  }
  function handleVideoInputModeChange(inputMode: VideoInputMode) {
    aiVideoImageTargetRef.current = inputMode === 'references' ? 'referenceImages' : 'image';
    setPendingAiVideoInputs(current => inputMode === 'references'
      ? { ...current, inputMode, image: '', lastFrame: '' }
      : { ...current, inputMode, referenceImages: [] });
  }
  function removePendingAiVideoInput(target: VideoImageTarget, index?: number) {
    setPendingAiVideoInputs(current => {
      if (target === 'referenceImages') {
        return {
          ...current,
          referenceImages: current.referenceImages.filter((_, itemIndex) => itemIndex !== index),
        };
      }
      if (target === 'image') {
        return { ...current, image: '', lastFrame: '' };
      }
      return { ...current, lastFrame: '' };
    });
  }
  async function handleAddAiFiles(files: File[]) {
    if (!interactionEnabled) return;
    const documents = files.filter(isAiDocumentFile);
    if (!documents.length) { alert('请选择 PDF、Word、TXT、表格等文档文件'); return; }
    setIsUploadingFile(true);
    try {
      const uploaded = await Promise.all(documents.slice(0, 3).map(async file => {
        return uploadAiDocument({
          fileName: file.name,
          fileData: await readFileAsDataUrl(file),
          mimeType: file.type,
        });
      }));
      setPendingAiFiles(current => [...current, ...uploaded].slice(0, 3));
    } catch (error) { console.error('Failed to upload AI files', error); alert(error instanceof Error ? error.message : '文件上传失败'); }
    finally { setIsUploadingFile(false); setShowMoreActions(false); }
  }
  async function handleDropFiles(files: File[]) {
    if (!interactionEnabled) return;
    if (isVideoGenerationMode) {
      const imageFiles = files.filter(file => file.type.startsWith('image/'));
      if (!imageFiles.length) {
        alert('视频模式下请拖入 PNG、JPEG 或 WebP 图片');
        return;
      }
      if (getVideoInputMode(pendingAiVideoInputs) === 'references') {
        const startReferenceIndex = pendingAiVideoInputs.referenceImages.length;
        const addedCount = await handleAddAiVideoImages(imageFiles, 'referenceImages');
        if (addedCount) setInput(current => appendVideoImageMarkers(current, startReferenceIndex, addedCount));
        return;
      }
      const target: VideoImageTarget = pendingAiVideoInputs.image ? 'lastFrame' : 'image';
      await handleAddAiVideoImages(imageFiles, target);
      return;
    }
    const images = files.filter(file => file.type.startsWith('image/'));
    const documents = files.filter(file => !file.type.startsWith('image/') && isAiDocumentFile(file));
    if (!images.length && !documents.length) { alert('拖拽上传支持图片、PDF、Word、TXT、表格等文档'); return; }
    if (images.length) await handleAddAiImages(images);
    if (documents.length) await handleAddAiFiles(documents);
  }
  async function handleStartPressVoiceInput() {
    if (!interactionEnabled || isPressRecordingVoice || isStreaming || isUploadingImages || isUploadingFile) return;
    try {
      pressVoiceRecorderRef.current = await createWavRecorder({ targetSampleRate: 16000, trimThreshold: 0.01, trimPaddingMs: 80, constraints: { sampleRate: 16000 }, onLevel: setPressVoiceLevel });
      setIsPressRecordingVoice(true);
    } catch (error) { console.error('Failed to start AI voice input', error); alert('无法开始录音，请检查麦克风权限'); }
  }
  async function cancelPressVoiceInput() {
    const recorder = pressVoiceRecorderRef.current;
    pressVoiceRecorderRef.current = null;
    setIsPressRecordingVoice(false); setPressVoiceLevel(0);
    if (recorder) { try { await recorder.cancel(); } catch (error) { console.error('Failed to cancel AI voice input', error); } }
  }
  async function handleStopPressVoiceInput() {
    const recorder = pressVoiceRecorderRef.current;
    if (!recorder) return;
    pressVoiceRecorderRef.current = null; setIsPressRecordingVoice(false); setPressVoiceLevel(0);
    try { const result = await recorder.stop(); if (result?.blob?.size) await handleAiVoiceInput(result.blob); }
    catch (error) { console.error('Failed to stop AI voice input', error); alert('语音识别失败，请重新再试一次'); }
  }

  const canSend = isVideoGenerationMode ? Boolean(input.trim()) : Boolean(input.trim() || pendingAiImages.length || pendingAiFiles.length);
  const sendButtonDisabled = !interactionEnabled || (isStreaming ? isGeneratingVideoTask : (!canSend || isUploadingImages || isUploadingFile));
  const composerPlaceholder = authStatus === 'loading'
    ? '正在确认登录状态...'
    : authStatus === 'error'
      ? '登录状态获取失败，请打开账户重试'
      : isVideoGenerationMode
        ? '描述你想生成的视频...'
        : effectiveImageGenerationMode
          ? '描述你想生成或编辑的图片...'
          : '给 AI 日常聊天助手发送消息...';
  return <div className="flex h-full min-w-0 flex-col bg-slate-50">
    <AiChatHeader authStatus={authStatus} user={user} sidebarOpen={sidebarOpen} onAccountClick={onAccountClick} />
    <div className="min-h-0 flex-1"><MessageList messages={currentAiMessages} isStreaming={isStreaming} streamingMessageId={streamingMessageId} onSuggestionClick={suggestion => { if (!interactionEnabled) { if (authStatus === 'error') onRequireLogin(); return; } void actions.handleQuickSuggestion(suggestion); }} /></div>
    <AiChatComposer
      isStreaming={isStreaming}
      loading={!interactionEnabled}
      isUploadingImages={isUploadingImages}
      isUploadingFile={isUploadingFile}
      sendButtonDisabled={sendButtonDisabled}
      input={input}
      placeholder={composerPlaceholder}
      showVoiceRecorder={showVoiceRecorder}
      isPressRecordingVoice={isPressRecordingVoice}
      pressVoiceLevel={pressVoiceLevel}
      showMoreActions={showMoreActions && !sidebarOpen}
      selectedImageProvider={selectedImageProvider}
      effectiveImageGenerationMode={effectiveImageGenerationMode}
      isVideoGenerationMode={isVideoGenerationMode}
      isGeneratingVideoTask={isGeneratingVideoTask}
      pendingAiImages={pendingAiImages}
      pendingAiFiles={pendingAiFiles}
      pendingAiVideoInputs={pendingAiVideoInputs}
      imageProviderOptions={IMAGE_PROVIDER_OPTIONS}
      composerRef={composerRef}
      aiImageInputRef={aiImageInputRef}
      aiFileInputRef={aiFileInputRef}
      aiVideoImageInputRef={aiVideoImageInputRef}
      mediaAuthenticated={authStatus === 'authenticated' && Boolean(user)}
      imageGenerationAllowed={imageGenerationAllowed}
      videoGenerationAllowed={videoGenerationAllowed}
      onRequireLogin={onRequireLogin}
      onInputChange={setInput}
      onSendMessage={() => void handleSendMessage()}
      onSelectImageProvider={provider => {
        setSelectedImageProvider(provider);
        setIsImageGenerationMode(true);
        setSuppressAutoImageMode(false);
        setIsVideoGenerationMode(false);
        setPendingAiVideoInputs(createEmptyVideoGenerationInputs());
      }}
      onToggleImageGenerationMode={() => {
        if (effectiveImageGenerationMode) {
          setIsImageGenerationMode(false);
          setSuppressAutoImageMode(true);
        } else {
          setIsImageGenerationMode(true);
          setSuppressAutoImageMode(false);
        }
        setIsVideoGenerationMode(false);
        setPendingAiVideoInputs(createEmptyVideoGenerationInputs());
      }}
      onToggleVideoGenerationMode={() => {
        if (!isStreaming) {
          setIsVideoGenerationMode(value => !value);
          setIsImageGenerationMode(false);
          setPendingAiImages([]);
          setPendingAiFiles([]);
        }
      }}
      onRemovePendingAiImage={index => setPendingAiImages(images => images.filter((_, i) => i !== index))}
      onRemovePendingAiFile={index => setPendingAiFiles(files => files.filter((_, i) => i !== index))}
      onRemovePendingAiVideoInput={removePendingAiVideoInput}
      onVideoInputModeChange={handleVideoInputModeChange}
        onVideoModelChange={videoModel => setPendingAiVideoInputs(current => normalizeVideoInputsForModel(current, videoModel))}
      onVideoDurationChange={durationSeconds => setPendingAiVideoInputs(current => ({ ...current, durationSeconds }))}
      onPickAiImages={event => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        void handleAddAiImages(files);
      }}
      onPickAiFiles={event => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        void handleAddAiFiles(files);
      }}
      onPickAiVideoImages={event => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        const target = aiVideoImageTargetRef.current;
        const startReferenceIndex = pendingAiVideoInputs.referenceImages.length;
        void handleAddAiVideoImages(files, target).then(addedCount => {
          if (target === 'referenceImages' && addedCount) {
            setInput(current => appendVideoImageMarkers(current, startReferenceIndex, addedCount));
          }
        });
      }}
      onVideoAspectRatioChange={aspectRatio => setPendingAiVideoInputs(current => ({ ...current, aspectRatio }))}
      onDropFiles={files => void handleDropFiles(files)}
      onCancelVoiceRecorder={() => void cancelPressVoiceInput().then(() => setShowVoiceRecorder(false))}
      onStartPressVoiceInput={handleStartPressVoiceInput}
      onStopPressVoiceInput={() => void handleStopPressVoiceInput()}
      onOpenMoreActions={() => {
        setShowMoreActions(value => !value);
      }}
      onOpenAiImagePicker={() => aiImageInputRef.current?.click()}
      onOpenAiFilePicker={() => aiFileInputRef.current?.click()}
      onOpenAiVideoImagePicker={openAiVideoImagePicker}
      onOpenVoiceRecorder={() => {
        void cancelPressVoiceInput();
        setShowVoiceRecorder(true);
      }}
    />
  </div>;
}
