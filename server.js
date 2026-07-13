import express from 'express';
import compression from 'compression';
import cors from 'cors';
import { createServer } from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildFileContextBlocks } from './fileAttachmentTools.js';
import { createAiProviders } from './server/aiProviders.js';
import {
  createAiTaskStore,
  createChatTaskScheduler,
  reconcileMediaRequestOrphans,
} from './server/aiTasks.js';
import { privateApiNoStore, registerAuthRoutes } from './server/authRoutes.js';
import { createAuthService } from './server/authService.js';
import { createMediaTaskScheduler } from './server/mediaTaskScheduler.js';
import { createMediaRequestService } from './server/mediaRequestService.js';
import { createImageReferenceResolver } from './server/imageReferences.js';
import { createAiSessionStore } from './server/aiSessions.js';
import { createAudioFileStore, getAudioMimeTypeFromPath, normalizeVoiceAudioBuffer } from './server/audioFiles.js';
import { createServerConfig } from './server/config.js';
import { applySameOriginCorsPolicy } from './server/corsPolicy.js';
import { registerDailySuggestionsRoute } from './server/dailySuggestions.js';
import { loadEnvFile } from './server/env.js';
import { createUpstreamFetch } from './server/httpClient.js';
import { registerTerminalErrorHandler } from './server/httpErrors.js';
import { registerAiRoutes } from './server/aiRoutes.js';
import { createDataStore } from './server/storage.js';
import {
  createCompressionFilter,
  getDocumentCacheControl,
  registerSpaFallback,
  registerStaticResourceRoutes,
} from './server/staticDelivery.js';
import {
  createUploadFileStore,
  createUploadHandler,
  createUploadRateLimiter,
  registerUploadEndpoint,
} from './server/uploadFiles.js';
import { parseUpstreamErrorMessage } from './server/upstreamErrors.js';
import { createPointsService } from './server/pointsService.js';
import { createVideoProvider } from './server/videoProvider.js';
import { createVideoFileStore } from './server/videoFiles.js';
import { createVideoJobStore } from './server/videoJobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadEnvFile(path.join(__dirname, '.env'));

