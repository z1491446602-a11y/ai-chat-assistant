import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  createClientRequestId,
  createServerAiChatTask,
  createServerAiImageTask,
  createServerAiSession,
  createServerAiVideoTask,
  type AiTaskOwner,
  type ImageGenerationProvider,
} from '@/services/api';
import { isUnauthorizedError } from '@/services/http';
import { useSettingsStore } from '@/store';
import type { APIConfig, MessageFile, Session } from '@/types';

interface UseAiChatActionsParams {
  enabled: boolean;
  aiOwner: AiTaskOwner;
  currentSessionId: string | null;
  aiSessions: Session[];
  setStreaming: (streaming: boolean, controller?: AbortController | null) => void;
  setStreamingMessageId: (id: string | undefined) => void;
  selectSession: (id: string) => void;
  startServerTaskPolling: (taskId: string, sessionId: string) => void;
  syncServerAiSessions: (sessionId: string) => Promise<unknown> | void;
  currentAiTaskIdRef: MutableRefObject<string | null>;
  currentAiSessionIdRef: MutableRefObject<string | null>;
  currentAiTaskTypeRef: MutableRefObject<'chat' | 'image' | 'video' | null>;
  input: string;
  pendingAiImages: string[];
  pendingAiFiles: MessageFile[];
  pendingAiVideoImages: string[];
  selectedImageProvider: ImageGenerationProvider;
  effectiveImageGenerationMode: boolean;
  isVideoGenerationMode: boolean;
  setInput: Dispatch<SetStateAction<string>>;
  setPendingAiImages: Dispatch<SetStateAction<string[]>>;
  setPendingAiFiles: Dispatch<SetStateAction<MessageFile[]>>;
  setPendingAiVideoImages: Dispatch<SetStateAction<string[]>>;
  setShowMoreActions: Dispatch<SetStateAction<boolean>>;
  setShowImageProviderMenu: Dispatch<SetStateAction<boolean>>;
  setIsImageGenerationMode: Dispatch<SetStateAction<boolean>>;
  setIsVideoGenerationMode: Dispatch<SetStateAction<boolean>>;
}

