import { useCallback, useEffect, useRef } from 'react';
import { cancelServerAiTask, fetchServerAiTask } from '@/services/api';
import type { Message, Session } from '@/types';
import type { AiTaskOwner } from '@/services/api';

interface UseAiChatSyncParams {
  aiOwner: AiTaskOwner;
  refreshAiSessions: (
    preferredSessionId?: string | null,
    shouldApply?: () => boolean,
  ) => Promise<Session[]>;
  currentSessionId: string | null;
  currentAiSession: Session | null;
  patchMessage: (sessionId: string, messageId: string, patch: Partial<Message>) => void;
  setStreaming: (streaming: boolean, controller?: AbortController | null) => void;
  setStreamingMessageId: (id: string | undefined) => void;
}

export function useAiChatSync({
  aiOwner,
  refreshAiSessions,
  currentSessionId,
  currentAiSession,
  patchMessage,
  setStreaming,
  setStreamingMessageId,
}: UseAiChatSyncParams) {
  const currentAiTaskIdRef = useRef<string | null>(null);
  const currentAiSessionIdRef = useRef<string | null>(null);
  const currentAiTaskTypeRef = useRef<'chat' | 'image' | 'video' | null>(null);
  const serverTaskPollTimerRef = useRef<number | null>(null);
  const serverTaskPollInFlightRef = useRef(false);
  const serverTaskPollStartedAtRef = useRef<number | null>(null);
  const settledTaskIdRef = useRef<string | null>(null);

  const stopServerTaskPolling = useCallback(() => {
    if (serverTaskPollTimerRef.current) {
      window.clearTimeout(serverTaskPollTimerRef.current);
      serverTaskPollTimerRef.current = null;
    }
    serverTaskPollInFlightRef.current = false;
    serverTaskPollStartedAtRef.current = null;
  }, []);

  const getNextPollDelay = useCallback(() => {
    const startedAt = serverTaskPollStartedAtRef.current;
    if (!startedAt) {
      return 250;
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs < 6_000) {
      return 250;
    }
    if (elapsedMs < 12_000) {
      return 500;
    }
    if (elapsedMs < 18_000) {
      return 700;
    }
    if (elapsedMs < 25_000) {
      return 1100;
    }
    if (elapsedMs < 45_000) {
      return 1600;
    }
    return 2200;
  }, []);

  const syncServerAiSessions = refreshAiSessions;

  const pollServerTask = useCallback(async (taskId: string, preferredSessionId?: string | null) => {
    if (serverTaskPollInFlightRef.current) {
      return;
    }

    serverTaskPollInFlightRef.current = true;
    try {
      const task = await fetchServerAiTask(taskId, aiOwner);
      if (currentAiTaskIdRef.current !== taskId) {
        return;
      }

      currentAiTaskTypeRef.current = task.type;
      const targetSessionId = preferredSessionId || task.sessionId;

      const hasPartialContent = typeof task.content === 'string' && task.content.length > 0;
      const hasPartialImages = Array.isArray(task.images) && task.images.length > 0;
      const hasPartialFiles = Array.isArray(task.files) && task.files.length > 0;
      const hasAudioUrl = typeof task.audioUrl === 'string' && task.audioUrl.length > 0;
      const hasAudioDuration = typeof task.duration === 'number' && Number.isFinite(task.duration) && task.duration > 0;
      const hasAudioMimeType = typeof task.audioMimeType === 'string' && task.audioMimeType.length > 0;
      const hasImageData = task.type === 'image' && Boolean(task.imageStage || hasPartialImages || task.imageFileName);
      const hasVideoData = Boolean(task.videoStage || task.videoUrl);

      if (targetSessionId && task.messageId && (hasPartialContent || hasPartialImages || hasPartialFiles || hasAudioUrl || hasAudioDuration || hasAudioMimeType || hasImageData || hasVideoData)) {
        patchMessage(targetSessionId, task.messageId, {
          ...(hasPartialContent ? { content: task.content } : {}),
          ...(hasPartialImages ? { images: task.images } : {}),
          ...(hasPartialFiles ? { files: task.files } : {}),
          ...(hasAudioUrl ? { audioUrl: task.audioUrl } : {}),
          ...(hasAudioDuration ? { duration: task.duration } : {}),
          ...(hasAudioMimeType ? { audioMimeType: task.audioMimeType } : {}),
          ...(typeof task.progressPercent === 'number' ? { progressPercent: task.progressPercent } : {}),
          ...(task.type === 'image' ? {
            imageGenerationStage: task.imageStage,
            imageFileName: task.imageFileName,
            imageFileSize: task.imageFileSize,
            imageMimeType: task.imageMimeType,
            imageWidth: task.imageWidth,
            imageHeight: task.imageHeight,
            imageProvider: task.imageProvider,
            progressPercent: undefined,
          } : {}),
          ...(task.videoUrl ? { videoUrl: task.videoUrl } : {}),
          ...(task.videoMimeType ? { videoMimeType: task.videoMimeType } : {}),
          ...(task.videoFileName ? { videoFileName: task.videoFileName } : {}),
          ...(typeof task.videoFileSize === 'number' ? { videoFileSize: task.videoFileSize } : {}),
          ...(typeof task.videoDuration === 'number' ? { videoDuration: task.videoDuration } : {}),
          ...(typeof task.videoWidth === 'number' ? { videoWidth: task.videoWidth } : {}),
          ...(typeof task.videoHeight === 'number' ? { videoHeight: task.videoHeight } : {}),
          ...(task.videoStage ? { videoGenerationStage: task.videoStage } : {}),
          status: task.status === 'failed'
            ? 'error'
            : (task.status === 'completed' || task.status === 'cancelled' ? 'sent' : 'streaming'),
        });
      }

      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        settledTaskIdRef.current = taskId;
        stopServerTaskPolling();
        setStreaming(false, null);
        setStreamingMessageId(undefined);
        let serverSessions: Session[];
        try {
          serverSessions = await syncServerAiSessions(
            targetSessionId,
            () => currentAiTaskIdRef.current === taskId,
          );
        } catch (syncError) {
          console.error('Failed to refresh AI sessions after task completion', syncError);
          return;
        }
        if (currentAiTaskIdRef.current !== taskId) {
          return;
        }

        const refreshedSession = serverSessions.find(session => session.id === targetSessionId);
        if (refreshedSession?.pendingTaskId === taskId) {
          return;
        }

        currentAiTaskIdRef.current = null;
        currentAiSessionIdRef.current = null;
        currentAiTaskTypeRef.current = null;
        settledTaskIdRef.current = null;
      }
    } catch (error) {
      if (currentAiTaskIdRef.current !== taskId) {
        return;
      }

      console.error('Failed to poll AI task', error);
      try {
        const sessions = await syncServerAiSessions(
          preferredSessionId,
          () => currentAiTaskIdRef.current === taskId,
        );
        if (currentAiTaskIdRef.current !== taskId) {
          return;
        }

        const activeSession = preferredSessionId
          ? sessions.find(session => session.id === preferredSessionId)
          : sessions.find(session => session.id === currentSessionId);

        if (!activeSession?.pendingTaskId) {
          stopServerTaskPolling();
          setStreaming(false, null);
          setStreamingMessageId(undefined);
          currentAiTaskIdRef.current = null;
          currentAiSessionIdRef.current = null;
          currentAiTaskTypeRef.current = null;
        }
      } catch (syncError) {
        console.error('Failed to resync AI sessions after poll error', syncError);
      }
    } finally {
      serverTaskPollInFlightRef.current = false;
    }
  }, [aiOwner, currentSessionId, patchMessage, setStreaming, setStreamingMessageId, stopServerTaskPolling, syncServerAiSessions]);

  const startServerTaskPolling = useCallback((taskId: string, preferredSessionId?: string | null) => {
    const scheduleNextPoll = () => {
      serverTaskPollTimerRef.current = window.setTimeout(async () => {
        await pollServerTask(taskId, preferredSessionId);
        if (currentAiTaskIdRef.current === taskId && settledTaskIdRef.current !== taskId) {
          scheduleNextPoll();
        }
      }, getNextPollDelay());
    };

    stopServerTaskPolling();
    settledTaskIdRef.current = null;
    currentAiTaskIdRef.current = taskId;
    serverTaskPollStartedAtRef.current = Date.now();
    void pollServerTask(taskId, preferredSessionId).finally(() => {
      if (currentAiTaskIdRef.current === taskId && settledTaskIdRef.current !== taskId) {
        scheduleNextPoll();
      }
    });
  }, [getNextPollDelay, pollServerTask, stopServerTaskPolling]);

  const handleAbortAiResponse = useCallback(() => {
    const taskId = currentAiTaskIdRef.current;
    if (taskId) {
      const hasPendingVideoMessage = currentAiSession?.messages.some(message => (
        message.status === 'streaming' && Boolean(message.videoGenerationStage)
      ));
      if (currentAiTaskTypeRef.current === 'video' || hasPendingVideoMessage) {
        return;
      }
      void (async () => {
        const lastSessionId = currentAiSessionIdRef.current;
        try {
          await cancelServerAiTask(taskId, aiOwner);
        } catch (error) {
          console.error('Failed to cancel AI task', error);
          return;
        }

        if (currentAiTaskIdRef.current !== taskId) {
          return;
        }

        settledTaskIdRef.current = taskId;
        stopServerTaskPolling();
        setStreaming(false, null);
        setStreamingMessageId(undefined);
        let serverSessions: Session[];
        try {
          serverSessions = await syncServerAiSessions(
            lastSessionId,
            () => currentAiTaskIdRef.current === taskId,
          );
        } catch (error) {
          console.error('Failed to refresh AI sessions after cancellation', error);
          return;
        }

        if (currentAiTaskIdRef.current !== taskId) {
          return;
        }

        const refreshedSession = serverSessions.find(session => session.id === lastSessionId);
        if (refreshedSession?.pendingTaskId === taskId) {
          return;
        }

        currentAiTaskIdRef.current = null;
        currentAiSessionIdRef.current = null;
        currentAiTaskTypeRef.current = null;
        settledTaskIdRef.current = null;
      })();
    }
  }, [aiOwner, currentAiSession, currentAiSessionIdRef, setStreaming, setStreamingMessageId, stopServerTaskPolling, syncServerAiSessions]);

  useEffect(() => () => {
    stopServerTaskPolling();
  }, [stopServerTaskPolling]);

  useEffect(() => {
    const pendingTaskId = currentAiSession?.pendingTaskId;
    if (!pendingTaskId) {
      if (currentAiTaskIdRef.current) {
        stopServerTaskPolling();
        currentAiTaskIdRef.current = null;
        currentAiTaskTypeRef.current = null;
        settledTaskIdRef.current = null;
        setStreaming(false, null);
        setStreamingMessageId(undefined);
      }
      return;
    }

    if (currentAiTaskIdRef.current === pendingTaskId) {
      return;
    }

    currentAiSessionIdRef.current = currentAiSession?.id || null;
    const pendingMessage = [...(currentAiSession?.messages || [])].reverse().find(message => message.status === 'streaming');
    setStreaming(true, null);
    setStreamingMessageId(pendingMessage?.id);
    startServerTaskPolling(pendingTaskId, currentAiSession?.id || null);
  }, [currentAiSession, setStreaming, setStreamingMessageId, startServerTaskPolling, stopServerTaskPolling]);

  return {
    currentAiTaskIdRef,
    currentAiSessionIdRef,
    currentAiTaskTypeRef,
    syncServerAiSessions,
    startServerTaskPolling,
    stopServerTaskPolling,
    handleAbortAiResponse,
  };
}