const app = express();
const {
  PORT,
  DATA_DIR,
  DATA_FILE,
  DATA_BACKUP_FILE,
  UPLOAD_DIR,
  AUDIO_DIR,
  LEGACY_AUDIO_DIR,
  DEFAULT_VOICECLONE_SAMPLE_PATH,
  SECOND_VOICECLONE_SAMPLE_PATH,
  LEGACY_DATA_FILE,
  DEFAULT_CHAT_API_URL,
  DEFAULT_CHAT_API_KEY,
  DEFAULT_CHAT_MODEL,
  KITTY_VOICE_MODEL,
  KITTY_VOICE_MODEL_2,
  DEEPSEEK_VOICE_CHAT_API_URL,
  DEEPSEEK_VOICE_CHAT_API_KEY,
  DEEPSEEK_VOICE_CHAT_MODEL,
  MIMO_CHAT_API_URL,
  MIMO_CHAT_API_KEY,
  MIMO_TTS_MODEL,
  MIMO_TTS_STYLE_PROMPT,
  MIMO_TTS_STYLE_PROMPT_XIAOTIAN,
  DEFAULT_IMAGE_API_URL,
  DEFAULT_IMAGE_API_KEY,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  IMAGE_DEFAULT_PROVIDER,
  IMAGE_GPT_GENERATION_URL,
  IMAGE_GPT_EDIT_URL,
  IMAGE_GPT_API_KEY,
  IMAGE_GPT_MODEL,
  IMAGE_GROK_GENERATION_URL,
  IMAGE_GROK_EDIT_URL,
  IMAGE_GROK_API_KEY,
  IMAGE_GROK_MODEL,
  VIDEO_DIR,
  VIDEO_API_URL,
  VIDEO_API_KEY,
  VIDEO_API_MODEL,
  VIDEO_POLL_INTERVAL_MS,
  VIDEO_TIMEOUT_MS,
  VIDEO_MAX_BYTES,
  VIDEO_DOWNLOAD_HOSTS,
  FFPROBE_PATH,
  MEDIA_TASK_MAX_CONCURRENCY,
  IMAGE_TASK_MAX_CONCURRENCY,
  VIDEO_TASK_MAX_CONCURRENCY,
  MEDIA_TASK_MAX_QUEUE,
  MEDIA_TASK_MAX_QUEUED_PER_OWNER,
  AI_TASK_RETENTION_MS,
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_SECURE,
  AUTH_SESSION_TTL_MS,
  AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_RATE_LIMIT_MAX,
  ADMIN_PHONE,
  ADMIN_BOOTSTRAP_PASSWORD,
  ADMIN_REAL_NAME,
  REDEEM_CODE_HMAC_SECRET,
  DEFAULT_ENABLE_WEB_SEARCH,
  BOCHA_WEB_SEARCH_API_URL,
  BOCHA_WEB_SEARCH_API_KEY,
  BOCHA_WEB_SEARCH_COUNT,
  VOICE_STREAMING_TEXT,
  VOICE_REPLY_SYSTEM_PROMPT,
  VOICE_REPLY_SYSTEM_PROMPT_LINGHE,
  VOICE_REPLY_SYSTEM_PROMPT_XIAOTIAN,
  VOICE_HISTORY_LIMIT,
  VOICE_MESSAGE_MAX_CHARS,
  VOICE_REPLY_MAX_TOKENS,
  VOICE_REPLY_TEMPERATURE,
  VOICE_REPLY_TOP_P,
  BAIDU_SPEECH_API_KEY,
  BAIDU_SPEECH_SECRET_KEY,
  BAIDU_SPEECH_TOKEN_URL,
  BAIDU_SPEECH_ASR_URL,
  BAIDU_SPEECH_DEV_PID,
  MAX_UPLOAD_SIZE,
  UPLOAD_MAX_TOTAL_BYTES,
  UPLOAD_MAX_FILE_COUNT,
  UPLOAD_RATE_LIMIT_WINDOW_MS,
  UPLOAD_RATE_LIMIT_MAX,
  ALLOWED_FILE_EXTENSIONS,
} = createServerConfig(__dirname);
const { loadData, saveData } = createDataStore({
  dataDir: DATA_DIR,
  dataFile: DATA_FILE,
  dataBackupFile: DATA_BACKUP_FILE,
  legacyDataFile: LEGACY_DATA_FILE,
});
const upstreamFetch = createUpstreamFetch();
const resolveImageReferences = createImageReferenceResolver({ uploadDir: UPLOAD_DIR });
const mediaTaskScheduler = createMediaTaskScheduler({
  maxConcurrent: MEDIA_TASK_MAX_CONCURRENCY,
  imageMaxConcurrent: IMAGE_TASK_MAX_CONCURRENCY,
  videoMaxConcurrent: VIDEO_TASK_MAX_CONCURRENCY,
  ownerMaxConcurrent: 1,
  maxQueued: MEDIA_TASK_MAX_QUEUE,
  maxQueuedPerOwner: MEDIA_TASK_MAX_QUEUED_PER_OWNER,
});
const chatTaskScheduler = createChatTaskScheduler({
  maxConcurrent: 8,
  maxQueued: 32,
  ownerMaxConcurrent: 1,
  maxQueuedPerOwner: 4,
});
const videoProvider = createVideoProvider({
  fetchImpl: upstreamFetch,
  apiUrl: VIDEO_API_URL,
  apiKey: VIDEO_API_KEY,
  model: VIDEO_API_MODEL,
  pollIntervalMs: VIDEO_POLL_INTERVAL_MS,
  timeoutMs: VIDEO_TIMEOUT_MS,
});
const videoFileStore = createVideoFileStore({
  fetchImpl: upstreamFetch,
  videoDir: VIDEO_DIR,
  maxBytes: VIDEO_MAX_BYTES,
  allowedHosts: VIDEO_DOWNLOAD_HOSTS,
  ffprobePath: FFPROBE_PATH,
});
const { saveUploadedFile } = createUploadFileStore({
  uploadDir: UPLOAD_DIR,
  maxUploadSize: MAX_UPLOAD_SIZE,
  maxTotalBytes: UPLOAD_MAX_TOTAL_BYTES,
  maxFileCount: UPLOAD_MAX_FILE_COUNT,
  allowedFileExtensions: ALLOWED_FILE_EXTENSIONS,
});
const uploadRateLimiter = createUploadRateLimiter({
  windowMs: UPLOAD_RATE_LIMIT_WINDOW_MS,
  maxRequests: UPLOAD_RATE_LIMIT_MAX,
});
const uploadHandler = createUploadHandler(saveUploadedFile);
const { saveGeneratedAudio } = createAudioFileStore({
  audioDir: AUDIO_DIR,
});
const aiProviders = createAiProviders({
  upstreamFetch,
  buildFileContextBlocks,
  saveGeneratedAudio,
  normalizeVoiceAudioBuffer,
  getAudioMimeTypeFromPath,
  parseUpstreamErrorMessage,
  config: {
    DEFAULT_CHAT_API_URL,
    DEFAULT_CHAT_API_KEY,
    DEFAULT_CHAT_MODEL,
    KITTY_VOICE_MODEL,
    KITTY_VOICE_MODEL_2,
    DEEPSEEK_VOICE_CHAT_API_URL,
    DEEPSEEK_VOICE_CHAT_API_KEY,
    DEEPSEEK_VOICE_CHAT_MODEL,
    MIMO_CHAT_API_URL,
    MIMO_CHAT_API_KEY,
    MIMO_TTS_MODEL,
    MIMO_TTS_STYLE_PROMPT,
    MIMO_TTS_STYLE_PROMPT_XIAOTIAN,
    DEFAULT_IMAGE_API_URL,
    DEFAULT_IMAGE_API_KEY,
    DEFAULT_IMAGE_MODEL,
    DEFAULT_IMAGE_SIZE,
    IMAGE_DEFAULT_PROVIDER,
    IMAGE_GPT_GENERATION_URL,
    IMAGE_GPT_EDIT_URL,
    IMAGE_GPT_API_KEY,
    IMAGE_GPT_MODEL,
    IMAGE_GROK_GENERATION_URL,
    IMAGE_GROK_EDIT_URL,
    IMAGE_GROK_API_KEY,
    IMAGE_GROK_MODEL,
    DEFAULT_ENABLE_WEB_SEARCH,
    BOCHA_WEB_SEARCH_API_URL,
    BOCHA_WEB_SEARCH_API_KEY,
    BOCHA_WEB_SEARCH_COUNT,
    VOICE_STREAMING_TEXT,
    VOICE_REPLY_SYSTEM_PROMPT,
    VOICE_REPLY_SYSTEM_PROMPT_LINGHE,
    VOICE_REPLY_SYSTEM_PROMPT_XIAOTIAN,
    VOICE_HISTORY_LIMIT,
    VOICE_MESSAGE_MAX_CHARS,
    VOICE_REPLY_MAX_TOKENS,
    VOICE_REPLY_TEMPERATURE,
    VOICE_REPLY_TOP_P,
    DEFAULT_VOICECLONE_SAMPLE_PATH,
    SECOND_VOICECLONE_SAMPLE_PATH,
    UPLOAD_DIR,
  },
});
const {
  normalizeChatModel,
  isKittyVoiceModel,
  resolveKittyVoiceProfile,
  resolveChatProvider,
  buildVoiceReplyMessages,
  buildChatCompletionsPayload,
  buildResponsesInput,
  buildResponsesInstructions,
  buildChatCompletionsMessages,
  streamResponse,
  performChatCompletion,
  performStreamingChatCompletion,
  performVoiceSynthesis,
  ensureVoiceReplyText,
  performImageGeneration,
  resolveImageProvider,
} = aiProviders;
let data = loadData();
if (!data.aiSessions || typeof data.aiSessions !== 'object' || Array.isArray(data.aiSessions)) {
  data.aiSessions = {};
}
const authService = createAuthService({
  data,
  saveData,
  sessionTtlMs: AUTH_SESSION_TTL_MS,
});
const pointsService = createPointsService({
  data,
  saveData,
  redeemCodeHmacSecret: REDEEM_CODE_HMAC_SECRET,
});
const mediaRequestService = createMediaRequestService({ data, saveData });
authService.prune();
if (ADMIN_PHONE || ADMIN_BOOTSTRAP_PASSWORD) {
  if (!ADMIN_PHONE || !ADMIN_BOOTSTRAP_PASSWORD) {
    throw new Error('ADMIN_PHONE and ADMIN_BOOTSTRAP_PASSWORD must be configured together');
  }
  await authService.ensureAdmin({
    phone: ADMIN_PHONE,
    password: ADMIN_BOOTSTRAP_PASSWORD,
    realName: ADMIN_REAL_NAME || '管理员',
  });
}
const videoJobStore = createVideoJobStore({ data, saveData });
let getAiTaskFromStore = () => null;
let findAiSession;
let upsertAiSession;
let patchAiMessage;
let clearAiSessionTask;
let sanitizeAiMessage;
const {
  sanitizeAiMessage: sessionSanitizeAiMessage,
  getAiSessions,
  createAiSession,
  findAiSession: sessionFindAiSession,
  upsertAiSession: sessionUpsertAiSession,
  appendAiMessage,
  patchAiMessage: sessionPatchAiMessage,
  clearAiSessionTask: sessionClearAiSessionTask,
  removeAiSession,
  removeAllAiSessions,
} = createAiSessionStore({
  data,
  saveData,
  normalizeUserId,
  normalizeGuestId,
  generateEntityId,
  getAiTask: (...args) => getAiTaskFromStore(...args),
});
sanitizeAiMessage = sessionSanitizeAiMessage;
findAiSession = sessionFindAiSession;
upsertAiSession = sessionUpsertAiSession;
patchAiMessage = sessionPatchAiMessage;
clearAiSessionTask = sessionClearAiSessionTask;

