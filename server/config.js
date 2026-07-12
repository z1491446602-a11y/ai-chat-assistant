import path from 'path';

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

export function createServerConfig(rootDir) {
  const storageDir = process.env.STORAGE_DIR || path.join(rootDir, 'storage');
  const dataDir = process.env.DATA_DIR || storageDir;
  const dataFile = process.env.DATA_FILE || path.join(dataDir, 'data.json');
  const legacyImageApiUrl = process.env.IMAGE_API_URL || 'http://tuluo.top:8000';
  const legacyImageApiKey = process.env.IMAGE_API_KEY || '';
  const legacyImageModel = process.env.IMAGE_API_MODEL || 'gpt-image-2';
  const videoAllowedHosts = (process.env.VIDEO_DOWNLOAD_HOSTS || process.env.VIDEO_ALLOWED_HOSTS || 'opcbucket.oss-cn-beijing.aliyuncs.com')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter((host, index, hosts) => host && hosts.indexOf(host) === index);
  const voicecloneDir = path.join(storageDir, 'voiceclone');
  const voiceReplySystemPrompt = process.env.VOICE_REPLY_SYSTEM_PROMPT || '你现在要为语音朗读生成最终回复文本。目标是让下游语音读出来像真人当下自然回应。直接输出最终答复，不要输出思考过程，不要使用 Markdown、标题、列表、代码块、表格、公式标记，也不要输出 #、*、**、LaTeX 这类符号。请使用日常口语，不要书面腔，不要像客服话术。根据用户语境自然匹配语气：安慰时温和，开心时轻快，解释时耐心清楚，暧昧或亲近语境时自然一点，但不要油腻、不要夸张。可以少量使用“嗯”“好呀”“其实”“我觉得”这类口语连接词，但仅在合适时使用，不要每句都带。避免连续感叹号、重复笑声、拟声词堆砌和过多语气词。优先控制在 1 到 3 句、120 字以内；只有用户明确要求详细解释时再适度展开。';

  return {
    PORT: Number(process.env.PORT || 3000),
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
    IMAGE_GROK_GENERATION_URL: process.env.IMAGE_GROK_GENERATION_URL || 'http://tuluo.top:8000/v1/images/generations',
    IMAGE_GROK_EDIT_URL: process.env.IMAGE_GROK_EDIT_URL || 'http://tuluo.top:8000/v1/images/edits',
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
}
