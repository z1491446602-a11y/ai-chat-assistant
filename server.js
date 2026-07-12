import express from 'express';
import compression from 'compression';
import cors from 'cors';
import { createServer } from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildFileContextBlocks } from './fileAttachmentTools.js';
import { createAiProviders } from './server/aiProviders.js';
import { createAiTaskStore } from './server/aiTasks.js';
import { createAiSessionStore } from './server/aiSessions.js';
import { createAudioFileStore, getAudioMimeTypeFromPath, normalizeVoiceAudioBuffer } from './server/audioFiles.js';
import { createServerConfig } from './server/config.js';
import { loadEnvFile } from './server/env.js';
import { createUpstreamFetch } from './server/httpClient.js';
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
  buildCompatibleImagePrompt,
  appendOptionalImageSize,
  resolveGeneratedImages,
  streamResponse,
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
});
getAiTaskFromStore = getAiTask;

app.set('trust proxy', 'loopback');

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
app.use(cors());
app.use(compression({ filter: createCompressionFilter(compression.filter) }));
registerUploadEndpoint(app, {
  rateLimiter: uploadRateLimiter,
  jsonParser: express.json({ limit: '50mb' }),
  handler: uploadHandler,
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
videoFileStore.ensureVideoDir();
const resumedVideoJobs = resumeVideoJobs();
if (resumedVideoJobs.recoveredCount || resumedVideoJobs.unknownSubmissionCount) {
  console.log('Video jobs recovery:', resumedVideoJobs);
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
  appendOptionalImageSize,
  buildCompatibleImagePrompt,
  resolveGeneratedImages,
  performStreamingChatCompletion,
  DEFAULT_CHAT_API_KEY,
  DEFAULT_CHAT_MODEL,
  DEFAULT_ENABLE_WEB_SEARCH,
  VOICE_STREAMING_TEXT,
  DEFAULT_IMAGE_API_URL,
  DEFAULT_IMAGE_API_KEY,
  DEFAULT_IMAGE_MODEL,
  VIDEO_API_MODEL,
  BAIDU_SPEECH_API_KEY,
  BAIDU_SPEECH_SECRET_KEY,
  BAIDU_SPEECH_TOKEN_URL,
  BAIDU_SPEECH_ASR_URL,
  BAIDU_SPEECH_DEV_PID,
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

registerSpaFallback(app, {
  indexPath: path.join(distDir, 'index.html'),
});

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

