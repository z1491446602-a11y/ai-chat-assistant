import path from 'path';
import { isIP } from 'node:net';

function readPositiveInteger(name, defaultValue) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim() === '') {
    return defaultValue;
  }

  if (!/^[1-9]\d*$/.test(rawValue)) {
    throw new Error(`${name} must be a positive decimal integer`);
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readBoolean(name, defaultValue) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim() === '') {
    return defaultValue;
  }
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function readRedeemCodeHmacSecret() {
  const value = typeof process.env.REDEEM_CODE_HMAC_SECRET === 'string'
    ? process.env.REDEEM_CODE_HMAC_SECRET
    : '';
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error('REDEEM_CODE_HMAC_SECRET is required in production');
  }
  if (value && Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error('REDEEM_CODE_HMAC_SECRET must contain at least 32 bytes');
  }
  return value;
}

function isPrivateUpstreamHostname(hostname) {
  const normalized = String(hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const [first, second] = normalized.split('.').map(Number);
    return (
      first === 10
      || first === 127
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
    );
  }
  if (ipVersion === 6) {
    if (normalized === '::1') return true;
    if (normalized.startsWith('::ffff:')) return false;
    return /^(?:fc|fd)/u.test(normalized);
  }
  return false;
}

function readRawAuthorityHostname(value) {
  const authorityMatch = String(value || '')
    .trim()
    .match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/iu);
  if (!authorityMatch) return null;

  const authority = authorityMatch[1];
  if (authority.startsWith('[')) {
    const ipv6Match = authority.match(/^\[([^\]]+)\](?::\d+)?$/u);
    return ipv6Match ? { hostname: ipv6Match[1], bracketed: true } : null;
  }

  const hostnameMatch = authority.match(/^([^:@]+)(?::\d+)?$/u);
  return hostnameMatch ? { hostname: hostnameMatch[1], bracketed: false } : null;
}

function isCanonicalIpv4Literal(value) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every(part => (
    /^(?:0|[1-9]\d{0,2})$/u.test(part) && Number(part) <= 255
  ));
}

function isStrictPrivateHttpUrl(value, parsed) {
  const rawHostname = readRawAuthorityHostname(value);
  if (!rawHostname) return false;

  const normalizedRaw = rawHostname.hostname.toLowerCase();
  const normalizedParsed = String(parsed.hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/gu, '');
  if (normalizedRaw !== normalizedParsed) return false;

  const ipVersion = isIP(normalizedParsed);
  if (ipVersion === 4) {
    return !rawHostname.bracketed
      && isCanonicalIpv4Literal(normalizedRaw)
      && isPrivateUpstreamHostname(normalizedParsed);
  }
  if (ipVersion === 6) {
    return rawHostname.bracketed
      && !normalizedParsed.startsWith('::ffff:')
      && isPrivateUpstreamHostname(normalizedParsed);
  }
  return !rawHostname.bracketed && (
    normalizedParsed === 'localhost' || normalizedParsed.endsWith('.localhost')
  );
}

function isSecureUpstreamUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    return false;
  }

  if (parsed.username || parsed.password) return false;
  if (parsed.protocol === 'https:') return true;
  return parsed.protocol === 'http:' && isStrictPrivateHttpUrl(value, parsed);
}

