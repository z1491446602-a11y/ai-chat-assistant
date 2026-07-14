import { createHash } from 'crypto';
import { decodeBase64AudioInput } from './mediaPayload.js';
import { getResponseErrorMessage } from './upstreamErrors.js';
import { resolveImageTaskReferences } from './imageFollowUp.js';
import { getRequestedImageCount } from './imageBatch.js';
import { MEDIA_COST_UNITS } from './pointsService.js';
import { toPublicAiErrorMessage } from './publicAiErrors.js';
import { normalizeImageReferenceList } from './imageReferences.js';
import { MAX_VIDEO_REFERENCE_IMAGES, VEO_FAST_DURATION_SECONDS } from './videoProvider.js';
import { MAX_VIDEO_PROMPT_LENGTH } from './videoJobs.js';

export const GUEST_OPERATION_WINDOW_MS = 60_000;
export const GUEST_OPERATION_LIMIT = 20;
export const MAX_GUEST_RATE_LIMIT_KEYS = 10_000;
export const MAX_CHAT_CONTENT_LENGTH = 100_000;
export const MAX_CHAT_QUEUED_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_VOICE_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_CHAT_FILES = 10;
const MAX_CHAT_FILE_NAME_LENGTH = 255;
const MAX_CHAT_FILE_URL_LENGTH = 2_048;
const MAX_CHAT_METADATA_LENGTH = 255;
const MAX_CHAT_API_KEY_LENGTH = 4_096;
const MAX_LEGACY_CHAT_MESSAGES = 200;
const MAX_VOICE_AUDIO_INPUT_LENGTH = Math.ceil(MAX_VOICE_AUDIO_BYTES * 4 / 3) + 512;

function createInputError(message, code = 'INVALID_CHAT_INPUT', status = 400) {
  return Object.assign(new Error(message), { code, status, statusCode: status });
}

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function normalizeChatFileUrl(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > MAX_CHAT_FILE_URL_LENGTH || hasControlCharacters(normalized)) {
    return '';
  }
  if (normalized.startsWith('/') && !normalized.startsWith('//')) {
    return normalized;
  }
  try {
    const parsed = new URL(normalized);
    if (
      ['http:', 'https:'].includes(parsed.protocol)
      && parsed.hostname
      && !parsed.username
      && !parsed.password
    ) {
      return normalized;
    }
  } catch {
    return '';
  }
  return '';
}

function normalizeChatFiles(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_CHAT_FILES) {
    throw createInputError('文件附件数量不符合要求');
  }
  return value.map((file) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw createInputError('文件附件格式无效');
    }
    const fileName = typeof file.fileName === 'string' ? file.fileName.trim() : '';
    const fileUrl = normalizeChatFileUrl(file.fileUrl);
    if (!fileName || fileName.length > MAX_CHAT_FILE_NAME_LENGTH || !fileUrl) {
      throw createInputError('文件附件格式无效');
    }
    const fileSize = Number(file.fileSize);
    const mimeType = typeof file.mimeType === 'string' ? file.mimeType.trim() : '';
    return {
      fileName,
      fileUrl,
      ...(Number.isFinite(fileSize) && fileSize > 0 ? { fileSize } : {}),
      ...(mimeType && mimeType.length <= MAX_CHAT_METADATA_LENGTH ? { mimeType } : {}),
    };
  });
}

export function normalizeChatTaskInput(input = {}) {
  const rawContent = input.content == null ? '' : String(input.content);
  if (rawContent.length > MAX_CHAT_CONTENT_LENGTH) {
    throw createInputError('消息内容过长', 'CHAT_INPUT_TOO_LARGE', 413);
  }
  const content = rawContent.trim();
  const images = normalizeImageReferenceList(input.images);
  const files = normalizeChatFiles(input.files);
  const apiKey = input.apiKey == null ? '' : String(input.apiKey).trim();
  if (apiKey.length > MAX_CHAT_API_KEY_LENGTH) {
    throw createInputError('接口密钥格式无效');
  }
  const queuedBytes = Buffer.byteLength(content, 'utf8')
    + images.reduce((total, image) => total + Buffer.byteLength(image, 'utf8'), 0)
    + Buffer.byteLength(JSON.stringify(files), 'utf8');
  if (queuedBytes > MAX_CHAT_QUEUED_INPUT_BYTES) {
    throw createInputError('消息附件总大小超出限制', 'CHAT_INPUT_TOO_LARGE', 413);
  }
  return { content, images, files, apiKey };
}

function normalizeLegacyChatMessages(value) {
  if (!Array.isArray(value) || value.length > MAX_LEGACY_CHAT_MESSAGES) {
    throw createInputError('聊天消息数量不符合要求');
  }
  const messages = value.map((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw createInputError('聊天消息格式无效');
    }
    const normalized = normalizeChatTaskInput(message);
    return {
      role: ['system', 'assistant'].includes(message.role) ? message.role : 'user',
      content: normalized.content,
      ...(normalized.images.length ? { images: normalized.images } : {}),
      ...(normalized.files.length ? { files: normalized.files } : {}),
    };
  });
  if (Buffer.byteLength(JSON.stringify(messages), 'utf8') > MAX_CHAT_QUEUED_INPUT_BYTES) {
    throw createInputError('聊天消息总大小超出限制', 'CHAT_INPUT_TOO_LARGE', 413);
  }
  return messages;
}

