import { useCallback, useEffect, useRef } from 'react';
import { cancelServerAiTask, fetchServerAiTask } from '@/services/api';
import { isUnauthorizedError } from '@/services/http';
import type { Message, Session } from '@/types';
import type { AiTaskOwner } from '@/services/api';

interface UseAiChatSyncParams {
  aiOwner: AiTaskOwner;
  interactionEnabled?: boolean;
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
  interactionEnabled = true,
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
  const serverTaskPollStartedAtRef = useRef<number | null>(null);
  const settledTaskIdRef = useRef<string | null>(null);
  const pollGenerationRef = useRef(0);
  const activePollGenerationRef = useRef<number | null>(null);
  const inFlightGenerationRef = useRef<number | null>(null);

  const stopServerTaskPolling = useCallback(() => {
    pollGenerationRef.current += 1;
    activePollGenerationRef.current = null;
    if (serverTaskPollTimerRef.current !== null) {
      window.clearTimeout(serverTaskPollTimerRef.current);
      serverTaskPollTimerRef.current = null;
    }
    serverTaskPollStartedAtRef.current = null;
  }, []);

  const isActivePoll = useCallback((
    taskId: string,
    taskSessionId: string | null,
    generation: number,
  ) => (
    interactionEnabled
    && activePollGenerationRef.current === generation
    && currentAiTaskIdRef.current === taskId
    && currentAiSessionIdRef.current === taskSessionId
  ), [interactionEnabled]);

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

  const pollServerTask = useCallback(async (
    taskId: string,
    taskSessionId: string | null,
    generation: number,
  ) => {
    if (!isActivePoll(taskId, taskSessionId, generation)) {
      return;
    }

    if (inFlightGenerationRef.current === generation) {
      return;
    }

    inFlightGenerationRef.current = generation;
    try {
      const task = await fetchServerAiTask(taskId, aiOwner);
      if (!isActivePoll(taskId, taskSessionId, generation)) {
        return;
      }

      currentAiTaskTypeRef.current = task.type;
      const targetSessionId = taskSessionId || task.sessionId;

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
      if (isUnauthorizedError(error)) {
        if (
          currentAiTaskIdRef.current !== taskId
          || currentAiSessionIdRef.current !== taskSessionId
        ) {
          return;
        }
        stopServerTaskPolling();
        setStreaming(false, null);
        setStreamingMessageId(undefined);
        currentAiTaskIdRef.current = null;
        currentAiSessionIdRef.current = null;
        currentAiTaskTypeRef.current = null;
        settledTaskIdRef.current = null;
        return;
      }

      if (!isActivePoll(taskId, taskSessionId, generation)) {
        return;
      }

      console.error('Failed to poll AI task', error);
      try {
        const sessions = await syncServerAiSessions(
          taskSessionId,
          () => isActivePoll(taskId, taskSessionId, generation),
        );
        if (!isActivePoll(taskId, taskSessionId, generation)) {
          return;
        }

        const activeSession = taskSessionId
          ? sessions.find(session => session.id === taskSessionId)
          : undefined;

        if (taskSessionId && (!activeSession || activeSession.pendingTaskId !== taskId)) {
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
      if (inFlightGenerationRef.current === generation) {
        inFlightGenerationRef.current = null;
      }
    }
  }, [aiOwner, isActivePoll, patchMessage, setStreaming, setStreamingMessageId, stopServerTaskPolling, syncServerAiSessions]);

  const startServerTaskPolling = useCallback((taskId: string, preferredSessionId?: string | null) => {
    const taskSessionId = preferredSessionId || currentAiSessionIdRef.current;

    stopServerTaskPolling();
    settledTaskIdRef.current = null;
    currentAiTaskIdRef.current = taskId;
    currentAiSessionIdRef.current = taskSessionId;

    if (!interactionEnabled) {
      return;
    }

    const generation = ++pollGenerationRef.current;
    activePollGenerationRef.current = generation;
    serverTaskPollStartedAtRef.current = Date.now();

    const scheduleNextPoll = () => {
      if (!isActivePoll(taskId, taskSessionId, generation)) {
        return;
      }
      serverTaskPollTimerRef.current = window.setTimeout(async () => {
        serverTaskPollTimerRef.current = null;
        await pollServerTask(taskId, taskSessionId, generation);
        if (
          isActivePoll(taskId, taskSessionId, generation)
          && settledTaskIdRef.current !== taskId
        ) {
          scheduleNextPoll();
        }
      }, getNextPollDelay());
    };

    void pollServerTask(taskId, taskSessionId, generation).finally(() => {
      if (
        isActivePoll(taskId, taskSessionId, generation)
        && settledTaskIdRef.current !== taskId
      ) {
        scheduleNextPoll();
      }
    });
  }, [getNextPollDelay, interactionEnabled, isActivePoll, pollServerTask, stopServerTaskPolling]);

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
    if (!interactionEnabled) {
      stopServerTaskPolling();
      setStreaming(false, null);
      setStreamingMessageId(undefined);
      return;
    }

    const pendingTaskId = currentAiSession?.pendingTaskId;
    if (!pendingTaskId) {
      if (currentAiTaskIdRef.current) {
        const taskSessionId = currentAiSessionIdRef.current;
        if (!currentAiSession || !taskSessionId || currentAiSession.id !== taskSessionId) {
          stopServerTaskPolling();
          setStreaming(false, null);
          setStreamingMessageId(undefined);
          return;
        }

        stopServerTaskPolling();
        currentAiTaskIdRef.current = null;
        currentAiSessionIdRef.current = null;
        currentAiTaskTypeRef.current = null;
        settledTaskIdRef.current = null;
        setStreaming(false, null);
        setStreamingMessageId(undefined);
      }
      return;
    }

    const pendingSessionId = currentAiSession?.id || currentSessionId;
    const isSameTask = currentAiTaskIdRef.current === pendingTaskId
      && currentAiSessionIdRef.current === pendingSessionId;
    if (
      isSameTask
      && (
        activePollGenerationRef.current !== null
        || settledTaskIdRef.current === pendingTaskId
      )
    ) {
      return;
    }

    currentAiSessionIdRef.current = pendingSessionId;
    const pendingMessage = [...(currentAiSession?.messages || [])].reverse().find(message => message.status === 'streaming');
    currentAiTaskTypeRef.current = pendingMessage?.videoGenerationStage
      ? 'video'
      : pendingMessage?.imageGenerationStage
        ? 'image'
        : currentAiTaskTypeRef.current;
    setStreaming(true, null);
    setStreamingMessageId(pendingMessage?.id);
    startServerTaskPolling(pendingTaskId, pendingSessionId);
  }, [currentAiSession, currentSessionId, interactionEnabled, setStreaming, setStreamingMessageId, startServerTaskPolling, stopServerTaskPolling]);

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