function validateUpstreamUrls(config) {
  const upstreamUrls = [
    ['CHAT_API_URL', config.DEFAULT_CHAT_API_URL],
    ['VIDEO_API_URL', config.VIDEO_API_URL],
    ['DEEPSEEK_VOICE_CHAT_API_URL', config.DEEPSEEK_VOICE_CHAT_API_URL],
    ['MIMO_CHAT_API_URL', config.MIMO_CHAT_API_URL],
    ['IMAGE_API_URL', config.DEFAULT_IMAGE_API_URL],
    ['IMAGE_GPT_GENERATION_URL', config.IMAGE_GPT_GENERATION_URL],
    ['IMAGE_GPT_EDIT_URL', config.IMAGE_GPT_EDIT_URL],
    ['IMAGE_GROK_GENERATION_URL', config.IMAGE_GROK_GENERATION_URL],
    ['IMAGE_GROK_EDIT_URL', config.IMAGE_GROK_EDIT_URL],
    ['BOCHA_WEB_SEARCH_API_URL', config.BOCHA_WEB_SEARCH_API_URL],
    ['BAIDU_SPEECH_TOKEN_URL', config.BAIDU_SPEECH_TOKEN_URL],
    ['BAIDU_SPEECH_ASR_URL', config.BAIDU_SPEECH_ASR_URL],
  ];
  const invalidNames = upstreamUrls
    .filter(([, url]) => typeof url === 'string' && url.trim())
    .filter(([, url]) => !isSecureUpstreamUrl(url))
    .map(([name]) => name);

  if (invalidNames.length) {
    throw new Error(
      `${invalidNames.join(', ')} must use HTTPS without embedded credentials; HTTP is allowed only for canonical loopback or private addresses`,
    );
  }
}