export function createGuestOperationLimiter({
  limit = GUEST_OPERATION_LIMIT,
  windowMs = GUEST_OPERATION_WINDOW_MS,
  maxKeys = MAX_GUEST_RATE_LIMIT_KEYS,
  now = Date.now,
} = {}) {
  const counters = new Map();
  const normalizedLimit = Number.isSafeInteger(Number(limit)) && Number(limit) > 0
    ? Number(limit)
    : GUEST_OPERATION_LIMIT;
  const normalizedWindowMs = Number.isFinite(Number(windowMs)) && Number(windowMs) > 0
    ? Number(windowMs)
    : GUEST_OPERATION_WINDOW_MS;
  const normalizedMaxKeys = Number.isSafeInteger(Number(maxKeys)) && Number(maxKeys) > 0
    ? Number(maxKeys)
    : MAX_GUEST_RATE_LIMIT_KEYS;

  function pruneExpired(timestamp) {
    for (const [key, entry] of counters) {
      if (entry.expiresAt > timestamp) break;
      counters.delete(key);
    }
  }

  function consume(rawKey) {
    const timestamp = Number(now());
    pruneExpired(timestamp);
    const key = String(rawKey || 'unknown').trim() || 'unknown';
    let entry = counters.get(key);
    if (!entry) {
      while (counters.size >= normalizedMaxKeys) {
        const oldestKey = counters.keys().next().value;
        if (oldestKey === undefined) break;
        counters.delete(oldestKey);
      }
      entry = { count: 0, expiresAt: timestamp + normalizedWindowMs };
      counters.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= normalizedLimit;
  }

  return { consume, size: () => counters.size };
}

export function registerAiRoutes(app, deps) {
  const {
    upstreamFetch,
    resolveAiOwnerFromInput,
    getAiSessions,
    createAiSession,
    findAiSession,
    upsertAiSession,
    getAiTask,
    registerAiTask,
    serializeAiTask,
    runAiTask,
    cancelAiTask,
    chatTaskScheduler,
    resolveImageReferences,
    pointsService,
    mediaRequestService,
    videoJobStore,
    removeAiSession,
    removeAllAiSessions,
    generateEntityId,
    normalizeChatModel,
    resolveChatProvider,
    resolveImageProvider,
    buildResponsesInput,
    buildResponsesInstructions,
    buildChatCompletionsMessages,
    buildChatCompletionsPayload,
    streamResponse,
    DEFAULT_CHAT_API_KEY,
    DEFAULT_CHAT_MODEL,
    DEFAULT_ENABLE_WEB_SEARCH,
    isKittyVoiceModel,
    VOICE_STREAMING_TEXT,
    DEFAULT_IMAGE_MODEL,
    VIDEO_API_MODEL,
    BAIDU_SPEECH_API_KEY,
    BAIDU_SPEECH_SECRET_KEY,
    BAIDU_SPEECH_TOKEN_URL,
    BAIDU_SPEECH_ASR_URL,
    BAIDU_SPEECH_DEV_PID,
  } = deps;

  const baiduSpeechTokenCache = {
    accessToken: '',
    expiresAt: 0,
  };
  const videoImageDataUrlPattern = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;
  const videoReferenceMaxBytes = 10 * 1024 * 1024;
  const loginRequiredMessage = '请先登录后再使用图片或视频生成功能';
  const pendingTaskConflictMessage = '当前会话已有任务正在处理，请等待完成后再试';
  const guestOperationLimiter = createGuestOperationLimiter();
  const compatibilityChatScheduler = typeof chatTaskScheduler?.schedule === 'function'
    ? chatTaskScheduler
    : { schedule: input => Promise.resolve().then(input.run) };
  const aiTaskRuns = new Map();

  function consumeGuestOperation(req, ownerLookup) {
    if (ownerLookup.ownerType !== 'guest') {
      return true;
    }

    const key = String(req.ip || req.socket?.remoteAddress || 'unknown').trim() || 'unknown';
    return guestOperationLimiter.consume(key);
  }

  function resolveCompatibilityOwner(req, input = {}) {
    const authenticatedUserId = String(req.authUser?.id || '').trim();
    if (authenticatedUserId) {
      return { ownerId: authenticatedUserId, ownerType: 'user' };
    }
    const guestId = String(input?.guestId || '').trim();
    if (guestId) {
      return { ownerId: guestId, ownerType: 'guest' };
    }
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').trim() || 'unknown';
    return { ownerId: `guest-ip:${ip}`, ownerType: 'guest' };
  }

  function getCompatibilityQueueError(error) {
    if (error?.name === 'MediaTaskQueueFullError') {
      return { status: 503, error: '聊天服务繁忙，请稍后重试' };
    }
    return null;
  }

  function hasPendingSessionTask(session) {
    return Boolean(String(session?.pendingTaskId || '').trim());
  }

  function createMediaPayloadFingerprint(payload) {
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  function getMediaRequestError(error) {
    if (error?.code === 'MEDIA_REQUEST_FINGERPRINT_CONFLICT') {
      return { status: 409, error: '请求标识已用于不同的生成内容，请更换请求标识' };
    }
    if (error?.code === 'INVALID_MEDIA_REQUEST') {
      return { status: 400, error: '请求标识无效，请重新提交' };
    }
    if (error?.code === 'MEDIA_REQUEST_CAPACITY_REACHED') {
      return { status: 503, error: '生成请求记录已满，请稍后重试' };
    }
    return { status: Number(error?.status) || 503, error: '生成请求服务暂时不可用，请稍后重试' };
  }

  function buildPersistedMediaTask(record) {
    const liveTask = getAiTask(record.taskId);
    if (liveTask) {
      return liveTask;
    }

    const session = findAiSession({ userId: record.userId }, record.sessionId);
    const message = session?.messages?.find(item => String(item.id) === String(record.messageId));
    if (!message) {
      return null;
    }

    const status = ['completed', 'failed', 'cancelled'].includes(record.status)
      ? record.status
      : 'pending';
    return {
      id: record.taskId,
      userId: record.userId,
      ownerId: record.userId,
      ownerType: 'user',
      sessionId: record.sessionId,
      messageId: record.messageId,
      type: record.mediaType,
      status,
      error: status === 'failed' ? String(message.content || '').replace(/^错误:\s*/u, '') : '',
      partialContent: String(message.content || ''),
      partialImages: Array.isArray(message.images) ? message.images : undefined,
      partialFiles: Array.isArray(message.files) ? message.files : undefined,
      imageFileName: message.imageFileName,
      imageFileSize: message.imageFileSize,
      imageMimeType: message.imageMimeType,
      imageWidth: message.imageWidth,
      imageHeight: message.imageHeight,
      imageProvider: message.imageProvider,
      videoUrl: message.videoUrl,
      videoMimeType: message.videoMimeType,
      videoFileName: message.videoFileName,
      videoFileSize: message.videoFileSize,
      videoDuration: message.videoDuration,
      videoWidth: message.videoWidth,
      videoHeight: message.videoHeight,
      createdAt: Number(record.createdAt) || Date.now(),
      updatedAt: Number(record.updatedAt) || Date.now(),
    };
  }

  function claimMediaRequest({ ownerLookup, mediaType, requestId, payloadFingerprint }) {
    if (typeof mediaRequestService?.claim !== 'function') {
      return { enabled: false, created: true, key: '' };
    }
    try {
      const claim = mediaRequestService.claim({
        userId: ownerLookup.ownerId,
        mediaType,
        requestId,
        payloadFingerprint,
      });
      return {
        enabled: true,
        created: claim.created,
        key: claim.record.key,
        record: claim.record,
      };
    } catch (error) {
      return { ...getMediaRequestError(error), claimError: true };
    }
  }

  function getCompatibleMediaRequestId(value) {
    return String(value ?? '').trim() || generateEntityId('media_request');
  }

  function sendExistingMediaRequest(res, claim) {
    if (claim.record.status === 'claimed') {
      return res.status(409).json({ error: '该生成请求正在提交，请稍后重试' });
    }
    const task = buildPersistedMediaTask(claim.record);
    if (!task) {
      return res.status(503).json({ error: '生成任务状态恢复中，请稍后重试' });
    }
    return res.json({
      task: serializeAiTask(task),
      sessionId: claim.record.sessionId,
      messageId: claim.record.messageId,
    });
  }

  function abortMediaRequestClaim(claim) {
    if (!claim?.enabled || !claim.created || typeof mediaRequestService?.abort !== 'function') {
      return;
    }
    try {
      mediaRequestService.abort(claim.key);
    } catch (error) {
      console.error(`Failed to abort media request ${claim.key}:`, error);
    }
  }

  function acceptMediaRequestClaim(claim, task) {
    if (!claim?.enabled || typeof mediaRequestService?.accept !== 'function') {
      return;
    }
    mediaRequestService.accept(claim.key, {
      taskId: task.id,
      sessionId: task.sessionId,
      messageId: task.messageId,
    });
  }

  function resolveRequestOwner(req, input = {}) {
    const authenticatedUserId = String(req.authUser?.id || '').trim();
    if (authenticatedUserId) {
      return resolveAiOwnerFromInput({ userId: authenticatedUserId });
    }

    const guestId = String(input?.guestId || '').trim();
    if (guestId) {
      return resolveAiOwnerFromInput({ guestId });
    }

    return { error: '请先登录或提供访客标识', status: 401 };
  }

  function reserveMediaPoints({ taskId, userId, costUnits, taskType }) {
    if (typeof pointsService?.reserve !== 'function') {
      return null;
    }

    try {
      pointsService.reserve({ taskId, userId, costUnits, taskType });
      return null;
    } catch (error) {
      if (error?.code === 'INSUFFICIENT_POINTS') {
        return { status: 402, error: '积分不足，无法提交本次生成任务' };
      }
      console.error('Failed to reserve media task points:', error);
      return { status: 503, error: '积分服务暂时不可用，请稍后重试' };
    }
  }

  function releaseMediaPoints(taskId) {
    if (typeof pointsService?.settle !== 'function') {
      return;
    }
    try {
      pointsService.settle(taskId, false);
    } catch (error) {
      console.error(`Failed to release points for media task ${taskId}:`, error);
    }
  }

  function linkMediaTaskPoints(task) {
    if (typeof pointsService?.linkMediaTask !== 'function') {
      return;
    }
    pointsService.linkMediaTask(task.id, {
      sessionId: task.sessionId,
      messageId: task.messageId,
    });
  }

  function runTrackedAiTask(taskId) {
    const normalizedTaskId = String(taskId || '').trim();
    const existingRun = aiTaskRuns.get(normalizedTaskId);
    if (existingRun) {
      return existingRun;
    }

    const runPromise = Promise.resolve().then(() => runAiTask(normalizedTaskId));
    aiTaskRuns.set(normalizedTaskId, runPromise);
    const clearRun = () => {
      if (aiTaskRuns.get(normalizedTaskId) === runPromise) {
        aiTaskRuns.delete(normalizedTaskId);
      }
    };
    runPromise.then(clearRun, clearRun);
    return runPromise;
  }

  function runAiTaskInBackground(taskId) {
    Promise.resolve()
      .then(() => runTrackedAiTask(taskId))
      .catch((error) => {
        console.error(`Background AI task ${taskId} failed:`, error);
        try {
          cancelAiTask(taskId);
        } catch (cancelError) {
          console.error(`Failed to terminate background AI task ${taskId}:`, cancelError);
        }
      });
  }

  function toPublicValidationMessage(error, fallback) {
    const message = error instanceof Error ? error.message.trim() : '';
    return /\p{Script=Han}/u.test(message) ? message : fallback;
  }

  function validateVideoImage(input, label) {
    const source = String(input || '').trim();
    if (!source) return '';
    const match = source.match(videoImageDataUrlPattern);
    if (!match) {
      throw new Error(`${label}只支持 PNG、JPEG 或 WebP 图片`);
    }
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) {
      throw new Error(`${label}内容为空`);
    }
    if (buffer.length > videoReferenceMaxBytes) {
      throw new Error(`${label}不能超过 10 MB`);
    }
    return source;
  }

  function validateVideoReferenceImages(input = []) {
    if (!Array.isArray(input)) {
      throw new Error('角色参考图必须是数组');
    }
    if (input.length > MAX_VIDEO_REFERENCE_IMAGES) {
      throw new Error(`最多上传 ${MAX_VIDEO_REFERENCE_IMAGES} 张角色参考图`);
    }
    return input.map(item => validateVideoImage(item, '角色参考图'));
  }

  function normalizeVideoInputs(body = {}) {
    const hasLegacyImages = Object.prototype.hasOwnProperty.call(body, 'images');
    const hasExplicitInputs = ['image', 'lastFrame', 'referenceImages']
      .some(key => Object.prototype.hasOwnProperty.call(body, key));
    if (hasLegacyImages && hasExplicitInputs) {
      throw new Error('旧版图片参数不能与首帧、尾帧或角色参考图同时使用');
    }

    if (hasLegacyImages) {
      const legacyImages = validateVideoReferenceImages(body.images);
      return {
        image: legacyImages.length === 1 ? legacyImages[0] : '',
        lastFrame: '',
        referenceImages: legacyImages.length > 1 ? legacyImages : [],
        durationSeconds: VEO_FAST_DURATION_SECONDS,
      };
    }

    const image = validateVideoImage(body.image, '首帧');
    const lastFrame = validateVideoImage(body.lastFrame, '尾帧');
    const referenceImages = validateVideoReferenceImages(body.referenceImages);
    if (lastFrame && !image) {
      throw new Error('添加尾帧前请先添加首帧');
    }
    return {
      image,
      lastFrame,
      referenceImages,
      durationSeconds: VEO_FAST_DURATION_SECONDS,
    };
  }

  function persistMediaTaskSession({
    ownerLookup,
    requestedSessionId,
    model,
    taskId,
    type,
    prompt,
    images,
    files,
    assistantContent,
    titleText,
  }) {
    const previous = findAiSession(ownerLookup.ownerRef, requestedSessionId);
    const previousSession = previous
      ? { ...previous, messages: [...(previous.messages || [])] }
      : null;
    const now = Date.now();
    const sessionId = previous?.id || generateEntityId('ai_session');
    const userMessage = {
      id: generateEntityId('ai_msg'),
      role: 'user',
      content: prompt,
      images: images?.length ? images : undefined,
      files: files?.length ? files : undefined,
      timestamp: now,
      status: 'sent',
    };
    const assistantMessage = {
      id: generateEntityId('ai_msg'),
      role: 'assistant',
      content: assistantContent || (type === 'video' ? '正在提交视频任务...' : '正在提交图片任务...'),
      ...(type === 'video'
        ? { videoGenerationStage: 'submitting' }
        : (type === 'image' ? { imageGenerationStage: 'submitting' } : {})),
      timestamp: now,
      status: 'streaming',
    };
    const previousMessages = previous?.messages || [];
    const shouldSetTitle = (!previous?.title || previous.title === '新对话') && previousMessages.length === 0;
    const titleSource = String(titleText || prompt || '').trim() || '新对话';
    const title = shouldSetTitle
      ? (titleSource.length > 30 ? `${titleSource.slice(0, 30)}...` : titleSource)
      : (previous?.title || '新对话');
    const session = upsertAiSession(ownerLookup.ownerRef, {
      ...(previous || {}),
      id: sessionId,
      title,
      messages: [...previousMessages, userMessage, assistantMessage],
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      ownerId: ownerLookup.ownerId,
      ownerType: ownerLookup.ownerType,
      model,
      pendingTaskId: taskId,
    });

    return {
      previousSession,
      session,
      userMessage: session.messages?.find(message => message.id === userMessage.id) || userMessage,
      assistantMessage: session.messages?.find(message => message.id === assistantMessage.id) || assistantMessage,
    };
  }

  function compensateMediaTaskSubmission({ ownerRef, taskId, stagedSession, removeVideoJob = false }) {
    const activeTask = getAiTask(taskId);
    if (activeTask) {
      try {
        cancelAiTask(taskId, { remove: true });
      } catch (error) {
        console.error(`Failed to deactivate media task ${taskId}:`, error);
      }
    }

    if (removeVideoJob && typeof videoJobStore?.removeVideoJob === 'function') {
      try {
        videoJobStore.removeVideoJob(taskId);
      } catch (error) {
        console.error(`Failed to remove video job ${taskId}:`, error);
      }
    }

    if (!stagedSession) {
      return;
    }
    try {
      if (stagedSession.previousSession) {
        upsertAiSession(ownerRef, stagedSession.previousSession);
      } else {
        removeAiSession(ownerRef, stagedSession.session.id);
      }
    } catch (error) {
      console.error(`Failed to roll back media task session ${stagedSession.session.id}:`, error);
    }
  }

  function getOwnedTaskResult(req) {
    const task = getAiTask(req.params.taskId);
    if (!task) {
      return { status: 404, error: '任务不存在' };
    }

    if (task.ownerType === 'user') {
      const authenticatedUserId = String(req.authUser?.id || '').trim();
      if (!authenticatedUserId) {
        return { status: 401, error: '登录状态已失效，请重新登录' };
      }
      if (authenticatedUserId !== task.ownerId) {
        return { status: 404, error: '任务不存在' };
      }
      return { task };
    }

    const ownerLookup = resolveRequestOwner(req, req.query);
    if (ownerLookup.error) {
      return { status: ownerLookup.status || 401, error: ownerLookup.error };
    }
    if (task.ownerId !== ownerLookup.ownerId || task.ownerType !== ownerLookup.ownerType) {
      return { status: 404, error: '任务不存在' };
    }
    return { task };
  }

  async function getBaiduSpeechAccessToken() {
    const now = Date.now();
    if (baiduSpeechTokenCache.accessToken && baiduSpeechTokenCache.expiresAt - now > 60_000) {
      return baiduSpeechTokenCache.accessToken;
    }

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: BAIDU_SPEECH_API_KEY,
      client_secret: BAIDU_SPEECH_SECRET_KEY,
    });

    const response = await upstreamFetch(`${BAIDU_SPEECH_TOKEN_URL}?${params.toString()}`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(await getResponseErrorMessage(response, '获取百度语音 Token 失败'));
    }

    const result = await response.json();
    const accessToken = String(result?.access_token || '').trim();
    const expiresIn = Number(result?.expires_in || 0);
    if (!accessToken) {
      throw new Error('百度语音 Token 返回为空');
    }

    baiduSpeechTokenCache.accessToken = accessToken;
    baiduSpeechTokenCache.expiresAt = now + Math.max(60_000, expiresIn * 1000);
    return accessToken;
  }

  async function transcribeAudioWithBaidu({ audioBuffer, cuid = 'chatkitty-server' }) {
    const accessToken = await getBaiduSpeechAccessToken();

    const response = await upstreamFetch(BAIDU_SPEECH_ASR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        format: 'wav',
        rate: 16000,
        channel: 1,
        cuid,
        token: accessToken,
        dev_pid: BAIDU_SPEECH_DEV_PID,
        speech: audioBuffer.toString('base64'),
        len: audioBuffer.length,
      }),
    });

    if (!response.ok) {
      throw new Error(await getResponseErrorMessage(response, '百度语音识别请求失败'));
    }

    const result = await response.json();
    if (Number(result?.err_no || 0) !== 0) {
      throw new Error(String(result?.err_msg || '百度语音识别失败'));
    }

    const transcript = Array.isArray(result?.result)
      ? result.result.map(item => String(item || '').trim()).filter(Boolean).join(' ')
      : '';

    if (!transcript) {
      throw new Error('百度语音识别结果为空');
    }

    return transcript;
  }

  app.get('/api/ai-sessions/:userId', (req, res) => {
    const ownerLookup = String(req.query.ownerType || '').trim() === 'guest'
      ? resolveRequestOwner(req, { guestId: req.params.userId })
      : resolveRequestOwner(req);

    if (ownerLookup.error) {
      return res.status(ownerLookup.status || 400).json({ error: ownerLookup.error });
    }

    res.json({
      sessions: getAiSessions(ownerLookup.ownerRef),
    });
  });

  app.post('/api/ai-sessions', (req, res) => {
    const ownerLookup = resolveRequestOwner(req, req.body);
    const model = req.body.model ? String(req.body.model) : undefined;

    if (ownerLookup.error) {
      return res.status(ownerLookup.status || 400).json({ error: ownerLookup.error });
    }
    if (!consumeGuestOperation(req, ownerLookup)) {
      return res.status(429).json({ error: '访客操作过于频繁，请稍后再试' });
    }

    const session = createAiSession(ownerLookup.ownerRef, {
      model,
      ownerId: ownerLookup.ownerId,
      ownerType: ownerLookup.ownerType,
    });
    res.json({ session });
  });

  app.delete('/api/ai-sessions/:userId', (req, res) => {
    const ownerLookup = String(req.query.ownerType || '').trim() === 'guest'
      ? resolveRequestOwner(req, { guestId: req.params.userId })
      : resolveRequestOwner(req);

    if (ownerLookup.error) {
      return res.status(ownerLookup.status || 400).json({ error: ownerLookup.error });
    }

    if (getAiSessions(ownerLookup.ownerRef).some(session => session?.pendingTaskId)) {
      return res.status(409).json({ error: '当前仍有任务进行中，暂不能删除对话' });
    }
    const deletedCount = removeAllAiSessions(ownerLookup.ownerRef);

    res.json({ success: true, deletedCount });
  });

  app.delete('/api/ai-sessions/:userId/:sessionId', (req, res) => {
    const ownerLookup = String(req.query.ownerType || '').trim() === 'guest'
      ? resolveRequestOwner(req, { guestId: req.params.userId })
      : resolveRequestOwner(req);
    const sessionId = String(req.params.sessionId || '').trim();

    if (ownerLookup.error) {
      return res.status(ownerLookup.status || 400).json({ error: ownerLookup.error });
    }

    if (findAiSession(ownerLookup.ownerRef, sessionId)?.pendingTaskId) {
      return res.status(409).json({ error: '当前仍有任务进行中，暂不能删除对话' });
    }
    removeAiSession(ownerLookup.ownerRef, sessionId);

    res.json({ success: true });
  });

  app.post('/api/voice/transcribe', async (req, res) => {
    const compatibilityOwner = resolveCompatibilityOwner(req, req.body);
    if (!consumeGuestOperation(req, compatibilityOwner)) {
      return res.status(429).json({ error: '访客操作过于频繁，请稍后再试' });
    }
    try {
      const audioData = String(req.body.audioData || '').trim();
      const mimeType = String(req.body.mimeType || 'audio/webm').trim() || 'audio/webm';

      if (!audioData) {
        return res.status(400).json({ error: '音频内容不能为空' });
      }
      if (audioData.length > MAX_VOICE_AUDIO_INPUT_LENGTH) {
        return res.status(413).json({ error: '音频内容过大，请缩短录音后重试' });
      }

      const { buffer } = decodeBase64AudioInput(audioData, mimeType);
      if (buffer.length > MAX_VOICE_AUDIO_BYTES) {
        return res.status(413).json({ error: '音频内容过大，请缩短录音后重试' });
      }
      req.body = {};
      const cuid = `chatkitty-${String(req.ip || 'unknown').replace(/[^\w.-]/g, '_')}`;
      const transcript = await compatibilityChatScheduler.schedule({
        id: generateEntityId('voice_transcription'),
        ownerId: compatibilityOwner.ownerId,
        run: () => transcribeAudioWithBaidu({ audioBuffer: buffer, cuid }),
      });

      return res.json({ text: transcript });
    } catch (error) {
      const queueError = getCompatibilityQueueError(error);
      if (queueError) {
        return res.status(queueError.status).json({ error: queueError.error });
      }
      console.error('Failed to transcribe audio', error);
      return res.status(500).json({
        error: '语音转文字失败，请稍后重试',
      });
    }
  });

  app.post('/api/ai-task/chat', (req, res) => {
    const ownerLookup = resolveRequestOwner(req, req.body);

    if (ownerLookup.error) {
      return res.status(ownerLookup.status || 400).json({ error: ownerLookup.error });
    }
    if (!consumeGuestOperation(req, ownerLookup)) {
      return res.status(429).json({ error: '访客操作过于频繁，请稍后再试' });
    }

    let chatInput;
    try {
      chatInput = normalizeChatTaskInput(req.body);
    } catch (error) {
      return res.status(Number(error?.status) || 400).json({
        error: toPublicValidationMessage(error, '消息内容或附件不符合要求'),
      });
    }
    const { content, images, files, apiKey } = chatInput;

    if (!content && !images.length && !files.length) {
      return res.status(400).json({ error: '消息内容不能为空' });
    }

    const model = normalizeChatModel(req.body.model || DEFAULT_CHAT_MODEL);
    const existingSession = findAiSession(ownerLookup.ownerRef, req.body.sessionId);
    if (hasPendingSessionTask(existingSession)) {
      return res.status(409).json({ error: pendingTaskConflictMessage });
    }

    const taskId = generateEntityId('ai_task');
    const isVoiceMode = isKittyVoiceModel(model);
    let stagedSession = null;
    try {
      stagedSession = persistMediaTaskSession({
        ownerLookup,
        requestedSessionId: req.body.sessionId,
        model,
        taskId,
        type: 'chat',
        prompt: content,
        images,
        files,
        assistantContent: isVoiceMode ? VOICE_STREAMING_TEXT : '正在思考...',
        titleText: content || (images.length ? '[图片]' : `[文件] ${files[0]?.fileName || '附件'}`),
      });
      const { session, userMessage, assistantMessage } = stagedSession;
      const now = Date.now();
      const task = {
        id: taskId,
        userId: ownerLookup.ownerType === 'user' ? ownerLookup.ownerId : '',
        ownerId: ownerLookup.ownerId,
        ownerType: ownerLookup.ownerType,
        sessionId: session.id,
        messageId: assistantMessage.id,
        userMessageId: userMessage.id,
        inputMessage: {
          id: userMessage.id,
          role: 'user',
          content,
          images: images.length ? [...images] : undefined,
          files: files.length ? [...files] : undefined,
          timestamp: userMessage.timestamp,
          status: 'sent',
        },
        type: 'chat',
        status: 'pending',
        error: '',
        createdAt: now,
        updatedAt: now,
        apiKey: apiKey || DEFAULT_CHAT_API_KEY,
        model,
        temperature: req.body.temperature ?? 0.7,
        maxTokens: req.body.maxTokens ?? 2048,
        topP: req.body.topP ?? 1,
        enableWebSearch: req.body.enableWebSearch ?? DEFAULT_ENABLE_WEB_SEARCH,
      };

      registerAiTask(task);
      setTimeout(() => {
        runAiTaskInBackground(task.id);
      }, 0);

      return res.json({
        task: serializeAiTask(task),
        sessionId: session.id,
        messageId: assistantMessage.id,
      });
    } catch (error) {
      compensateMediaTaskSubmission({
        ownerRef: ownerLookup.ownerRef,
        taskId,
        stagedSession,
      });
      console.error('Failed to create chat task:', error);
      return res.status(500).json({ error: '聊天任务提交失败，请稍后重试' });
    }
  });

  app.post('/api/ai-task/image', async (req, res) => {
    if (!req.authUser?.id) {
      return res.status(401).json({ error: loginRequiredMessage });
    }

    const ownerLookup = resolveRequestOwner(req, req.body);

    if (ownerLookup.error) {
      return res.status(ownerLookup.status || 401).json({ error: ownerLookup.error });
    }

    const prompt = String(req.body.prompt || '').trim();
    let imageCount;
    try {
      imageCount = getRequestedImageCount(prompt);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    let explicitImages;
    try {
      explicitImages = normalizeImageReferenceList(req.body.images);
    } catch (error) {
      return res.status(400).json({
        error: toPublicValidationMessage(error, '图片引用数量或大小不符合要求'),
      });
    }

    let imageProvider;
    try {
      imageProvider = resolveImageProvider(req.body.imageProvider);
    } catch {
      return res.status(400).json({ error: '不支持的图片生成模型' });
    }

    if (!imageProvider.apiKey) {
      return res.status(503).json({ error: `${imageProvider.label} 图片模型尚未配置` });
    }

    if (!prompt) {
      return res.status(400).json({ error: '描述不能为空' });
    }

    const session = findAiSession(ownerLookup.ownerRef, req.body.sessionId);
    const mediaClaim = claimMediaRequest({
      ownerLookup,
      mediaType: 'image',
      requestId: getCompatibleMediaRequestId(req.body.requestId),
      payloadFingerprint: createMediaPayloadFingerprint({
        version: 1,
        sessionId: String(req.body.sessionId || '').trim(),
        prompt,
        imageCount,
        imageProvider: imageProvider.id,
        images: explicitImages,
      }),
    });
    if (mediaClaim.claimError) {
      return res.status(mediaClaim.status).json({ error: mediaClaim.error });
    }
    if (!mediaClaim.created) {
      return sendExistingMediaRequest(res, mediaClaim);
    }
    if (hasPendingSessionTask(session)) {
      abortMediaRequestClaim(mediaClaim);
      return res.status(409).json({ error: pendingTaskConflictMessage });
    }

    let displayImages;
    try {
      displayImages = resolveImageTaskReferences({ prompt, explicitImages, session });
    } catch (error) {
      abortMediaRequestClaim(mediaClaim);
      return res.status(400).json({
        error: toPublicValidationMessage(error, '图片引用不可用，请重新上传图片'),
      });
    }

    const taskId = generateEntityId('ai_task');
    const reservationError = reserveMediaPoints({
      taskId,
      userId: ownerLookup.ownerId,
      costUnits: (imageProvider.id === 'grok' ? MEDIA_COST_UNITS.grok : MEDIA_COST_UNITS.gpt) * imageCount,
      taskType: 'image',
      imageUnitCost: imageProvider.id === 'grok' ? MEDIA_COST_UNITS.grok : MEDIA_COST_UNITS.gpt,
    });
    if (reservationError) {
      abortMediaRequestClaim(mediaClaim);
      return res.status(reservationError.status).json({ error: reservationError.error });
    }

    let taskAccepted = false;
    let stagedSession = null;
    try {
      stagedSession = persistMediaTaskSession({
        ownerLookup,
        requestedSessionId: req.body.sessionId,
        model: imageProvider.model,
        taskId,
        type: 'image',
        prompt,
        images: displayImages,
      });
      const { session: persistedSession, assistantMessage } = stagedSession;

      linkMediaTaskPoints({
        id: taskId,
        sessionId: persistedSession.id,
        messageId: assistantMessage.id,
      });

      let requestImages;
      try {
        requestImages = await resolveImageReferences(displayImages);
      } catch (error) {
        compensateMediaTaskSubmission({
          ownerRef: ownerLookup.ownerRef,
          taskId,
          stagedSession,
        });
        releaseMediaPoints(taskId);
        abortMediaRequestClaim(mediaClaim);
        return res.status(400).json({
          error: toPublicValidationMessage(error, '图片引用不可用，请重新上传图片'),
        });
      }

      const task = {
        id: taskId,
        userId: ownerLookup.ownerId,
        ownerId: ownerLookup.ownerId,
        ownerType: 'user',
        sessionId: persistedSession.id,
        messageId: assistantMessage.id,
        type: 'image',
        status: 'pending',
        error: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        imageProvider: imageProvider.id,
        imageCount,
        imageUnitCost: imageProvider.id === 'grok' ? MEDIA_COST_UNITS.grok : MEDIA_COST_UNITS.gpt,
        imageStage: 'submitting',
        prompt,
        images: requestImages,
        mediaRequestKey: mediaClaim.key || undefined,
      };

      registerAiTask(task);
      acceptMediaRequestClaim(mediaClaim, task);
      taskAccepted = true;
      runAiTaskInBackground(task.id);

      return res.json({
        task: serializeAiTask(task),
        sessionId: persistedSession.id,
        messageId: assistantMessage.id,
      });
    } catch (error) {
      if (!taskAccepted) {
        compensateMediaTaskSubmission({
          ownerRef: ownerLookup.ownerRef,
          taskId,
          stagedSession,
        });
        releaseMediaPoints(taskId);
        abortMediaRequestClaim(mediaClaim);
      }
      console.error('Failed to create image task:', error);
      return res.status(500).json({ error: '图片任务提交失败，请稍后重试' });
    }
  });

  app.post('/api/ai-task/video', (req, res) => {
    if (!req.authUser?.id) {
      return res.status(401).json({ error: loginRequiredMessage });
    }

    const ownerLookup = resolveRequestOwner(req, req.body);
    if (ownerLookup.error) {
      return res.status(ownerLookup.status || 401).json({ error: ownerLookup.error });
    }

    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: '视频提示词不能为空' });
    }
    if (prompt.length > MAX_VIDEO_PROMPT_LENGTH) {
      return res.status(400).json({ error: `视频提示词不能超过 ${MAX_VIDEO_PROMPT_LENGTH} 个字符` });
    }

    const existingSession = findAiSession(ownerLookup.ownerRef, req.body.sessionId);

    let videoInputs;
    try {
      videoInputs = normalizeVideoInputs(req.body);
    } catch (error) {
      return res.status(400).json({
        error: toPublicValidationMessage(error, '视频图片格式不正确'),
      });
    }
    const { image, lastFrame, referenceImages, durationSeconds } = videoInputs;
    const displayImages = [image, lastFrame, ...referenceImages].filter(Boolean);

    const mediaClaim = claimMediaRequest({
      ownerLookup,
      mediaType: 'video',
      requestId: getCompatibleMediaRequestId(req.body.requestId),
      payloadFingerprint: createMediaPayloadFingerprint({
        version: 2,
        sessionId: String(req.body.sessionId || '').trim(),
        prompt,
        image,
        lastFrame,
        referenceImages,
        durationSeconds,
      }),
    });
    if (mediaClaim.claimError) {
      return res.status(mediaClaim.status).json({ error: mediaClaim.error });
    }
    if (!mediaClaim.created) {
      return sendExistingMediaRequest(res, mediaClaim);
    }
    if (hasPendingSessionTask(existingSession)) {
      abortMediaRequestClaim(mediaClaim);
      return res.status(409).json({ error: pendingTaskConflictMessage });
    }

    const taskId = generateEntityId('ai_task');
    const reservationError = reserveMediaPoints({
      taskId,
      userId: ownerLookup.ownerId,
      costUnits: MEDIA_COST_UNITS.video,
      taskType: 'video',
    });
    if (reservationError) {
      abortMediaRequestClaim(mediaClaim);
      return res.status(reservationError.status).json({ error: reservationError.error });
    }

    let taskAccepted = false;
    let stagedSession = null;
    try {
      stagedSession = persistMediaTaskSession({
        ownerLookup,
        requestedSessionId: req.body.sessionId,
        model: VIDEO_API_MODEL,
        taskId,
        type: 'video',
        prompt,
        images: displayImages,
      });
      const {
        session,
        userMessage,
        assistantMessage,
      } = stagedSession;

      const now = Date.now();
      const task = {
        id: taskId,
        userId: ownerLookup.ownerId,
        ownerId: ownerLookup.ownerId,
        ownerType: 'user',
        sessionId: session.id,
        messageId: assistantMessage.id,
        userMessageId: userMessage.id,
        type: 'video',
        status: 'pending',
        error: '',
        prompt,
        image,
        lastFrame,
        referenceImages,
        durationSeconds,
        videoStage: 'submitting',
        createdAt: now,
        updatedAt: now,
        mediaRequestKey: mediaClaim.key || undefined,
      };

      linkMediaTaskPoints(task);
      videoJobStore.createVideoJob(task);
      registerAiTask(task);
      acceptMediaRequestClaim(mediaClaim, task);
      taskAccepted = true;
      runAiTaskInBackground(task.id);

      return res.json({
        task: serializeAiTask(task),
        sessionId: session.id,
        messageId: assistantMessage.id,
      });
    } catch (error) {
      if (!taskAccepted) {
        compensateMediaTaskSubmission({
          ownerRef: ownerLookup.ownerRef,
          taskId,
          stagedSession,
          removeVideoJob: true,
        });
        releaseMediaPoints(taskId);
        abortMediaRequestClaim(mediaClaim);
      }
      console.error('Failed to create video task:', error);
      return res.status(500).json({ error: '视频任务提交失败，请稍后重试' });
    }
  });

  app.get('/api/ai-task/:taskId', (req, res) => {
    const ownership = getOwnedTaskResult(req);
    if (!ownership.task) {
      return res.status(ownership.status).json({ error: ownership.error });
    }

    res.json({ task: serializeAiTask(ownership.task) });
  });

  app.post('/api/ai-task/:taskId/cancel', (req, res) => {
    const ownership = getOwnedTaskResult(req);
    if (!ownership.task) {
      return res.status(ownership.status).json({ error: ownership.error });
    }
    const { task } = ownership;

    if (task.type === 'video') {
      return res.status(409).json({ error: '视频任务提交后不能取消' });
    }

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return res.json({ task: serializeAiTask(task) });
    }

    const cancelledTask = cancelAiTask(task.id);
    res.json({ task: serializeAiTask(cancelledTask) });
  });

  app.post('/api/chat', async (req, res) => {
    const compatibilityOwner = resolveCompatibilityOwner(req, req.body);
    if (!consumeGuestOperation(req, compatibilityOwner)) {
      return res.status(429).json({ error: { message: '访客操作过于频繁，请稍后再试' } });
    }
    try {
      const messages = normalizeLegacyChatMessages(req.body.messages);
      const requestConfig = req.body.config && typeof req.body.config === 'object'
        ? req.body.config
        : {};
      const requestedModel = String(req.body.model || requestConfig.model || DEFAULT_CHAT_MODEL).trim();
      const requestedApiKey = String(req.body.apiKey || '').trim();
      if (requestedModel.length > MAX_CHAT_METADATA_LENGTH || requestedApiKey.length > MAX_CHAT_API_KEY_LENGTH) {
        throw createInputError('聊天配置格式无效');
      }
      const finalModel = normalizeChatModel(requestedModel);
      const finalTemperature = Number(req.body.temperature ?? requestConfig.temperature ?? 0.7);
      const finalMaxTokens = Number(req.body.max_tokens ?? requestConfig.max_tokens ?? 2048);
      const finalTopP = Number(req.body.top_p ?? requestConfig.top_p ?? 1);
      const finalStream = req.body.stream !== undefined ? Boolean(req.body.stream) : true;
      const providerConfig = resolveChatProvider(finalModel, requestedApiKey);
      const finalApiKey = providerConfig.apiKey;
      const finalEnableWebSearch = req.body.enableWebSearch
        ?? requestConfig.enableWebSearch
        ?? DEFAULT_ENABLE_WEB_SEARCH;
      const containsImages = messages.some(message => Array.isArray(message.images) && message.images.length);
      req.body = {};
      const responsesInput = await buildResponsesInput(messages);
      const responsesInstructions = buildResponsesInstructions(messages);

      if (!finalApiKey) {
        return res.status(503).json({ error: { message: '聊天服务暂时不可用，请稍后重试' } });
      }

      if (!responsesInput.length) {
        return res.status(400).json({ error: { message: '消息内容不能为空' } });
      }

      const chatCompletionsMessages = buildChatCompletionsMessages(responsesInput, responsesInstructions);
      const requestBody = providerConfig.protocol === 'chat_completions'
        ? buildChatCompletionsPayload({
            model: providerConfig.model,
            messages: chatCompletionsMessages,
            temperature: finalTemperature,
            maxTokens: finalMaxTokens,
            topP: finalTopP,
            stream: finalStream,
            extraFields: providerConfig.provider === 'deepseek'
              ? { thinking: { type: 'disabled' } }
              : undefined,
          })
        : {
            model: providerConfig.model,
            input: responsesInput,
            instructions: responsesInstructions,
            temperature: finalTemperature,
            max_output_tokens: finalMaxTokens,
            top_p: finalTopP,
            stream: finalStream,
            ...(finalEnableWebSearch
              ? {
                  tools: [{ type: 'web_search' }],
                  tool_choice: 'auto',
                }
              : {}),
          };

      await compatibilityChatScheduler.schedule({
        id: generateEntityId('legacy_chat'),
        ownerId: compatibilityOwner.ownerId,
        run: async () => {
          const response = await upstreamFetch(providerConfig.apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${finalApiKey}`,
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `API Error: ${response.status}`;

            try {
              const errorJson = JSON.parse(errorText);
              errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
            } catch {
              if (errorText) {
                errorMessage = errorText;
              }
            }

            if (containsImages && errorMessage.includes('upstream_error')) {
              errorMessage = `当前接口的 ${finalModel} 暂不支持图片识别，请更换支持视觉的模型或接口。`;
            }

            return res.status(response.status).json({
              error: { message: toPublicAiErrorMessage(errorMessage, 'chat') },
            });
          }

          return streamResponse(res, response);
        },
      });
    } catch (error) {
      const queueError = getCompatibilityQueueError(error);
      if (queueError) {
        return res.status(queueError.status).json({ error: { message: queueError.error } });
      }
      if (error?.code === 'INVALID_CHAT_INPUT' || error?.code === 'CHAT_INPUT_TOO_LARGE') {
        return res.status(Number(error.status) || 400).json({ error: { message: error.message } });
      }
      console.error('Proxy error:', error);
      if (!res.headersSent) res.status(500).json({
        error: { message: toPublicAiErrorMessage(error, 'chat') },
      });
    }
  });

  const legacyImageSubmissions = new Map();

  function getLegacyImageRequestId(req) {
    return String(
      req.body?.requestId
      || req.get('Idempotency-Key')
      || req.get('X-Request-Id')
      || '',
    ).trim();
  }

  function sendLegacyImageTaskResult(res, {
    task,
    imageProvider,
    isImageEdit,
  }) {
    if (!task) {
      return res.status(503).json({ error: '图片任务状态暂时不可用，请稍后重试' });
    }

    if (task.status === 'failed') {
      const error = String(task.error || task.partialContent || '图片生成失败，请稍后重试')
        .replace(/^错误:\s*/u, '');
      return res.status(502).json({ error });
    }
    if (task.status === 'cancelled') {
      return res.status(409).json({ error: '图片生成任务已取消，请重新提交' });
    }
    if (task.status !== 'completed') {
      return res.status(503).json({ error: '图片生成任务仍在处理中，请稍后重试' });
    }
    if (task.pointsFinalized === false) {
      return res.status(503).json({ error: '积分结算尚未完成，图片暂未交付，请稍后重试' });
    }

    const images = Array.isArray(task.partialImages)
      ? task.partialImages.filter(item => typeof item === 'string' && item.trim())
      : [];
    if (!images.length) {
      return res.status(502).json({ error: '上游未返回图片结果' });
    }

    return res.json({
      images,
      mode: isImageEdit ? 'edit' : 'generate',
      model: imageProvider.model || DEFAULT_IMAGE_MODEL,
    });
  }

  async function waitForLegacyImageTask(task, mediaClaim) {
    let currentTask = task || null;
    if (!currentTask && mediaClaim?.record?.status === 'claimed') {
      const submission = legacyImageSubmissions.get(mediaClaim.key);
      if (submission) {
        const submitted = await submission;
        if (submitted?.error) {
          return submitted;
        }
        currentTask = submitted?.task || null;
      }
    }

    if (!currentTask && mediaClaim?.enabled && typeof mediaRequestService?.find === 'function') {
      const latestRecord = mediaRequestService.find(mediaClaim.key);
      if (latestRecord) {
        currentTask = buildPersistedMediaTask(latestRecord);
      }
    }
    if (!currentTask) {
      return { status: 503, error: '图片任务状态恢复中，请稍后重试' };
    }

    if (currentTask.status === 'pending' || currentTask.status === 'running') {
      let activeRun = aiTaskRuns.get(currentTask.id);
      if (!activeRun && currentTask.status === 'pending') {
        activeRun = runTrackedAiTask(currentTask.id);
      }
      if (!activeRun) {
        return { status: 503, error: '图片生成任务正在处理中，请稍后重试' };
      }
      try {
        await activeRun;
      } catch (error) {
        console.error(`Legacy image task ${currentTask.id} failed unexpectedly:`, error);
        const liveTask = getAiTask(currentTask.id);
        if (liveTask && !['completed', 'failed', 'cancelled'].includes(liveTask.status)) {
          cancelAiTask(currentTask.id);
        }
      }
    }

    const liveTask = getAiTask(currentTask.id);
    if (liveTask) {
      return { task: liveTask };
    }
    if (mediaClaim?.enabled && typeof mediaRequestService?.find === 'function') {
      const terminalRecord = mediaRequestService.find(mediaClaim.key);
      const persistedTask = terminalRecord ? buildPersistedMediaTask(terminalRecord) : null;
      if (persistedTask) {
        return { task: persistedTask };
      }
    }
    return { task: currentTask };
  }

  app.post('/api/image-generation', async (req, res) => {
    if (!req.authUser?.id) {
      return res.status(401).json({ error: loginRequiredMessage });
    }

    const requestId = getCompatibleMediaRequestId(getLegacyImageRequestId(req));

    const prompt = String(req.body?.prompt || '').trim();
    let imageCount;
    try {
      imageCount = getRequestedImageCount(prompt);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    let explicitImages;
    try {
      explicitImages = normalizeImageReferenceList(req.body?.images);
    } catch (error) {
      return res.status(400).json({
        error: toPublicValidationMessage(error, '图片引用数量或大小不符合要求'),
      });
    }

    let imageProvider;
    try {
      imageProvider = resolveImageProvider(req.body?.imageProvider);
    } catch {
      return res.status(400).json({ error: '不支持的图片生成模型' });
    }
    if (!prompt) {
      return res.status(400).json({ error: '图片描述不能为空' });
    }
    if (!imageProvider.apiKey) {
      return res.status(503).json({ error: `${imageProvider.label} 图片模型尚未配置` });
    }

    const ownerLookup = resolveRequestOwner(req, req.body);
    const mediaClaim = claimMediaRequest({
      ownerLookup,
      mediaType: 'image',
      requestId,
      payloadFingerprint: createMediaPayloadFingerprint({
        version: 1,
        sessionId: String(req.body?.sessionId || '').trim(),
        prompt,
        imageCount,
        imageProvider: imageProvider.id,
        images: explicitImages,
      }),
    });
    if (mediaClaim.claimError) {
      return res.status(mediaClaim.status).json({ error: mediaClaim.error });
    }

    let task = null;
    if (!mediaClaim.created) {
      const existingResult = await waitForLegacyImageTask(
        buildPersistedMediaTask(mediaClaim.record),
        mediaClaim,
      );
      if (existingResult.error) {
        return res.status(existingResult.status || 503).json({ error: existingResult.error });
      }
      task = existingResult.task;
    } else {
      const prepareSubmission = async () => {
        const existingSession = findAiSession(ownerLookup.ownerRef, req.body?.sessionId);
        if (hasPendingSessionTask(existingSession)) {
          abortMediaRequestClaim(mediaClaim);
          return { status: 409, error: pendingTaskConflictMessage };
        }

        let displayImages;
        try {
          displayImages = resolveImageTaskReferences({
            prompt,
            explicitImages,
            session: existingSession,
          });
        } catch (error) {
          abortMediaRequestClaim(mediaClaim);
          return {
            status: 400,
            error: toPublicValidationMessage(error, '图片引用不可用，请重新上传图片'),
          };
        }

        const taskId = generateEntityId('ai_task');
        const reservationError = reserveMediaPoints({
          taskId,
          userId: ownerLookup.ownerId,
          costUnits: (imageProvider.id === 'grok' ? MEDIA_COST_UNITS.grok : MEDIA_COST_UNITS.gpt) * imageCount,
          taskType: 'image',
          imageUnitCost: imageProvider.id === 'grok' ? MEDIA_COST_UNITS.grok : MEDIA_COST_UNITS.gpt,
        });
        if (reservationError) {
          abortMediaRequestClaim(mediaClaim);
          return reservationError;
        }

        let taskAccepted = false;
        let stagedSession = null;
        try {
          stagedSession = persistMediaTaskSession({
            ownerLookup,
            requestedSessionId: req.body?.sessionId,
            model: imageProvider.model,
            taskId,
            type: 'image',
            prompt,
            images: displayImages,
          });
          const { session: persistedSession, assistantMessage } = stagedSession;

          linkMediaTaskPoints({
            id: taskId,
            sessionId: persistedSession.id,
            messageId: assistantMessage.id,
          });

          let requestImages;
          try {
            requestImages = await resolveImageReferences(displayImages);
          } catch (error) {
            compensateMediaTaskSubmission({
              ownerRef: ownerLookup.ownerRef,
              taskId,
              stagedSession,
            });
            releaseMediaPoints(taskId);
            abortMediaRequestClaim(mediaClaim);
            return {
              status: 400,
              error: toPublicValidationMessage(error, '图片引用不可用，请重新上传图片'),
            };
          }

          const nextTask = {
            id: taskId,
            userId: ownerLookup.ownerId,
            ownerId: ownerLookup.ownerId,
            ownerType: 'user',
            sessionId: persistedSession.id,
            messageId: assistantMessage.id,
            type: 'image',
            status: 'pending',
            error: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            imageProvider: imageProvider.id,
            imageCount,
            imageUnitCost: imageProvider.id === 'grok' ? MEDIA_COST_UNITS.grok : MEDIA_COST_UNITS.gpt,
            imageStage: 'submitting',
            prompt,
            images: requestImages,
            mediaRequestKey: mediaClaim.key || undefined,
          };

          registerAiTask(nextTask);
          acceptMediaRequestClaim(mediaClaim, nextTask);
          taskAccepted = true;
          return { task: nextTask };
        } catch (error) {
          if (!taskAccepted) {
            compensateMediaTaskSubmission({
              ownerRef: ownerLookup.ownerRef,
              taskId,
              stagedSession,
            });
            releaseMediaPoints(taskId);
            abortMediaRequestClaim(mediaClaim);
          }
          console.error('Failed to create legacy image task:', error);
          return { status: 500, error: '图片任务提交失败，请稍后重试' };
        }
      };

      const submissionPromise = prepareSubmission();
      if (mediaClaim.enabled && mediaClaim.key) {
        legacyImageSubmissions.set(mediaClaim.key, submissionPromise);
      }
      let submission;
      try {
        submission = await submissionPromise;
      } finally {
        if (legacyImageSubmissions.get(mediaClaim.key) === submissionPromise) {
          legacyImageSubmissions.delete(mediaClaim.key);
        }
      }
      if (submission.error) {
        return res.status(submission.status || 500).json({ error: submission.error });
      }
      task = submission.task;
    }

    const terminalResult = await waitForLegacyImageTask(task, mediaClaim);
    if (terminalResult.error) {
      return res.status(terminalResult.status || 503).json({ error: terminalResult.error });
    }
    return sendLegacyImageTaskResult(res, {
      task: terminalResult.task,
      imageProvider,
      isImageEdit: explicitImages.length > 0,
    });
  });
}
