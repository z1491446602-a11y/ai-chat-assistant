import {
  MediaTaskQueueCancelledError,
  MediaTaskQueueFullError,
} from './mediaTaskScheduler.js';
import { toPublicAiErrorMessage } from './publicAiErrors.js';

export const DEFAULT_SETTLEMENT_RETRY_DELAYS_MS = Object.freeze([250, 1_000, 4_000]);
const MAX_SETTLEMENT_RETRY_DELAYS = 5;

function normalizePositiveLimit(value, fallback) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : fallback;
}

export function createChatTaskScheduler(options = {}) {
  const maxConcurrent = normalizePositiveLimit(options.maxConcurrent, 8);
  const maxQueued = normalizePositiveLimit(options.maxQueued, 32);
  const ownerMaxConcurrent = normalizePositiveLimit(options.ownerMaxConcurrent, 1);
  const maxQueuedPerOwner = normalizePositiveLimit(options.maxQueuedPerOwner, 4);
  const queue = [];
  const activeJobs = new Map();
  const activeByOwner = new Map();

  const getOwnerActiveCount = ownerId => activeByOwner.get(ownerId) || 0;

  function canStart(job) {
    return activeJobs.size < maxConcurrent
      && getOwnerActiveCount(job.ownerId) < ownerMaxConcurrent;
  }

  function pump() {
    while (activeJobs.size < maxConcurrent && queue.length) {
      const nextIndex = queue.findIndex(canStart);
      if (nextIndex === -1) return;
      const [job] = queue.splice(nextIndex, 1);
      start(job);
    }
  }

  function release(job) {
    activeJobs.delete(job.id);
    const nextOwnerCount = getOwnerActiveCount(job.ownerId) - 1;
    if (nextOwnerCount > 0) activeByOwner.set(job.ownerId, nextOwnerCount);
    else activeByOwner.delete(job.ownerId);
    pump();
  }

  function start(job) {
    activeJobs.set(job.id, job);
    activeByOwner.set(job.ownerId, getOwnerActiveCount(job.ownerId) + 1);
    Promise.resolve()
      .then(job.run)
      .then(job.resolve, job.reject)
      .finally(() => release(job));
  }

  function schedule(input) {
    const id = String(input?.id || '').trim();
    const ownerId = String(input?.ownerId || '').trim();
    if (!id || !ownerId || typeof input?.run !== 'function') {
      return Promise.reject(new TypeError('聊天任务参数不完整'));
    }
    if (activeJobs.has(id) || queue.some(job => job.id === id)) {
      return Promise.reject(new TypeError(`聊天任务已存在: ${id}`));
    }

    const job = { ...input, id, ownerId };
    if (!canStart(job)) {
      const queuedForOwner = queue.filter(item => item.ownerId === ownerId).length;
      if (queue.length >= maxQueued || queuedForOwner >= maxQueuedPerOwner) {
        return Promise.reject(new MediaTaskQueueFullError('聊天服务繁忙，请稍后重试'));
      }
    }

    const promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    if (canStart(job)) start(job);
    else queue.push(job);
    return promise;
  }

  function cancel(taskId) {
    const id = String(taskId || '').trim();
    const index = queue.findIndex(job => job.id === id);
    if (index === -1) return false;
    const [job] = queue.splice(index, 1);
    job.reject(new MediaTaskQueueCancelledError('聊天任务已取消'));
    return true;
  }

  function getQueuePosition(taskId) {
    const index = queue.findIndex(job => job.id === String(taskId || '').trim());
    return index === -1 ? 0 : index + 1;
  }

  return { schedule, cancel, getQueuePosition };
}