const {
  getAiTask,
  registerAiTask,
  serializeAiTask,
  runAiTask,
  cancelAiTask,
  resumeVideoJobs,
} = createAiTaskStore({
  findAiSession: (...args) => findAiSession(...args),
  upsertAiSession: (...args) => upsertAiSession(...args),
  patchAiMessage: (...args) => patchAiMessage(...args),
  clearAiSessionTask: (...args) => clearAiSessionTask(...args),
  sanitizeAiMessage: (...args) => sanitizeAiMessage(...args),
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
  settleMediaTask: settlePersistedMediaTask,
  terminalMediaRequest: (requestKey, status) => mediaRequestService.terminal(requestKey, status),
  getMediaRequestKeyForTask: taskId => (
    Object.values(data.mediaRequests || {})
      .find(record => record?.taskId === taskId && record?.status === 'accepted')
      ?.key || ''
  ),
  taskRetentionMs: AI_TASK_RETENTION_MS,
});
getAiTaskFromStore = getAiTask;

app.set('trust proxy', 'loopback');
app.use(privateApiNoStore);

app.use((req, res, next) => {
  const isDocumentRequest = req.method === 'GET' || req.method === 'HEAD';
  const cacheControl = isDocumentRequest ? getDocumentCacheControl(req.path) : '';
  if (cacheControl) {
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
applySameOriginCorsPolicy(app, cors, {
  allowedOrigins: process.env.NODE_ENV === 'development'
    ? ['http://localhost:3001', 'http://127.0.0.1:3001']
    : [],
});
app.use(compression({ filter: createCompressionFilter(compression.filter) }));
registerUploadEndpoint(app, {
  rateLimiter: uploadRateLimiter,
  jsonParser: express.json({ limit: '50mb' }),
  handler: uploadHandler,
});
registerAuthRoutes(app, {
  authService,
  pointsService,
  cookieName: AUTH_COOKIE_NAME,
  cookieSecure: AUTH_COOKIE_SECURE,
  sessionTtlMs: AUTH_SESSION_TTL_MS,
  rateLimitWindowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  rateLimitMax: AUTH_RATE_LIMIT_MAX,
  jsonParser: express.json({ limit: '16kb' }),
});
app.use(express.json({ limit: '50mb' }));
const distDir = path.join(__dirname, 'dist');
registerStaticResourceRoutes(app, {
  distDir,
  audioDir: AUDIO_DIR,
  legacyAudioDir: LEGACY_AUDIO_DIR,
  uploadDir: UPLOAD_DIR,
  videoDir: VIDEO_DIR,
});

function normalizeUserId(userId) {
  return String(userId || '').trim();
}

function settlePersistedMediaTask(taskId, success) {
  return data.pointReservations?.[taskId]
    ? pointsService.settle(taskId, success)
    : null;
}

videoFileStore.ensureVideoDir();
const resumedVideoJobs = resumeVideoJobs();
const reconciledMediaRequests = reconcileMediaRequestOrphans({
  mediaRequestService,
  activeTaskIds: resumedVideoJobs.activeTaskIds || [],
  pointReservations: data.pointReservations,
  getAiSessions,
  findAiSession,
  patchAiMessage,
  clearAiSessionTask,
  settleMediaTask: settlePersistedMediaTask,
  videoJobStore,
});
const reconciledPointReservations = pointsService.reconcileReservations(
  resumedVideoJobs.activeTaskIds || [],
);
if (resumedVideoJobs.recoveredCount || resumedVideoJobs.unknownSubmissionCount) {
  console.log('Video jobs recovery:', resumedVideoJobs);
}
if (reconciledPointReservations.length) {
  console.log(`Reconciled ${reconciledPointReservations.length} point reservations`);
}
if (
  reconciledMediaRequests.completedCount
  || reconciledMediaRequests.failedCount
  || reconciledMediaRequests.cancelledCount
  || reconciledMediaRequests.abortedCount
  || reconciledMediaRequests.terminalPendingClearedCount
  || reconciledMediaRequests.errors.length
) {
  console.log('Media request recovery:', reconciledMediaRequests);
}

function generateEntityId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeGuestId(guestId) {
  return String(guestId || '').trim().replace(/[^\w-]/g, '').slice(0, 80);
}

function resolveAiOwnerFromInput(input = {}) {
  const normalizedUserId = normalizeUserId(input.userId);
  if (normalizedUserId) {
    return {
      ownerRef: { userId: normalizedUserId },
      ownerId: normalizedUserId,
      ownerType: 'user',
      user: null,
    };
  }

  const normalizedGuestId = normalizeGuestId(input.guestId);
  if (normalizedGuestId) {
    return {
      ownerRef: { guestId: normalizedGuestId },
      ownerId: normalizedGuestId,
      ownerType: 'guest',
      user: null,
    };
  }

  return { error: '缺少用户或访客标识' };
}

function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const networkInterface of interfaces[name] || []) {
      if (networkInterface.family === 'IPv4' && !networkInterface.internal) {
        return networkInterface.address;
      }
    }
  }

  return 'localhost';
}