export function createServerConfig(rootDir) {
  const storageDir = process.env.STORAGE_DIR || path.join(rootDir, 'storage');
  const dataDir = process.env.DATA_DIR || storageDir;
  const dataFile = process.env.DATA_FILE || path.join(dataDir, 'data.json');
  const legacyImageApiUrl = process.env.IMAGE_API_URL || '';
  const legacyImageApiKey = process.env.IMAGE_API_KEY || '';
  const legacyImageModel = process.env.IMAGE_API_MODEL || 'gpt-image-2';
  const videoAllowedHosts = (process.env.VIDEO_DOWNLOAD_HOSTS || process.env.VIDEO_ALLOWED_HOSTS || 'opcbucket.oss-cn-beijing.aliyuncs.com')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter((host, index, hosts) => host && hosts.indexOf(host) === index);
  const voicecloneDir = path.join(storageDir, 'voiceclone');
  const voiceReplySystemPrompt = process.env.VOICE_REPLY_SYSTEM_PROMPT || '你现在要为语音朗读生成最终回复文本。目标是让下游语音读出来像真人当下自然回应。直接输出最终答复，不要输出思考过程，不要使用 Markdown、标题、列表、代码块、表格、公式标记，也不要输出 #、*、**、LaTeX 这类符号。请使用日常口语，不要书面腔，不要像客服话术。根据用户语境自然匹配语气：安慰时温和，开心时轻快，解释时耐心清楚，暧昧或亲近语境时自然一点，但不要油腻、不要夸张。可以少量使用“嗯”“好呀”“其实”“我觉得”这类口语连接词，但仅在合适时使用，不要每句都带。避免连续感叹号、重复笑声、拟声词堆砌和过多语气词。优先控制在 1 到 3 句、120 字以内；只有用户明确要求详细解释时再适度展开。';

  const config = {
    PORT: Number(process.env.PORT || 3000),
    AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME?.trim() || 'chat_auth',
    AUTH_COOKIE_SECURE: readBoolean(
      'AUTH_COOKIE_SECURE',
      process.env.NODE_ENV === 'production',
    ),
    AUTH_SESSION_TTL_MS: readPositiveInteger('AUTH_SESSION_TTL_MS', 2_592_000_000),
    AUTH_RATE_LIMIT_WINDOW_MS: readPositiveInteger('AUTH_RATE_LIMIT_WINDOW_MS', 900_000),
    AUTH_RATE_LIMIT_MAX: readPositiveInteger('AUTH_RATE_LIMIT_MAX', 10),
    ADMIN_PHONE: process.env.ADMIN_PHONE?.trim() || '',
    ADMIN_BOOTSTRAP_PASSWORD: process.env.ADMIN_BOOTSTRAP_PASSWORD || '',
    ADMIN_REAL_NAME: process.env.ADMIN_REAL_NAME?.trim() || '',
    REDEEM_CODE_HMAC_SECRET: readRedeemCodeHmacSecret(),
    STORAGE_DIR: storageDir,
    DATA_DIR: dataDir,
    DATA_FILE: dataFile,
    DATA_BACKUP_FILE: `${dataFile}.bak`,
    UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(storageDir, 'uploads'),
    VIDEO_DIR: process.env.VIDEO_DIR || path.join(storageDir, 'videos'),
    VIDEO_API_URL: process.env.VIDEO_API_URL || 'https://api.chancexj.com/v1/videos',
    VIDEO_API_KEY: process.env.VIDEO_API_KEY || '',
    VIDEO_API_MODEL: process.env.VIDEO_API_MODEL || 'veo_3_1_fast',
    VIDEO_POLL_INTERVAL_MS: Number(process.env.VIDEO_POLL_INTERVAL_MS || 10_000),
    VIDEO_TIMEOUT_MS: Number(process.env.VIDEO_TIMEOUT_MS || 600_000),
    VIDEO_MAX_BYTES: Number(process.env.VIDEO_MAX_BYTES || 209_715_200),
    VIDEO_ALLOWED_HOSTS: videoAllowedHosts,
    VIDEO_DOWNLOAD_HOSTS: videoAllowedHosts,
    FFPROBE_PATH: process.env.FFPROBE_PATH || 'ffprobe',
    MEDIA_TASK_MAX_CONCURRENCY: readPositiveInteger('MEDIA_TASK_MAX_CONCURRENCY', 4),
    IMAGE_TASK_MAX_CONCURRENCY: readPositiveInteger('IMAGE_TASK_MAX_CONCURRENCY', 3),
    VIDEO_TASK_MAX_CONCURRENCY: readPositiveInteger('VIDEO_TASK_MAX_CONCURRENCY', 1),
    MEDIA_TASK_MAX_QUEUE: readPositiveInteger('MEDIA_TASK_MAX_QUEUE', 24),
    MEDIA_TASK_MAX_QUEUED_PER_OWNER: readPositiveInteger('MEDIA_TASK_MAX_QUEUED_PER_OWNER', 2),
    AI_TASK_RETENTION_MS: readPositiveInteger('AI_TASK_RETENTION_MS', 1_800_000),
    AUDIO_DIR: process.env.AUDIO_DIR || path.join(storageDir, 'audios'),
    LEGACY_AUDIO_DIR: process.env.LEGACY_AUDIO_DIR || path.join(rootDir, 'public', 'audios'),
    VOICECLONE_DIR: voicecloneDir,
    DEFAULT_VOICECLONE_SAMPLE_PATH: process.env.VOICECLONE_SAMPLE_PATH || path.join(voicecloneDir, 'kitty-reference.wav'),
    SECOND_VOICECLONE_SAMPLE_PATH: process.env.SECOND_VOICECLONE_SAMPLE_PATH || path.join(voicecloneDir, 'kitty-reference-2.wav'),
    LEGACY_DATA_FILE: path.join(rootDir, 'data.json'),
    DEFAULT_CHAT_API_URL: process.env.CHAT_API_URL || 'https://zyapi.tuluo.top:8888/v1/responses',
    DEFAULT_CHAT_API_KEY: process.env.CHAT_API_KEY || '',
    DEFAULT_CHAT_MODEL: process.env.CHAT_API_MODEL || 'gpt-5.4-mini',
    KITTY_VOICE_MODEL: 'kitty-voice',
    KITTY_VOICE_MODEL_2: 'kitty-voice-xiaotian',
    DEEPSEEK_VOICE_CHAT_API_URL: process.env.DEEPSEEK_VOICE_CHAT_API_URL || 'https://api.deepseek.com/chat/completions',
    DEEPSEEK_VOICE_CHAT_API_KEY: process.env.DEEPSEEK_VOICE_CHAT_API_KEY || '',
    DEEPSEEK_VOICE_CHAT_MODEL: process.env.DEEPSEEK_VOICE_CHAT_MODEL || 'deepseek-v4-flash',
    MIMO_CHAT_API_URL: process.env.MIMO_CHAT_API_URL || 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
    MIMO_CHAT_API_KEY: process.env.MIMO_CHAT_API_KEY || '',
    MIMO_TTS_MODEL: process.env.MIMO_TTS_MODEL || 'mimo-v2.5-tts-voiceclone',
    MIMO_TTS_STYLE_PROMPT: process.env.MIMO_TTS_STYLE_PROMPT || '请严格按照文本内容直接合成语音，不要补充额外语气词，不要改写原文。整体像真人在近距离自然聊天，语气松弛、顺口、贴耳，像随口回话，不要用力拿腔。情绪起伏要轻微但真实，跟随句子语义自然变化。语速保持正常聊天节奏，有自然呼吸感，但不要拖，不要懒散。开头不要突然大笑、不要尖叫、不要猛地抬高音量；如果文本里有“哈哈”“哎呀”“啊”等口语词，也要轻一点、短一点、像自然带过，不要鬼畜，不要表演腔。吐字要稳一点，字头字尾尽量完整，但不要为了清楚变成字字分开；遇到人名、地名、数字和重点词时稍微读清楚一点。句内停顿细一点，连读自然一点，句尾自然收住，不要拖腔，不要一字一顿，不要播音腔，不要机器人感。',
    MIMO_TTS_STYLE_PROMPT_XIAOTIAN: process.env.MIMO_TTS_STYLE_PROMPT_XIAOTIAN || '请严格按照文本内容直接合成语音，不要补充额外语气词，不要改写原文。整体像真人在近距离自然聊天，语气松弛、顺口、贴耳，像随口回话，不要用力拿腔。情绪起伏要轻微但真实，跟随句子语义自然变化。语速保持正常聊天节奏，有自然呼吸感，但不要拖，不要懒散。开头不要突然大笑、不要尖叫、不要猛地抬高音量；如果文本里有“哈哈”“哎呀”“啊”等口语词，也要轻一点、短一点、像自然带过，不要鬼畜，不要表演腔。吐字要比凌赫版更清楚一点，字头字尾尽量完整，减少含混连读和糊字；遇到人名、地名、数字、时间和重点词时稍微读清楚一点，但不要为了清楚变成字字分开。句内停顿细一点，连读自然一点，句尾自然收住，不要拖腔，不要一字一顿，不要播音腔，不要机器人感。',
    DEFAULT_IMAGE_API_URL: legacyImageApiUrl,
    DEFAULT_IMAGE_API_KEY: legacyImageApiKey,
    DEFAULT_IMAGE_MODEL: legacyImageModel,
    DEFAULT_IMAGE_SIZE: typeof process.env.IMAGE_API_SIZE === 'string' ? process.env.IMAGE_API_SIZE.trim() : '',
    IMAGE_DEFAULT_PROVIDER: String(process.env.IMAGE_DEFAULT_PROVIDER || 'gpt').trim().toLowerCase(),
    IMAGE_GPT_GENERATION_URL: process.env.IMAGE_GPT_GENERATION_URL || 'https://api.chancexj.com/v1/images/generations',
    IMAGE_GPT_EDIT_URL: process.env.IMAGE_GPT_EDIT_URL || 'https://api.chancexj.com/v1/images/edits',
    IMAGE_GPT_API_KEY: process.env.IMAGE_GPT_API_KEY || (legacyImageModel === 'gpt-image-2' ? legacyImageApiKey : ''),
    IMAGE_GPT_MODEL: process.env.IMAGE_GPT_MODEL || 'gpt-image-2',
    IMAGE_GROK_GENERATION_URL: process.env.IMAGE_GROK_GENERATION_URL || '',
    IMAGE_GROK_EDIT_URL: process.env.IMAGE_GROK_EDIT_URL || '',
    IMAGE_GROK_API_KEY: process.env.IMAGE_GROK_API_KEY || (legacyImageModel === 'grok-imagine-image-quality' ? legacyImageApiKey : ''),
    IMAGE_GROK_MODEL: process.env.IMAGE_GROK_MODEL || 'grok-imagine-image-quality',
    DEFAULT_ENABLE_WEB_SEARCH: process.env.CHAT_ENABLE_WEB_SEARCH !== 'false',
    BOCHA_WEB_SEARCH_API_URL: process.env.BOCHA_WEB_SEARCH_API_URL || 'https://api.bocha.cn/v1/web-search',
    BOCHA_WEB_SEARCH_API_KEY: process.env.BOCHA_WEB_SEARCH_API_KEY || '',
    BOCHA_WEB_SEARCH_COUNT: Number(process.env.BOCHA_WEB_SEARCH_COUNT || 5),
    VOICE_STREAMING_TEXT: '正在说话中...',
    VOICE_REPLY_SYSTEM_PROMPT: voiceReplySystemPrompt,
    VOICE_REPLY_SYSTEM_PROMPT_LINGHE: process.env.VOICE_REPLY_SYSTEM_PROMPT_LINGHE || `${voiceReplySystemPrompt} 回复要更松弛一点，更像真人随口说出来，不要太完整工整，不要像提前写好的稿子。允许少量自然口语连接，比如“嗯”“其实”“就是”“你可以”，但频率要克制。`,
    VOICE_REPLY_SYSTEM_PROMPT_XIAOTIAN: process.env.VOICE_REPLY_SYSTEM_PROMPT_XIAOTIAN || `${voiceReplySystemPrompt} 回复风格尽量接近凌赫版那种自然随口说出来的感觉，但表达上比凌赫版更清楚一点、更好懂一点。不要太完整工整，不要像提前写好的稿子，也不要像逐字朗读。句子尽量短一点、顺一点，允许少量自然口语连接，但频率要克制。`,
    VOICE_HISTORY_LIMIT: Number(process.env.VOICE_HISTORY_LIMIT || 6),
    VOICE_MESSAGE_MAX_CHARS: Number(process.env.VOICE_MESSAGE_MAX_CHARS || 700),
    VOICE_REPLY_MAX_TOKENS: Number(process.env.VOICE_REPLY_MAX_TOKENS || 260),
    VOICE_REPLY_TEMPERATURE: Number(process.env.VOICE_REPLY_TEMPERATURE || 0.58),
    VOICE_REPLY_TOP_P: Number(process.env.VOICE_REPLY_TOP_P || 0.92),
    BAIDU_SPEECH_API_KEY: process.env.BAIDU_SPEECH_API_KEY || '',
    BAIDU_SPEECH_SECRET_KEY: process.env.BAIDU_SPEECH_SECRET_KEY || '',
    BAIDU_SPEECH_TOKEN_URL: process.env.BAIDU_SPEECH_TOKEN_URL || 'https://aip.baidubce.com/oauth/2.0/token',
    BAIDU_SPEECH_ASR_URL: process.env.BAIDU_SPEECH_ASR_URL || 'https://vop.baidu.com/server_api',
    BAIDU_SPEECH_DEV_PID: Number(process.env.BAIDU_SPEECH_DEV_PID || 1537),
    MAX_UPLOAD_SIZE: 20 * 1024 * 1024,
    UPLOAD_MAX_TOTAL_BYTES: readPositiveInteger('UPLOAD_MAX_TOTAL_BYTES', 1_073_741_824),
    UPLOAD_MAX_FILE_COUNT: readPositiveInteger('UPLOAD_MAX_FILE_COUNT', 5_000),
    UPLOAD_RATE_LIMIT_WINDOW_MS: readPositiveInteger('UPLOAD_RATE_LIMIT_WINDOW_MS', 600_000),
    UPLOAD_RATE_LIMIT_MAX: readPositiveInteger('UPLOAD_RATE_LIMIT_MAX', 30),
    ALLOWED_FILE_EXTENSIONS: new Set([
      '.ppt',
      '.pptx',
      '.pdf',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
      '.txt',
      '.md',
      '.csv',
      '.json',
      '.zip',
      '.rar',
      '.7z',
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.webp',
      '.mp3',
      '.wav',
      '.m4a',
      '.mp4',
      '.mov',
    ]),
  };
  validateUpstreamUrls(config);
  return config;
}