export function reconcileMediaRequestOrphans({
  mediaRequestService,
  activeTaskIds = [],
  pointReservations = {},
  getAiSessions,
  findAiSession,
  patchAiMessage,
  clearAiSessionTask,
  settleMediaTask,
  videoJobStore,
} = {}) {
  const result = {
    activeCount: 0,
    completedCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    abortedCount: 0,
    terminalPendingClearedCount: 0,
    errors: [],
  };
  if (typeof mediaRequestService?.getRecoveryPlan !== 'function') {
    return result;
  }

  const plan = mediaRequestService.getRecoveryPlan(activeTaskIds);
  const activeIds = new Set((activeTaskIds || []).map(taskId => String(taskId || '').trim()));
  const linkedTaskIds = new Set([
    ...(plan.activeAccepted || []),
    ...(plan.orphanAccepted || []),
    ...(plan.terminalLinked || []),
  ].map(record => String(record?.taskId || '').trim()).filter(Boolean));
  const processedClaimedTaskIds = new Set();
  result.activeCount = plan.activeAccepted.length;
  for (const record of plan.claimed || []) {
    try {
      const ownerRef = { userId: record.userId };
      const interruptedReservations = Object.values(pointReservations || {}).filter((reservation) => {
        const taskId = String(reservation?.taskId || '').trim();
        return reservation?.status === 'reserved'
          && reservation?.userId === record.userId
          && reservation?.taskType === record.mediaType
          && taskId
          && !activeIds.has(taskId)
          && !linkedTaskIds.has(taskId)
          && !processedClaimedTaskIds.has(taskId);
      });
      for (const reservation of interruptedReservations) {
        const taskId = String(reservation.taskId).trim();
        const sessions = typeof getAiSessions === 'function' ? getAiSessions(ownerRef) : [];
        for (const session of Array.isArray(sessions) ? sessions : []) {
          if (String(session?.pendingTaskId || '') !== taskId) continue;
          if (clearAiSessionTask(ownerRef, session.id, taskId)) {
            result.terminalPendingClearedCount += 1;
          }
        }
        settleMediaTask(taskId, false);
        processedClaimedTaskIds.add(taskId);
      }
      mediaRequestService.abort(record.key);
      result.abortedCount += 1;
    } catch (error) {
      result.errors.push({ taskId: '', error });
    }
  }
  for (const record of plan.terminalLinked || []) {
    try {
      const ownerRef = { userId: record.userId };
      const session = findAiSession(ownerRef, record.sessionId);
      if (String(session?.pendingTaskId || '') !== String(record.taskId || '')) {
        continue;
      }
      if (clearAiSessionTask(ownerRef, record.sessionId, record.taskId)) {
        result.terminalPendingClearedCount += 1;
      }
    } catch (error) {
      result.errors.push({ taskId: record.taskId, error });
    }
  }
  for (const record of plan.orphanAccepted) {
    try {
      const ownerRef = { userId: record.userId };
      const session = findAiSession(ownerRef, record.sessionId);
      const message = session?.messages?.find(item => String(item.id) === String(record.messageId));
      const videoJob = record.mediaType === 'video' && typeof videoJobStore?.getVideoJob === 'function'
        ? videoJobStore.getVideoJob(record.taskId)
        : null;

      if (!session || !message) {
        settleMediaTask(record.taskId, false);
        try {
          clearAiSessionTask(ownerRef, record.sessionId, record.taskId);
        } catch (error) {
          console.error(`Failed to clear missing media request session ${record.taskId}:`, error);
        }
        mediaRequestService.recoverAccepted(record.key, 'aborted');
        result.abortedCount += 1;
        continue;
      }

      const hasSuccessfulResult = record.mediaType === 'video'
        ? Boolean(String(message.videoUrl || '').trim())
        : (Array.isArray(message.images) && message.images.length > 0);
      const stopped = /已停止|已取消/u.test(String(message.content || ''));
      const persistedFailure = message.status === 'error'
        || ['failed', 'cancelled', 'canceled'].includes(String(videoJob?.status || '').toLowerCase());
      let terminalStatus;
      if (hasSuccessfulResult && message.status === 'sent') {
        terminalStatus = 'completed';
      } else if (stopped || ['cancelled', 'canceled'].includes(String(videoJob?.status || '').toLowerCase())) {
        terminalStatus = 'cancelled';
      } else if (persistedFailure) {
        terminalStatus = 'failed';
      } else {
        const content = record.mediaType === 'video'
          ? '视频任务已中断，请重新提交。'
          : '图片生成已中断，请重新提交。';
        patchAiMessage(ownerRef, record.sessionId, record.messageId, {
          content,
          imageGenerationStage: undefined,
          videoGenerationStage: undefined,
          progressPercent: undefined,
          status: 'error',
        });
        if (record.mediaType === 'video' && videoJob && typeof videoJobStore?.patchVideoJob === 'function') {
          videoJobStore.patchVideoJob(record.taskId, {
            status: 'failed',
            stage: videoJob.stage || 'submitting',
            error: content,
            upstreamTaskId: videoJob.upstreamTaskId,
          });
        }
        terminalStatus = 'failed';
      }

      settleMediaTask(record.taskId, terminalStatus === 'completed');
      try {
        clearAiSessionTask(ownerRef, record.sessionId, record.taskId);
      } catch (error) {
        console.error(`Failed to clear reconciled media request session ${record.taskId}:`, error);
      }
      mediaRequestService.terminal(record.key, terminalStatus);
      result[`${terminalStatus}Count`] += 1;
    } catch (error) {
      result.errors.push({ taskId: record.taskId, error });
    }
  }
  if (typeof mediaRequestService.prune === 'function') {
    try {
      mediaRequestService.prune();
    } catch (error) {
      result.errors.push({ taskId: '', error });
    }
  }
  return result;
}