registerAiRoutes(app, {
  upstreamFetch,
  resolveAiOwnerFromInput,
  getAiSessions,
  createAiSession,
  findAiSession,
  upsertAiSession,
  appendAiMessage,
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
  isKittyVoiceModel,
  resolveChatProvider,
  resolveImageProvider,
  buildResponsesInput,
  buildResponsesInstructions,
  buildChatCompletionsMessages,
  buildChatCompletionsPayload,
  streamResponse,
  performStreamingChatCompletion,
  DEFAULT_CHAT_API_KEY,
  DEFAULT_CHAT_MODEL,
  DEFAULT_ENABLE_WEB_SEARCH,
  VOICE_STREAMING_TEXT,
  DEFAULT_IMAGE_MODEL,
  VIDEO_API_MODEL,
  BAIDU_SPEECH_API_KEY,
  BAIDU_SPEECH_SECRET_KEY,
  BAIDU_SPEECH_TOKEN_URL,
  BAIDU_SPEECH_ASR_URL,
  BAIDU_SPEECH_DEV_PID,
});

registerDailySuggestionsRoute(app, { performChatCompletion });

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

registerSpaFallback(app, {
  indexPath: path.join(distDir, 'index.html'),
});
registerTerminalErrorHandler(app);

const server = createServer(app);
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIPAddress();
  console.log('==============================================');
  console.log('AI Chat Server Started');
  console.log('==============================================');
  console.log(`Local:    http://localhost:${PORT}`);
  console.log(`Network:  http://${localIP}:${PORT}`);
  console.log(`Cpolar:   cpolar http ${PORT}`);
  console.log('==============================================');
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please stop other services.`);
    process.exit(1);
  }

  throw error;
});