export function useAiChatActions({
  enabled,
  aiOwner,
  currentSessionId,
  aiSessions,
  setStreaming,
  setStreamingMessageId,
  selectSession,
  startServerTaskPolling,
  syncServerAiSessions,
  currentAiTaskIdRef,
  currentAiSessionIdRef,
  currentAiTaskTypeRef,
  input,
  pendingAiImages,
  pendingAiFiles,
  pendingAiVideoImages,
  selectedImageProvider,
  effectiveImageGenerationMode,
  isVideoGenerationMode,
  setInput,
  setPendingAiImages,
  setPendingAiFiles,
  setPendingAiVideoImages,
  setShowMoreActions,
  setShowImageProviderMenu,
  setIsImageGenerationMode,
  setIsVideoGenerationMode,
}: UseAiChatActionsParams) {
  const resetComposerState = () => {
    setInput('');
    setPendingAiImages([]);
    setPendingAiFiles([]);
    setPendingAiVideoImages([]);
    setShowMoreActions(false);
    setShowImageProviderMenu(false);
    setIsImageGenerationMode(false);
    setIsVideoGenerationMode(false);
  };

  const resetStreamingState = async (shouldSyncSessions = true) => {
    setStreaming(false, null);
    setStreamingMessageId(undefined);
    currentAiTaskIdRef.current = null;
    currentAiSessionIdRef.current = null;
    currentAiTaskTypeRef.current = null;
    if (shouldSyncSessions && currentSessionId) {
      await syncServerAiSessions(currentSessionId);
    }
  };

  const resolveSessionId = async (model: string) => {
    let sessionId = currentSessionId && aiSessions.some((session) => session.id === currentSessionId)
      ? currentSessionId
      : (aiSessions[0]?.id || null);

    if (!sessionId) {
      const session = await createServerAiSession(aiOwner, model);
      sessionId = session.id;
      await syncServerAiSessions(session.id);
    }

    return sessionId;
  };

  const submitAiMessage = async (
    content: string,
    images: string[] = [],
    files: MessageFile[] = [],
    overrideConfig?: Partial<APIConfig>,
  ) => {
    if (!content && images.length === 0 && files.length === 0) {
      return;
    }

    const latestApiConfig = {
      ...useSettingsStore.getState().apiConfig,
      model: 'deepseek-v4',
      ...(overrideConfig || {}),
    };
    const sessionId = await resolveSessionId(latestApiConfig.model);

    setStreaming(true, null);
    let result;
    try {
      result = await createServerAiChatTask(aiOwner, sessionId, content, images, files, latestApiConfig);
    } catch (error) {
      await resetStreamingState(!isUnauthorizedError(error));
      throw error;
    }

    currentAiTaskIdRef.current = result.task.id;
    currentAiSessionIdRef.current = result.sessionId;
    currentAiTaskTypeRef.current = result.task.type;
    setStreamingMessageId(result.messageId);
    selectSession(result.sessionId);
    startServerTaskPolling(result.task.id, result.sessionId);
    void syncServerAiSessions(result.sessionId);
  };

  const submitAiImageGeneration = async (prompt: string, images: string[] = []) => {
    const imageModel = selectedImageProvider === 'grok'
      ? 'grok-imagine-image-quality'
      : 'gpt-image-2';
    const sessionId = await resolveSessionId(imageModel);
    const requestId = createClientRequestId();

    setStreaming(true, null);
    let result;
    try {
      result = await createServerAiImageTask(
        aiOwner,
        sessionId,
        prompt,
        images,
        selectedImageProvider,
        requestId,
      );
    } catch (error) {
      await resetStreamingState(!isUnauthorizedError(error));
      throw error;
    }

    currentAiTaskIdRef.current = result.task.id;
    currentAiSessionIdRef.current = result.sessionId;
    currentAiTaskTypeRef.current = result.task.type;
    setStreamingMessageId(result.messageId);
    selectSession(result.sessionId);
    startServerTaskPolling(result.task.id, result.sessionId);
    void syncServerAiSessions(result.sessionId);
  };

  const submitAiVideoGeneration = async (prompt: string, images: string[] = []) => {
    const sessionId = await resolveSessionId('veo_3_1_fast');
    const requestId = createClientRequestId();

    setStreaming(true, null);
    let result;
    try {
      result = await createServerAiVideoTask(aiOwner, sessionId, prompt, images, requestId);
    } catch (error) {
      await resetStreamingState(!isUnauthorizedError(error));
      throw error;
    }

    currentAiTaskIdRef.current = result.task.id;
    currentAiSessionIdRef.current = result.sessionId;
    currentAiTaskTypeRef.current = 'video';
    setStreamingMessageId(result.messageId);
    selectSession(result.sessionId);
    startServerTaskPolling(result.task.id, result.sessionId);
    void syncServerAiSessions(result.sessionId);
  };

  const handleSendAiMessage = async () => {
    if (!enabled) {
      return;
    }

    const rawContent = input.trim();
    const images = [...pendingAiImages];
    const files = [...pendingAiFiles];
    const videoImages = [...pendingAiVideoImages];
    const shouldGenerateImage = effectiveImageGenerationMode;

    if (isVideoGenerationMode && !rawContent) {
      alert('请输入视频生成提示词');
      return;
    }

    if (!rawContent && images.length === 0 && files.length === 0) {
      return;
    }

    resetComposerState();

    try {
      if (isVideoGenerationMode) {
        await submitAiVideoGeneration(rawContent, videoImages);
        return;
      }

      if (shouldGenerateImage) {
        await submitAiImageGeneration(rawContent, images);
        return;
      }

      await submitAiMessage(rawContent, images, files);
    } catch (error) {
      console.error('Failed to send AI message', error);
      alert(error instanceof Error ? error.message : '发送失败，请稍后重试');
    }
  };

  const handleQuickSuggestion = async (suggestion: string) => {
    if (!enabled) {
      return;
    }

    resetComposerState();
    try {
      await submitAiMessage(suggestion);
    } catch (error) {
      console.error('Failed to send quick AI suggestion', error);
      if (!isUnauthorizedError(error)) {
        alert('发送快捷问题失败，请稍后重试');
      }
    }
  };

  return {
    handleSendAiMessage,
    handleQuickSuggestion,
  };
}