export function createAiTaskStore({
  findAiSession,
  upsertAiSession,
  patchAiMessage,
  clearAiSessionTask,
  sanitizeAiMessage,
  buildVoiceReplyMessages,
  ensureVoiceReplyText,
  performVoiceSynthesis,
  performStreamingChatCompletion,
  performImageGeneration,
  videoProvider,
  videoFileStore,
  videoJobStore,
  isKittyVoiceModel,
  resolveKittyVoiceProfile,
  VOICE_STREAMING_TEXT,
  VOICE_REPLY_TEMPERATURE,
  VOICE_REPLY_MAX_TOKENS,
  VOICE_REPLY_TOP_P,
  mediaTaskScheduler,
  chatTaskScheduler,
  settleMediaTask = () => {},
  terminalMediaRequest = () => {},
  getMediaRequestKeyForTask = () => '',
  settlementRetryDelaysMs = DEFAULT_SETTLEMENT_RETRY_DELAYS_MS,
  taskRetentionMs = 30 * 60 * 1000,
}) {
  const aiTasks = new Map();
  const scheduler = mediaTaskScheduler || {
    schedule: ({ run }) => run(),
    cancel: () => false,
    getQueuePosition: () => 0,
  };
  const chatScheduler = chatTaskScheduler || createChatTaskScheduler();
  const settlementRetryDelays = (Array.isArray(settlementRetryDelaysMs)
    ? settlementRetryDelaysMs
    : DEFAULT_SETTLEMENT_RETRY_DELAYS_MS)
    .map(delay => Number(delay))
    .filter(delay => Number.isFinite(delay) && delay >= 0)
    .slice(0, MAX_SETTLEMENT_RETRY_DELAYS);
  const videoStageContent = {
    submitting: '正在提交视频任务...',
    queued: '视频任务已排队...',
    processing: '视频正在生成中...',
    downloading: '正在下载视频...',
    validating: '正在验证并保存视频...',
  };

  function getImageTaskProgressText(task, stage = 'generating') {
    const isEdit = Array.isArray(task?.images) && task.images.length > 0;

    switch (stage) {
      case 'submitting':
        return isEdit ? '正在提交图生图任务...' : '正在提交生图任务...';
      case 'receiving':
        return isEdit ? '正在接收图生图结果...' : '正在接收图片结果...';
      case 'persisting':
        return isEdit ? '正在保存图生图结果...' : '正在保存图片结果...';
      case 'completed':
        return isEdit ? '已完成图生图。' : '已生成图片。';
      case 'generating':
      default:
        return isEdit ? '正在图生图中...' : '正在生成图片中...';
    }
  }

  function getTaskOwnerRef(task) {
    if (!task) {
      return null;
    }

    if (task.ownerType === 'guest') {
      return { guestId: task.ownerId };
    }

    return { userId: task.ownerId || task.userId };
  }

  function getAiTask(taskId) {
    return aiTasks.get(String(taskId || '').trim()) || null;
  }

  function registerAiTask(task) {
    aiTasks.set(task.id, task);
    return task;
  }

  function runCleanupStep(task, label, action) {
    try {
      return action();
    } catch (error) {
      console.error(`Failed to ${label} for AI task ${task?.id || 'unknown'}:`, error);
      return undefined;
    }
  }

  function requirePersistedTaskResult(result) {
    if (result === null) {
      throw new Error('AI task result message no longer exists');
    }
    return result;
  }

  function clearHeavyTaskInputs(task) {
    delete task.apiKey;
    delete task.prompt;
    delete task.images;
    delete task.image;
    delete task.lastFrame;
    delete task.referenceImages;
    delete task.inputMessage;
  }

  function clearTaskOutputs(task) {
    delete task.partialImages;
    delete task.imageFileName;
    delete task.imageFileSize;
    delete task.imageMimeType;
    delete task.imageWidth;
    delete task.imageHeight;
    delete task.videoUrl;
    delete task.videoMimeType;
    delete task.videoFileName;
    delete task.videoFileSize;
    delete task.videoDuration;
    delete task.videoWidth;
    delete task.videoHeight;
  }

  function finalizeMediaRequest(task) {
    if (
      !task?.mediaRequestKey
      || !task.pointsFinalized
      || task.mediaRequestFinalized
      || task.mediaRequestTerminalTimer
      || task.mediaRequestTerminalExhausted
    ) {
      return;
    }

    const terminalStatus = ['completed', 'failed', 'cancelled'].includes(task.status)
      ? task.status
      : 'failed';
    task.mediaRequestTerminalAttempts = (Number(task.mediaRequestTerminalAttempts) || 0) + 1;
    try {
      terminalMediaRequest(task.mediaRequestKey, terminalStatus);
      task.mediaRequestFinalized = true;
      delete task.mediaRequestTerminalExhausted;
    } catch (error) {
      const retryDelay = settlementRetryDelays[task.mediaRequestTerminalAttempts - 1];
      if (retryDelay === undefined) {
        task.mediaRequestTerminalExhausted = true;
        console.error(
          `Media request ${task.mediaRequestKey} terminal persistence failed after ${task.mediaRequestTerminalAttempts} attempts; startup reconciliation remains available:`,
          error,
        );
        return;
      }
      console.error(
        `Failed to persist terminal media request ${task.mediaRequestKey}; retrying in ${retryDelay}ms:`,
        error,
      );
      const timer = setTimeout(() => {
        if (task.mediaRequestTerminalTimer === timer) {
          delete task.mediaRequestTerminalTimer;
        }
        finalizeMediaRequest(task);
      }, retryDelay);
      task.mediaRequestTerminalTimer = timer;
      timer.unref?.();
    }
  }

  function settleMediaReservation(task, success, chargedUnits) {
    if (
      !task
      || !['image', 'video'].includes(task.type)
      || task.pointsFinalized
      || task.pointsSettlementTimer
      || task.pointsSettlementExhausted
    ) {
      return;
    }

    if (task.pointsSettlementSuccess === undefined) {
      task.pointsSettlementSuccess = Boolean(success);
    }
    if (chargedUnits !== undefined && task.pointsSettlementChargedUnits === undefined) {
      task.pointsSettlementChargedUnits = chargedUnits;
    }
    task.pointsFinalized = false;
    task.pointsSettlementAttempts = (Number(task.pointsSettlementAttempts) || 0) + 1;
    try {
      if (task.pointsSettlementChargedUnits === undefined) {
        settleMediaTask(task.id, task.pointsSettlementSuccess);
      } else {
        settleMediaTask(
          task.id,
          task.pointsSettlementSuccess,
          task.pointsSettlementChargedUnits,
        );
      }
      task.pointsFinalized = true;
      delete task.pointsSettlementExhausted;
    } catch (error) {
      const retryDelay = settlementRetryDelays[task.pointsSettlementAttempts - 1];
      if (retryDelay === undefined) {
        task.pointsSettlementExhausted = true;
        console.error(
          `Media task ${task.id} points settlement failed after ${task.pointsSettlementAttempts} attempts; startup reconciliation remains available:`,
          error,
        );
        return;
      }

      console.error(
        `Failed to settle points for media task ${task.id}; retrying in ${retryDelay}ms:`,
        error,
      );
      const timer = setTimeout(() => {
        if (task.pointsSettlementTimer === timer) {
          delete task.pointsSettlementTimer;
        }
        settleMediaReservation(
          task,
          task.pointsSettlementSuccess,
          task.pointsSettlementChargedUnits,
        );
      }, retryDelay);
      task.pointsSettlementTimer = timer;
      timer.unref?.();
      return;
    }
    finalizeMediaRequest(task);
  }

  function scheduleTaskRemoval(task) {
    const timer = setTimeout(() => {
      const currentTask = getAiTask(task.id);
      if (currentTask === task && ['completed', 'failed', 'cancelled'].includes(task.status)) {
        aiTasks.delete(task.id);
      }
    }, taskRetentionMs);
    timer.unref?.();
  }

  function finalizeTaskResources(task, settlementSuccess, settlementChargedUnits) {
    runCleanupStep(task, 'settle points', () => (
      settleMediaReservation(task, settlementSuccess, settlementChargedUnits)
    ));
    runCleanupStep(task, 'clear session task', () => (
      clearAiSessionTask(getTaskOwnerRef(task), task.sessionId, task.id)
    ));
    runCleanupStep(task, 'clear heavy inputs', () => clearHeavyTaskInputs(task));
    runCleanupStep(task, 'schedule task removal', () => scheduleTaskRemoval(task));
  }

  function getSchedulerForTask(task) {
    return task?.type === 'chat' ? chatScheduler : scheduler;
  }

  function throwIfCancelled(task, controller) {
    if (task.status !== 'cancelled' && !controller.signal.aborted) {
      return;
    }
    const error = new Error('Task cancelled');
    error.name = 'AbortError';
    throw error;
  }

  function runAiTaskInBackground(taskId) {
    Promise.resolve()
      .then(() => runAiTask(taskId))
      .catch((error) => {
        console.error(`Background AI task ${taskId} failed:`, error);
        const task = getAiTask(taskId);
        if (task && !['completed', 'failed', 'cancelled'].includes(task.status)) {
          failQueuedTask(task, error, '任务启动失败，请稍后重试');
        }
      });
  }

  function updateVideoStage(task, stage) {
    if (task.status === 'cancelled') {
      return;
    }
    const content = videoStageContent[stage];
    if (!content) {
      return;
    }

    task.videoStage = stage;
    task.partialContent = content;
    task.updatedAt = Date.now();
    videoJobStore.patchVideoJob(task.id, {
      stage,
      status: 'running',
      upstreamTaskId: task.upstreamTaskId,
    });
    patchAiMessage(getTaskOwnerRef(task), task.sessionId, task.messageId, {
      content,
      videoGenerationStage: stage,
      status: 'streaming',
    });
  }

  function updateImageStage(task, stage) {
    if (task.status === 'cancelled') {
      return;
    }
    const content = getImageTaskProgressText(task, stage);
    task.imageStage = stage;
    task.partialContent = content;
    task.updatedAt = Date.now();
    patchAiMessage(getTaskOwnerRef(task), task.sessionId, task.messageId, {
      content,
      imageGenerationStage: stage,
      progressPercent: undefined,
      status: 'streaming',
    });
  }

  function completeVideoTask(task, video) {
    const normalizedVideo = {
      videoUrl: video.videoUrl,
      videoMimeType: video.videoMimeType || 'video/mp4',
      videoFileName: video.videoFileName || video.fileName,
      videoFileSize: video.videoFileSize || video.size,
      videoDuration: video.videoDuration || video.duration,
      videoWidth: video.videoWidth || video.width,
      videoHeight: video.videoHeight || video.height,
    };
    Object.assign(task, normalizedVideo);
    task.partialContent = '视频生成完成';
    task.videoStage = undefined;
    task.updatedAt = Date.now();
    requirePersistedTaskResult(patchAiMessage(getTaskOwnerRef(task), task.sessionId, task.messageId, {
      content: '视频生成完成',
      ...normalizedVideo,
      videoGenerationStage: undefined,
      status: 'sent',
    }));
    videoJobStore.patchVideoJob(task.id, {
      status: 'completed',
      stage: 'validating',
      error: '',
      upstreamTaskId: task.upstreamTaskId,
    });
  }

  function getVideoFailureText(task, error) {
    const message = String(error?.message || '');
    if (/余额不足|insufficient\s+(balance|credit)|quota\s+exceeded/i.test(message)) {
      return '视频服务额度暂不可用，本次未扣积分，请联系管理员。';
    }
    if (/download\s+error|result\s+download|结果下载/i.test(message)) {
      return '上游视频结果获取失败，本次未扣积分，请稍后重试。';
    }
    if (/timed out|超时/i.test(message)) {
      return '视频生成等待超时，本次未扣积分，请稍后重试。';
    }
    if (task.videoStage === 'submitting') {
      return '视频任务提交失败，请稍后重试。';
    }
    if (task.videoStage === 'queued' || task.videoStage === 'processing') {
      return '上游视频生成失败，请稍后重试。';
    }
    if (task.videoStage === 'downloading') {
      return '视频下载失败，请稍后重试。';
    }
    if (task.videoStage === 'validating') {
      return '视频校验或保存失败，请稍后重试。';
    }
    return '视频生成失败，请稍后重试。';
  }

  function serializeAiTask(task) {
    if (!task) {
      return null;
    }
    const queuePosition = getSchedulerForTask(task).getQueuePosition(task.id);
    const queuedContent = queuePosition
      ? `${task.type === 'video' ? '视频' : (task.type === 'image' ? '图片' : '聊天')}任务正在排队${queuePosition > 1 ? `，前面还有 ${queuePosition - 1} 个任务` : ''}...`
      : '';

    return {
      id: task.id,
      userId: task.userId,
      sessionId: task.sessionId,
      messageId: task.messageId,
      type: task.type,
      status: task.status,
      error: task.error || '',
      content: queuedContent || (typeof task.partialContent === 'string' ? task.partialContent : ''),
      images: Array.isArray(task.partialImages) && task.partialImages.length ? task.partialImages : undefined,
      files: Array.isArray(task.partialFiles) && task.partialFiles.length ? task.partialFiles : undefined,
      audioUrl: typeof task.audioUrl === 'string' && task.audioUrl.trim() ? task.audioUrl.trim() : undefined,
      audioMimeType: typeof task.audioMimeType === 'string' && task.audioMimeType.trim() ? task.audioMimeType.trim() : undefined,
      duration: Number.isFinite(task.duration) && task.duration > 0 ? Number(task.duration) : undefined,
      progressPercent: Number.isFinite(task.progressPercent) ? Number(task.progressPercent) : undefined,
      imageStage: task.imageStage,
      imageFileName: task.imageFileName,
      imageFileSize: task.imageFileSize,
      imageMimeType: task.imageMimeType,
      imageWidth: task.imageWidth,
      imageHeight: task.imageHeight,
      imageProvider: task.imageProvider,
      imageCount: task.imageCount,
      videoStage: task.videoStage,
      videoUrl: task.videoUrl,
      videoMimeType: task.videoMimeType,
      videoFileName: task.videoFileName,
      videoFileSize: task.videoFileSize,
      videoDuration: task.videoDuration,
      videoWidth: task.videoWidth,
      videoHeight: task.videoHeight,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      queuePosition: queuePosition || undefined,
    };
  }

  async function executeAiTask(taskId) {
    const task = getAiTask(taskId);
    if (!task || task.status !== 'pending') {
      return;
    }

    const ownerRef = getTaskOwnerRef(task);
    task.status = 'running';
    task.updatedAt = Date.now();

    const controller = new AbortController();
    task.abortController = controller;
    let taskHeartbeatTimer = null;

    try {
      if (task.type === 'chat') {
        const activeSession = findAiSession(ownerRef, task.sessionId);
        const upstreamMessages = (activeSession?.messages || [])
          .filter(message => String(message.id) !== String(task.messageId))
          .map((message) => {
            const sanitized = sanitizeAiMessage(message);
            return task.inputMessage && String(message.id) === String(task.userMessageId)
              ? { ...sanitized, ...task.inputMessage }
              : sanitized;
          });
        const voiceMode = isKittyVoiceModel(task.model);
        task.partialContent = voiceMode ? VOICE_STREAMING_TEXT : '';
        task.partialFiles = [];
        if (voiceMode) {
          patchAiMessage(ownerRef, task.sessionId, task.messageId, {
            content: VOICE_STREAMING_TEXT,
            status: 'streaming',
          });

          const voiceProfile = resolveKittyVoiceProfile(task.model);
          const voiceMessages = buildVoiceReplyMessages(upstreamMessages, voiceProfile.replyPrompt);
          const result = await ensureVoiceReplyText({
            messages: voiceMessages,
            apiKey: task.apiKey,
            model: task.model,
            temperature: voiceProfile.replyTemperature ?? VOICE_REPLY_TEMPERATURE,
            maxTokens: Math.min(Number(task.maxTokens) || VOICE_REPLY_MAX_TOKENS, VOICE_REPLY_MAX_TOKENS),
            topP: VOICE_REPLY_TOP_P,
            enableWebSearch: false,
            signal: controller.signal,
          });
          throwIfCancelled(task, controller);

          const finalText = String(result.content || '').trim();
          if (!finalText) {
            throw new Error('语音模式未生成文本内容');
          }

          const audioPatch = await performVoiceSynthesis({
            text: finalText,
            signal: controller.signal,
            voiceModel: voiceProfile.model,
          });
          throwIfCancelled(task, controller);

          task.partialContent = finalText;
          task.partialFiles = result.files.length ? result.files : [];
          task.audioUrl = audioPatch.audioUrl || '';
          task.audioMimeType = audioPatch.audioMimeType || '';
          task.duration = Number(audioPatch.duration) || undefined;
          task.updatedAt = Date.now();

          requirePersistedTaskResult(patchAiMessage(ownerRef, task.sessionId, task.messageId, {
            content: finalText,
            files: result.files.length ? result.files : undefined,
            ...audioPatch,
            status: 'sent',
          }));
        } else {
          const result = await performStreamingChatCompletion({
            messages: upstreamMessages,
            apiKey: task.apiKey,
            model: task.model,
            temperature: task.temperature,
            maxTokens: task.maxTokens,
            topP: task.topP,
            enableWebSearch: task.enableWebSearch,
            signal: controller.signal,
            onDelta: (content) => {
              if (task.status === 'cancelled') return;
              task.partialContent = content;
              task.updatedAt = Date.now();
            },
            onFiles: (files) => {
              if (task.status === 'cancelled') return;
              task.partialFiles = files;
              task.updatedAt = Date.now();
            },
          });
          throwIfCancelled(task, controller);

          requirePersistedTaskResult(patchAiMessage(ownerRef, task.sessionId, task.messageId, {
            content: result.content || task.partialContent || '已完成回复。',
            files: result.files.length ? result.files : (task.partialFiles?.length ? task.partialFiles : undefined),
            status: 'sent',
          }));
        }
      } else if (task.type === 'image') {
        taskHeartbeatTimer = setInterval(() => {
          task.updatedAt = Date.now();
        }, 1500);

        const result = await performImageGeneration({
          prompt: task.prompt,
          images: task.images,
          provider: task.imageProvider,
          count: task.imageCount || 1,
          signal: controller.signal,
          onProgress: (stage) => {
            updateImageStage(task, stage);
          },
        });
        throwIfCancelled(task, controller);

        const completedCount = Number.isSafeInteger(result.completedCount)
          ? result.completedCount
          : 1;
        const requestedCount = Number.isSafeInteger(task.imageCount) ? task.imageCount : 1;
        const imageUnitCost = Number(task.imageUnitCost);
        if (Number.isSafeInteger(imageUnitCost) && imageUnitCost > 0) {
          task.pointsSettlementChargedUnits = imageUnitCost * completedCount;
        }
        task.partialContent = requestedCount > 1
          ? `已生成 ${completedCount}/${requestedCount} 张图片${result.failedCount ? `，${result.failedCount} 张失败。` : '。'}`
          : getImageTaskProgressText(task, 'completed');
        task.partialImages = Array.isArray(result.images) ? result.images : [];
        task.imageStage = undefined;
        task.imageFileName = result.imageFileName;
        task.imageFileSize = result.imageFileSize;
        task.imageMimeType = result.imageMimeType;
        task.imageWidth = result.imageWidth;
        task.imageHeight = result.imageHeight;
        task.imageProvider = result.imageProvider || task.imageProvider;
        task.updatedAt = Date.now();

        requirePersistedTaskResult(patchAiMessage(ownerRef, task.sessionId, task.messageId, {
          content: task.partialContent,
          images: result.images,
          imageGenerationStage: undefined,
          imageFileName: result.imageFileName,
          imageFileSize: result.imageFileSize,
          imageMimeType: result.imageMimeType,
          imageWidth: result.imageWidth,
          imageHeight: result.imageHeight,
          imageProvider: result.imageProvider || task.imageProvider,
          progressPercent: undefined,
          status: 'sent',
        }));
      } else if (task.type === 'video') {
        videoJobStore.patchVideoJob(task.id, {
          status: 'running',
          stage: task.videoStage || 'submitting',
          upstreamTaskId: task.upstreamTaskId,
        });

        const existingVideo = await videoFileStore.inspectExistingVideo(task.id);
        throwIfCancelled(task, controller);
        if (existingVideo) {
          completeVideoTask(task, existingVideo);
        } else {
          let upstreamVideoUrl = '';
          if (!task.upstreamTaskId) {
            console.log('[video-task] submitting', JSON.stringify({
              taskId: task.id,
              promptLen: (task.prompt || '').length,
              hasFirstFrame: Boolean(task.image),
              hasLastFrame: Boolean(task.lastFrame),
              referenceImageCount: Array.isArray(task.referenceImages) ? task.referenceImages.length : 0,
            }));
            const submitted = await videoProvider.submit({
              prompt: task.prompt,
              image: task.image,
              lastFrame: task.lastFrame,
              referenceImages: task.referenceImages,
              durationSeconds: task.durationSeconds,
            });
            console.log('[video-task] submit result', JSON.stringify({ taskId: task.id, upstreamTaskId: submitted.id, status: submitted.status, hasVideoUrl: Boolean(submitted.videoUrl) }));
            throwIfCancelled(task, controller);
            task.upstreamTaskId = submitted.id;
            if (submitted.status === 'completed' && submitted.videoUrl) {
              console.log('[video-task] immediately completed', task.id);
              upstreamVideoUrl = submitted.videoUrl;
            } else {
              updateVideoStage(task, submitted.status === 'processing' ? 'processing' : 'queued');
            }
          }

          if (!upstreamVideoUrl) {
            const pollStartMs = Date.now();
            console.log('[video-task] start polling', JSON.stringify({ taskId: task.id, upstreamTaskId: task.upstreamTaskId }));
            upstreamVideoUrl = await videoProvider.poll(task.upstreamTaskId, (stage) => {
              updateVideoStage(task, stage);
            });
            console.log('[video-task] poll completed', JSON.stringify({ taskId: task.id, pollDurationMs: Date.now() - pollStartMs, urlLen: String(upstreamVideoUrl || '').length }));
            throwIfCancelled(task, controller);
          }

          console.log('[video-task] downloading video', task.id);
          const video = await videoFileStore.downloadValidateAndSave({
            jobId: task.id,
            videoUrl: upstreamVideoUrl,
            onStage: (stage) => updateVideoStage(task, stage),
          });
          console.log('[video-task] download done', JSON.stringify({ taskId: task.id, fileSize: video.fileSize ?? 0 }));
          throwIfCancelled(task, controller);
          completeVideoTask(task, video);
        }
      }

      throwIfCancelled(task, controller);
      task.status = 'completed';
      task.updatedAt = Date.now();
    } catch (error) {
      const isAbort = task.status === 'cancelled'
        || (error instanceof Error && error.name === 'AbortError');
      if (task.type === 'video' && !isAbort) {
        const failedStage = task.videoStage || 'submitting';
        console.error('[video-task] failed', JSON.stringify({ taskId: task.id, stage: failedStage, upstreamId: task.upstreamTaskId, errorMsg: error?.message || '' }));
        const publicError = getVideoFailureText(task, error);
        task.status = 'failed';
        task.error = publicError;
        task.videoStage = undefined;
        task.updatedAt = Date.now();
        clearTaskOutputs(task);
        runCleanupStep(task, 'persist video failure', () => videoJobStore.patchVideoJob(task.id, {
          status: 'failed',
          stage: failedStage,
          error: publicError,
          upstreamTaskId: task.upstreamTaskId,
        }));
        runCleanupStep(task, 'persist video failure message', () => patchAiMessage(
          getTaskOwnerRef(task), task.sessionId, task.messageId, {
          content: publicError,
          videoGenerationStage: undefined,
          status: 'error',
          },
        ));
      } else {
        task.status = isAbort ? 'cancelled' : 'failed';
        if (task.type === 'image') {
          task.imageStage = undefined;
          clearTaskOutputs(task);
        }
        task.error = isAbort ? '' : toPublicAiErrorMessage(error, task.type);
        task.updatedAt = Date.now();

        runCleanupStep(task, 'persist terminal message', () => patchAiMessage(
          getTaskOwnerRef(task), task.sessionId, task.messageId, {
          content: isAbort
            ? (task.type === 'image' ? '已停止生成。' : '已停止回复。')
            : `错误: ${task.error}`,
          imageGenerationStage: task.type === 'image' ? undefined : task.imageStage,
          progressPercent: task.type === 'image' ? undefined : task.progressPercent,
          status: isAbort ? 'sent' : 'error',
          },
        ));
      }
    } finally {
      if (taskHeartbeatTimer) {
        clearInterval(taskHeartbeatTimer);
      }
      delete task.abortController;
      finalizeTaskResources(
        task,
        task.status === 'completed',
        task.pointsSettlementChargedUnits,
      );
    }
  }

  function failQueuedTask(task, error, publicError) {
    const failedVideoStage = task.videoStage || 'submitting';
    task.status = 'failed';
    task.error = publicError
      || (error instanceof Error ? error.message : '任务队列繁忙，请稍后重试');
    task.imageStage = undefined;
    task.videoStage = undefined;
    task.updatedAt = Date.now();
    runCleanupStep(task, 'persist queue failure', () => patchAiMessage(
      getTaskOwnerRef(task), task.sessionId, task.messageId, {
      content: `错误: ${task.error}`,
      imageGenerationStage: undefined,
      videoGenerationStage: undefined,
      progressPercent: undefined,
      status: 'error',
      },
    ));
    if (task.type === 'video') {
      runCleanupStep(task, 'persist video queue failure', () => videoJobStore.patchVideoJob(task.id, {
        status: 'failed',
        stage: failedVideoStage,
        error: task.error,
        upstreamTaskId: task.upstreamTaskId,
      }));
    }
    finalizeTaskResources(task, false);
  }

  async function runAiTask(taskId) {
    const task = getAiTask(taskId);
    if (!task || task.status !== 'pending') {
      return;
    }

    const taskScheduler = getSchedulerForTask(task);
    try {
      await taskScheduler.schedule({
        id: task.id,
        type: task.type,
        ownerId: `${task.ownerType || 'user'}:${task.ownerId || task.userId}`,
        slots: task.type === 'image' ? (task.imageCount || 1) : 1,
        run: () => executeAiTask(task.id),
      });
    } catch (error) {
      if (error instanceof MediaTaskQueueCancelledError || task.status === 'cancelled') {
        return;
      }
      if (error instanceof MediaTaskQueueFullError) {
        failQueuedTask(task, error);
        return;
      }
      const publicError = task.type === 'chat'
        ? '聊天任务启动失败，请稍后重试'
        : '媒体任务启动失败，请稍后重试';
      console.error(`Background AI task ${task.id} failed:`, error);
      failQueuedTask(task, error, publicError);
    }
  }

  function cancelAiTask(taskId, options = {}) {
    const task = getAiTask(taskId);
    if (!task || ['completed', 'failed', 'cancelled'].includes(task.status)) {
      return task;
    }

    getSchedulerForTask(task).cancel(task.id);
    task.status = 'cancelled';
    task.updatedAt = Date.now();
    task.abortController?.abort();

    if (options.remove) {
      clearHeavyTaskInputs(task);
      aiTasks.delete(task.id);
      return task;
    }

    runCleanupStep(task, 'persist cancellation', () => patchAiMessage(
      getTaskOwnerRef(task), task.sessionId, task.messageId, {
      content: task.type === 'image' ? '已停止生成。' : '已停止回复。',
      imageGenerationStage: undefined,
      progressPercent: undefined,
      status: 'sent',
      },
    ));
    finalizeTaskResources(task, false);

    return task;
  }

  function resumeVideoJobs() {
    const { recoverable, unknownSubmission } = videoJobStore.getRecoveryPlan();

    const failRecovery = (job, content) => {
      const ownerRef = job.ownerType === 'guest'
        ? { guestId: job.ownerId }
        : { userId: job.ownerId };
      runCleanupStep(job, 'persist video recovery failure', () => videoJobStore.patchVideoJob(job.id, {
        status: 'failed',
        stage: job.stage || 'submitting',
        error: content,
        upstreamTaskId: job.upstreamTaskId,
      }));
      runCleanupStep(job, 'persist recovery message failure', () => patchAiMessage(ownerRef, job.sessionId, job.messageId, {
        content,
        videoGenerationStage: undefined,
        status: 'error',
      }));
      runCleanupStep(job, 'clear recovered session task', () => (
        clearAiSessionTask(ownerRef, job.sessionId, job.id)
      ));
      runCleanupStep(job, 'settle recovered points', () => (
        settleMediaReservation({
          ...job,
          type: 'video',
          status: 'failed',
          mediaRequestKey: getMediaRequestKeyForTask(job.id),
        }, false)
      ));
    };

    for (const job of unknownSubmission) {
      failRecovery(job, '提交结果未知，为避免重复扣费未自动重试。');
    }

    let recoveredCount = 0;
    for (const job of recoverable) {
      const ownerRef = job.ownerType === 'guest'
        ? { guestId: job.ownerId }
        : { userId: job.ownerId };
      const session = findAiSession(ownerRef, job.sessionId);
      const userMessage = session?.messages?.find(message => String(message.id) === String(job.userMessageId));
      if (!session || !userMessage) {
        failRecovery(job, '视频任务恢复失败：原始消息不存在。');
        continue;
      }
      if (session.pendingTaskId && session.pendingTaskId !== job.id) {
        failRecovery(job, '视频任务恢复失败：当前会话已有其他任务。');
        continue;
      }

      const task = {
        ...job,
        userId: job.ownerType === 'user' ? job.ownerId : '',
        type: 'video',
        status: 'pending',
        error: '',
        images: Array.isArray(userMessage.images) ? userMessage.images : [],
        videoStage: job.stage,
        mediaRequestKey: getMediaRequestKeyForTask(job.id) || undefined,
        updatedAt: Date.now(),
      };
      try {
        registerAiTask(task);
        session.pendingTaskId = task.id;
        upsertAiSession(ownerRef, session);
        setTimeout(() => {
          runAiTaskInBackground(task.id);
        }, 0);
        recoveredCount += 1;
      } catch (error) {
        aiTasks.delete(task.id);
        console.error(`Failed to recover video task ${task.id}:`, error);
        failRecovery(job, '视频任务恢复失败，请联系管理员核查。');
      }
    }

    return {
      recoveredCount,
      unknownSubmissionCount: unknownSubmission.length,
      activeTaskIds: recoverable
        .filter(job => getAiTask(job.id))
        .map(job => job.id),
    };
  }

  return {
    getAiTask,
    registerAiTask,
    serializeAiTask,
    runAiTask,
    cancelAiTask,
    resumeVideoJobs,
  };
}
