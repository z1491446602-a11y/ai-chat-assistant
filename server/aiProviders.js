import fs from 'fs';
import path from 'path';
import { appendImageRequestSize, extractRequestedImageAspectRatio, resolveImageRequestSize } from './imageSize.js';
import { buildImageProviderRequest, createImageProviderRegistry } from './imageProvider.js';
import { getGeneratedImageDimensions } from './imageAssets.js';
import { getSingleImageRequestPrompt } from './imageBatch.js';

export function createAiProviders({
  upstreamFetch,
  buildFileContextBlocks,
  saveGeneratedAudio,
  normalizeVoiceAudioBuffer,
  getAudioMimeTypeFromPath,
  parseUpstreamErrorMessage,
  config,
}) {
  const cachedVoiceCloneSamples = new Map();
  const imageProviderRegistry = createImageProviderRegistry(config);

  function trimMessageContent(content, maxChars = config.VOICE_MESSAGE_MAX_CHARS) {
    const normalized = String(content || '').trim();
    if (!normalized || normalized.length <= maxChars) {
      return normalized;
    }

    return `${normalized.slice(0, maxChars)}...`;
  }

  function normalizeVoiceReplyText(text) {
    return sanitizeTextForSpeech(text)
      .replace(/([。！？!?])(?=[^\s])/g, '$1 ')
      .replace(/([，；：,;])(?=[^\s])/g, '$1 ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function buildVoiceReplyMessages(messages, systemPrompt = config.VOICE_REPLY_SYSTEM_PROMPT) {
    const recentMessages = (messages || [])
      .filter(message => message && message.role !== 'system' && hasMessageInput(message))
      .slice(-config.VOICE_HISTORY_LIMIT)
      .map(message => ({
        ...message,
        content: trimMessageContent(message.content),
        images: Array.isArray(message.images) ? message.images.slice(0, 1) : message.images,
        files: Array.isArray(message.files) ? message.files.slice(0, 1) : message.files,
      }));

    return [
      {
        role: 'system',
        content: systemPrompt,
      },
      ...recentMessages,
    ];
  }

  function normalizeChatModel(model) {
    if (!model) {
      return config.DEFAULT_CHAT_MODEL;
    }

    const normalizedModel = String(model).trim();
    if (!normalizedModel) {
      return config.DEFAULT_CHAT_MODEL;
    }

    if (normalizedModel === 'mimo-2.5') {
      return 'mimo-v2.5';
    }

    if (normalizedModel === 'deepseek-v4') {
      return 'deepseek-v4-flash';
    }

    if (normalizedModel === config.KITTY_VOICE_MODEL || normalizedModel === config.KITTY_VOICE_MODEL_2) {
      return normalizedModel;
    }

    return normalizedModel;
  }

  function isKittyVoiceModel(model) {
    const normalizedModel = normalizeChatModel(model);
    return normalizedModel === config.KITTY_VOICE_MODEL || normalizedModel === config.KITTY_VOICE_MODEL_2;
  }

  function resolveKittyVoiceProfile(model) {
    const normalizedModel = String(model || '').trim();
    if (normalizedModel === config.KITTY_VOICE_MODEL_2) {
      return {
        model: config.KITTY_VOICE_MODEL_2,
        samplePath: config.SECOND_VOICECLONE_SAMPLE_PATH,
        stylePrompt: config.MIMO_TTS_STYLE_PROMPT_XIAOTIAN,
        replyPrompt: config.VOICE_REPLY_SYSTEM_PROMPT_XIAOTIAN,
        replyTemperature: 0.52,
      };
    }

    return {
      model: config.KITTY_VOICE_MODEL,
      samplePath: config.DEFAULT_VOICECLONE_SAMPLE_PATH,
      stylePrompt: config.MIMO_TTS_STYLE_PROMPT,
      replyPrompt: config.VOICE_REPLY_SYSTEM_PROMPT_LINGHE,
      replyTemperature: 0.58,
    };
  }

  function resolveChatProvider(model, apiKey) {
    const finalModel = normalizeChatModel(model || config.DEFAULT_CHAT_MODEL);

    if (finalModel === 'mimo-v2.5' || finalModel === 'mimo-v2.5-pro') {
      return {
        provider: 'mimo',
        model: finalModel,
        apiUrl: config.MIMO_CHAT_API_URL,
        apiKey: config.MIMO_CHAT_API_KEY,
        protocol: 'chat_completions',
      };
    }

    if (finalModel === 'deepseek-v4-flash') {
      return {
        provider: 'deepseek',
        model: finalModel,
        apiUrl: config.DEEPSEEK_VOICE_CHAT_API_URL,
        apiKey: config.DEEPSEEK_VOICE_CHAT_API_KEY,
        protocol: 'chat_completions',
      };
    }

    if (finalModel === config.KITTY_VOICE_MODEL || finalModel === config.KITTY_VOICE_MODEL_2) {
      return {
        provider: 'deepseek',
        model: config.DEEPSEEK_VOICE_CHAT_MODEL,
        apiUrl: config.DEEPSEEK_VOICE_CHAT_API_URL,
        apiKey: config.DEEPSEEK_VOICE_CHAT_API_KEY,
        protocol: 'chat_completions',
      };
    }

    return {
      provider: 'default',
      model: finalModel,
      apiUrl: config.DEFAULT_CHAT_API_URL,
      apiKey: apiKey || config.DEFAULT_CHAT_API_KEY,
      protocol: 'responses',
    };
  }

  function buildChatRequestPayload({
    model,
    messages,
    temperature,
    maxTokens,
    topP,
    stream,
    enableWebSearch,
  }) {
    return {
      model,
      input: messages.input,
      instructions: messages.instructions,
      temperature,
      max_output_tokens: maxTokens,
      top_p: topP,
      stream,
      ...(enableWebSearch
        ? {
            tools: [{ type: 'web_search' }],
            tool_choice: 'auto',
          }
        : {}),
    };
  }

  function buildChatCompletionsPayload({
    model,
    messages,
    temperature,
    maxTokens,
    topP,
    stream,
    extraFields,
  }) {
    return {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      top_p: topP,
      stream,
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    };
  }

  function getLatestUserText(messages) {
    const latestUserMessage = [...(messages || [])]
      .reverse()
      .find(message => message?.role === 'user' && typeof message.content === 'string' && message.content.trim());

    return String(latestUserMessage?.content || '').trim();
  }

  function shouldUseWebSearch(messages, enableWebSearch, providerConfig) {
    if (!enableWebSearch || providerConfig?.provider !== 'deepseek' || !config.BOCHA_WEB_SEARCH_API_KEY) {
      return false;
    }

    const query = getLatestUserText(messages);
    if (!query || query.length < 2 || query.length > 300) {
      return false;
    }

    return /联网|搜索|搜一下|查一下|查询|查找|检索|最新|今天|今日|现在|刚刚|目前|近期|新闻|热搜|天气|价格|股价|汇率|比赛|赛程|政策|公告|官网|网址|链接|资料|202[4-9]|20\d{2}年/.test(query);
  }
  function sanitizeSearchText(value, maxLength = 360) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .split('')
      .filter(char => {
        const code = char.charCodeAt(0);
        return code > 31 && code !== 127;
      })
      .join('')
      .trim()
      .slice(0, maxLength);
  }

  function isLowQualitySearchResult(item) {
    const combinedText = `${item?.name || ''} ${item?.url || ''} ${item?.displayUrl || ''} ${item?.snippet || ''}`.toLowerCase();
    return /黄网站|色情|成人|博彩|彩票|开奖记录|无码视频|av|黄色/.test(combinedText);
  }
  function extractBochaSearchResults(json) {
    const values = json?.data?.webPages?.value;
    if (!Array.isArray(values)) {
      return [];
    }

    return values
      .filter(item => item && !isLowQualitySearchResult(item))
      .slice(0, Math.max(1, Math.min(8, Number(config.BOCHA_WEB_SEARCH_COUNT) || 5)))
      .map((item, index) => ({
        index: index + 1,
        title: sanitizeSearchText(item.name, 120),
        url: sanitizeSearchText(item.url || item.displayUrl, 240),
        snippet: sanitizeSearchText(item.summary || item.snippet, 520),
        date: sanitizeSearchText(item.datePublished || item.dateLastCrawled, 80),
        siteName: sanitizeSearchText(item.siteName, 80),
      }))
      .filter(item => item.title || item.snippet || item.url);
  }

  function buildSearchContextMessage(results) {
    if (!results.length) {
      return null;
    }

    const resultLines = results.map(item => [
      `[${item.index}] ${item.title || '\u672a\u547d\u540d\u7ed3\u679c'}`,
      item.url ? `URL: ${item.url}` : '',
      item.date ? `Date: ${item.date}` : '',
      item.siteName ? `Source: ${item.siteName}` : '',
      item.snippet ? `Summary: ${item.snippet}` : '',
    ].filter(Boolean).join('\n')).join('\n\n');

    return {
      role: 'system',
      content: [
        '\u4f60\u53ef\u4ee5\u4f7f\u7528\u4e0b\u9762\u7684\u8054\u7f51\u641c\u7d22\u7ed3\u679c\u56de\u7b54\u7528\u6237\u95ee\u9898\u3002',
        '\u8981\u6c42\uff1a\u4f18\u5148\u57fa\u4e8e\u641c\u7d22\u7ed3\u679c\u56de\u7b54\uff1b\u5982\u679c\u641c\u7d22\u7ed3\u679c\u4e0d\u8db3\u6216\u4e92\u76f8\u77db\u76fe\uff0c\u8981\u660e\u786e\u8bf4\u660e\u4e0d\u786e\u5b9a\uff1b\u6d89\u53ca\u65f6\u6548\u6027\u4fe1\u606f\u65f6\u8bf7\u8bf4\u660e\u4fe1\u606f\u6765\u6e90\u6216\u65e5\u671f\uff1b\u4e0d\u8981\u7f16\u9020\u641c\u7d22\u7ed3\u679c\u4e2d\u6ca1\u6709\u7684\u5177\u4f53\u4e8b\u5b9e\u3002',
        '',
        resultLines,
      ].join('\n'),
    };
  }
  async function fetchBochaWebSearch(query, signal) {
    if (!config.BOCHA_WEB_SEARCH_API_KEY) {
      return [];
    }

    const response = await upstreamFetch(config.BOCHA_WEB_SEARCH_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.BOCHA_WEB_SEARCH_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        count: Math.max(1, Math.min(8, Number(config.BOCHA_WEB_SEARCH_COUNT) || 5)),
        summary: true,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('Bocha web search failed:', response.status, errorText.slice(0, 240));
      return [];
    }

    const json = await response.json();
    return extractBochaSearchResults(json);
  }

  async function augmentChatMessagesWithWebSearch(chatMessages, {
    sourceMessages,
    enableWebSearch,
    providerConfig,
    signal,
  }) {
    if (!shouldUseWebSearch(sourceMessages, enableWebSearch, providerConfig)) {
      return chatMessages;
    }

    try {
      const query = getLatestUserText(sourceMessages);
      const results = await fetchBochaWebSearch(query, signal);
      const searchContextMessage = buildSearchContextMessage(results);
      if (!searchContextMessage) {
        return chatMessages;
      }

      const firstUserIndex = chatMessages.findIndex(message => message.role !== 'system');
      if (firstUserIndex <= 0) {
        return [searchContextMessage, ...chatMessages];
      }

      return [
        ...chatMessages.slice(0, firstUserIndex),
        searchContextMessage,
        ...chatMessages.slice(firstUserIndex),
      ];
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }

      console.warn('Bocha web search augmentation failed:', error);
      return chatMessages;
    }
  }

  function buildTtsChatCompletionPayload({
    text,
    voiceSampleDataUrl,
    stylePrompt = config.MIMO_TTS_STYLE_PROMPT,
    model = config.MIMO_TTS_MODEL,
  }) {
    return {
      model,
      modalities: ['text', 'audio'],
      audio: {
        format: 'wav',
        voice: voiceSampleDataUrl,
      },
      messages: [
        {
          role: 'user',
          content: String(stylePrompt || config.MIMO_TTS_STYLE_PROMPT).trim() || '自然聊天感，语气温柔，停顿自然，带轻微情绪起伏，像真人聊天，不要机械朗读。',
        },
        {
          role: 'assistant',
          content: String(text || '').trim(),
        },
      ],
      stream: false,
    };
  }

  function extractTextContent(json) {
    if (!json || typeof json !== 'object') {
      return '';
    }

    if (typeof json.output_text === 'string') {
      return json.output_text;
    }

    const directContent =
      json.choices?.[0]?.delta?.content ||
      json.choices?.[0]?.message?.content ||
      json.delta?.content ||
      json.content ||
      json.text;

    if (typeof directContent === 'string') {
      return directContent;
    }

    if (Array.isArray(json.output)) {
      return json.output
        .flatMap(item => Array.isArray(item?.content) ? item.content : [])
        .map(item => item?.text || '')
        .join('');
    }

    return '';
  }

  function extractStreamTextContent(json) {
    if (!json || typeof json !== 'object') {
      return '';
    }

    if (typeof json.choices?.[0]?.delta?.content === 'string') {
      return json.choices[0].delta.content;
    }

    if (json.type === 'response.output_text.delta') {
      return json.delta || '';
    }

    if (typeof json.type === 'string' && json.type.startsWith('response.')) {
      return '';
    }

    return extractTextContent(json);
  }

  function hasMessageInput(message) {
    return Boolean(
      message &&
      ((typeof message.content === 'string' && message.content.trim()) ||
        (Array.isArray(message.images) && message.images.length) ||
        (Array.isArray(message.files) && message.files.length))
    );
  }

  async function buildResponsesInput(messages) {
    const result = [];

    for (const message of (messages || []).filter(item => item && item.role !== 'system' && hasMessageInput(item))) {
      const hasImages = Array.isArray(message.images) && message.images.length > 0;
      const hasFiles = Array.isArray(message.files) && message.files.length > 0;

      if (message.role !== 'assistant' && (hasImages || hasFiles)) {
        const content = [];

        if (typeof message.content === 'string' && message.content.trim()) {
          content.push({ type: 'input_text', text: message.content.trim() });
        }

        if (hasFiles) {
          const fileBlocks = await buildFileContextBlocks(message.files, config.UPLOAD_DIR);
          for (const block of fileBlocks) {
            content.push({ type: 'input_text', text: block });
          }
        }

        if (hasImages) {
          for (const imageUrl of message.images) {
            content.push({ type: 'input_image', image_url: imageUrl });
          }
        }

        result.push({
          role: 'user',
          content,
        });
        continue;
      }

      result.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      });
    }

    return result;
  }

  function buildResponsesInstructions(messages) {
    return (messages || [])
      .filter(message => message && message.role === 'system' && typeof message.content === 'string' && message.content.trim())
      .map(message => message.content.trim())
      .join('\n\n') || undefined;
  }

  function buildChatCompletionsMessages(responsesInput, responsesInstructions) {
    const chatMessages = [];

    if (responsesInstructions) {
      chatMessages.push({
        role: 'system',
        content: responsesInstructions,
      });
    }

    for (const message of responsesInput || []) {
      chatMessages.push({
        role: message.role,
        content: Array.isArray(message.content)
          ? message.content
            .map((item) => item.text || item.image_url || '')
            .filter(Boolean)
            .join('\n')
          : message.content,
      });
    }

    return chatMessages;
  }

  function extractResponseFiles(json) {
    if (!Array.isArray(json?.files)) {
      return [];
    }

    return json.files
      .filter(file => file?.fileName && file?.fileUrl)
      .map(file => ({
        fileName: String(file.fileName),
        fileUrl: String(file.fileUrl),
        fileSize: file.fileSize ? Number(file.fileSize) : undefined,
        mimeType: file.mimeType ? String(file.mimeType) : undefined,
      }));
  }

  function mergeResponseFiles(existingFiles = [], incomingFiles = []) {
    const merged = [...existingFiles];

    for (const file of incomingFiles) {
      const alreadyExists = merged.some(existing => (
        existing.fileUrl === file.fileUrl && existing.fileName === file.fileName
      ));

      if (!alreadyExists) {
        merged.push(file);
      }
    }

    return merged;
  }

  function sanitizeTextForSpeech(text) {
    return String(text || '')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
      .replace(/```([\s\S]*?)```/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
      .replace(/\$([^$\n]+)\$/g, '$1')
      .replace(/^\s*[#＃]+\s*/gm, '')
      .replace(/^\s*([*\-+•●▪◦✳✴]+|\d+[.)、])\s+/gm, '')
      .replace(/[*_~`#＃]/g, '')
      .replace(/[【】[\]{}<>]/g, ' ')
      .replace(/[|｜]/g, ' ')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, '\'')
      .replace(/[·•●▪◦◆◇■□※]/g, ' ')
      .replace(/[^\S\r\n]+/g, ' ')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[#*]{2,}/g, ' ')
      .replace(/[=]{2,}/g, '，')
      .replace(/[~]{2,}/g, '，')
      .replace(/[.]{3,}/g, '...')
      .replace(/[。]{2,}/g, '。')
      .replace(/[，,]{2,}/g, '，')
      .replace(/[！!]{2,}/g, '！')
      .replace(/[？?]{2,}/g, '？')
      .replace(/([，。！？；：,.!?;:])(?=\1)/g, '')
      .replace(/(^|[。！？!?，,\s])([哈哈啊呀哇欸诶嗯哦]{3,})(?=[。！？!?，,\s]|$)/g, (_, prefix, interjection) => `${prefix}${interjection.slice(0, 2)}`)
      .replace(/\b([A-Za-z])\s+([A-Za-z])\b/g, '$1$2')
      .replace(/\s{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\n/g, '，')
      .replace(/，([。！？])/g, '$1')
      .replace(/^([，。！？；：,.!?;:])+/, '')
      .replace(/([，；：,.!?])$/, '')
      .trim();
  }

  async function streamResponse(res, response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (text) {
        try {
          const json = JSON.parse(text);
          const content = extractTextContent(json);
          if (content) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
          }
        } catch {
          // Ignore unexpected non-JSON payloads.
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith('data: ')) {
            continue;
          }

          const payload = trimmedLine.slice(6).trim();
          if (payload === '[DONE]') {
            continue;
          }

          try {
            const json = JSON.parse(payload);
            const content = extractStreamTextContent(json);
            if (content) {
              res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
            }
          } catch {
            // Ignore malformed stream lines from upstream.
          }
        }
      }

      res.write('data: [DONE]\n\n');
    } catch (error) {
      console.error('Stream error:', error);
    } finally {
      res.end();
    }
  }

  function buildCompatibleImagePrompt(prompt) {
    const normalizedPrompt = String(prompt || '').trim();
    if (!normalizedPrompt) {
      return '';
    }

    const rewrittenPrompt = normalizedPrompt
      .replace(/明日之后/g, '末日生存手游风格')
      .replace(/快乐10/g, '游乐场区域')
      .replace(/游戏截图/g, '游戏场景画面')
      .replace(/截图/g, '场景画面');

    if (rewrittenPrompt === normalizedPrompt) {
      return normalizedPrompt;
    }

    return [
      '请生成原创游戏风格画面，不要直接复刻任何现有游戏、品牌名称或UI。',
      rewrittenPrompt,
      '整体表现为真实的游戏场景画面，保留用户想要的时间背景、人物动作和环境氛围。',
    ].join(' ');
  }

  function normalizeGeneratedImages(payload) {
    if (!Array.isArray(payload?.data)) {
      return [];
    }

    return payload.data
      .map((item) => {
        if (typeof item?.url === 'string' && item.url.trim()) {
          return item.url.trim();
        }

        if (typeof item?.b64_json === 'string' && item.b64_json.trim()) {
          const buffer = Buffer.from(item.b64_json.trim(), 'base64');
          if (!buffer.length) {
            return '';
          }

          const { mimeType } = detectGeneratedImageAsset(buffer);
          return `data:${mimeType};base64,${item.b64_json.trim()}`;
        }

        return '';
      })
      .filter(Boolean);
  }

  function detectGeneratedImageAsset(buffer) {
    if (buffer.length >= 12) {
      if (
        buffer[0] === 0x52
        && buffer[1] === 0x49
        && buffer[2] === 0x46
        && buffer[3] === 0x46
        && buffer[8] === 0x57
        && buffer[9] === 0x45
        && buffer[10] === 0x42
        && buffer[11] === 0x50
      ) {
        return { extension: '.webp', mimeType: 'image/webp' };
      }
    }

    if (buffer.length >= 8) {
      const isPng = (
        buffer[0] === 0x89
        && buffer[1] === 0x50
        && buffer[2] === 0x4E
        && buffer[3] === 0x47
        && buffer[4] === 0x0D
        && buffer[5] === 0x0A
        && buffer[6] === 0x1A
        && buffer[7] === 0x0A
      );
      if (isPng) {
        return { extension: '.png', mimeType: 'image/png' };
      }
    }

    if (buffer.length >= 3) {
      const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
      if (isJpeg) {
        return { extension: '.jpg', mimeType: 'image/jpeg' };
      }
    }

    if (buffer.length >= 6) {
      const header = buffer.slice(0, 6).toString('ascii');
      if (header === 'GIF87a' || header === 'GIF89a') {
        return { extension: '.gif', mimeType: 'image/gif' };
      }
    }

    return { extension: '.png', mimeType: 'image/png' };
  }

  async function saveGeneratedImageBuffer(buffer, extension, mimeType) {
    const uploadDir = config.UPLOAD_DIR;
    if (!fs.existsSync(uploadDir)) {
      await fs.promises.mkdir(uploadDir, { recursive: true });
    }

    const storedFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${extension || '.png'}`;
    await fs.promises.writeFile(path.join(uploadDir, storedFileName), buffer);
    const dimensions = getGeneratedImageDimensions(buffer);
    return {
      url: `/uploads/${storedFileName}`,
      fileName: storedFileName,
      fileSize: buffer.length,
      mimeType,
      ...dimensions,
    };
  }

  function appendOptionalImageSize(target, prompt = '') {
    return appendImageRequestSize(target, prompt, config.DEFAULT_IMAGE_SIZE);
  }

  async function persistGeneratedImageAssets(payload) {
    if (!Array.isArray(payload?.data)) {
      return [];
    }

    const savedImages = await Promise.all(
      payload.data.map(async (item) => {
        if (typeof item?.b64_json === 'string' && item.b64_json.trim()) {
          const buffer = Buffer.from(item.b64_json.trim(), 'base64');
          if (!buffer.length) {
            return '';
          }

          const { extension, mimeType } = detectGeneratedImageAsset(buffer);
          return saveGeneratedImageBuffer(buffer, extension, mimeType);
        }

        return '';
      })
    );

    return savedImages.filter(Boolean);
  }

  async function resolveGeneratedImageAssets(payload) {
    const upstreamImages = normalizeGeneratedImages(payload);
    if (!upstreamImages.length) {
      return [];
    }

    try {
      const persistedAssets = await persistGeneratedImageAssets(payload);
      if (persistedAssets.length) {
        return persistedAssets;
      }
    } catch (error) {
      console.error('Persist generated images failed, falling back to upstream URLs:', error);
    }

    return upstreamImages.map(url => ({ url }));
  }

  async function resolveGeneratedImages(payload) {
    const assets = await resolveGeneratedImageAssets(payload);
    return assets.map(asset => asset.url).filter(Boolean);
  }

  function getVoiceCloneSampleDataUrl(samplePath = config.DEFAULT_VOICECLONE_SAMPLE_PATH) {
    const resolvedPath = path.resolve(samplePath);

    const cachedSample = cachedVoiceCloneSamples.get(resolvedPath);
    if (cachedSample) {
      return cachedSample;
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`参考音频不存在: ${resolvedPath}`);
    }

    const stats = fs.statSync(resolvedPath);
    if (stats.size > 7.5 * 1024 * 1024) {
      throw new Error('参考音频过大，请控制在 7.5MB 以内');
    }

    const mimeType = getAudioMimeTypeFromPath(resolvedPath);
    const base64 = fs.readFileSync(resolvedPath).toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    cachedVoiceCloneSamples.set(resolvedPath, dataUrl);

    return dataUrl;
  }

  function warmVoiceCloneSamplesCache() {
    const samplePaths = [
      config.DEFAULT_VOICECLONE_SAMPLE_PATH,
      config.SECOND_VOICECLONE_SAMPLE_PATH,
    ];

    for (const samplePath of samplePaths) {
      try {
        getVoiceCloneSampleDataUrl(samplePath);
      } catch (error) {
        console.warn('Failed to warm voice clone sample cache:', error);
      }
    }
  }

  warmVoiceCloneSamplesCache();

  async function performChatCompletion({
    messages,
    apiKey,
    model,
    temperature = 0.7,
    maxTokens = 2048,
    topP = 1,
    enableWebSearch = config.DEFAULT_ENABLE_WEB_SEARCH,
    signal,
  }) {
    const providerConfig = resolveChatProvider(model, apiKey);
    const finalModel = providerConfig.model;
    const finalApiKey = providerConfig.apiKey;
    const finalEnableWebSearch = enableWebSearch ?? config.DEFAULT_ENABLE_WEB_SEARCH;
    const containsImages = Array.isArray(messages) && messages.some(message => Array.isArray(message?.images) && message.images.length);
    const responsesInput = await buildResponsesInput(messages);
    const responsesInstructions = buildResponsesInstructions(messages);

    if (!finalApiKey) {
      throw new Error('API Key is required');
    }

    if (!responsesInput.length) {
      throw new Error('At least one non-system message is required');
    }

    const chatCompletionsMessages = await augmentChatMessagesWithWebSearch(
      buildChatCompletionsMessages(responsesInput, responsesInstructions),
      {
        sourceMessages: messages,
        enableWebSearch: finalEnableWebSearch,
        providerConfig,
        signal,
      },
    );
    const requestBody = providerConfig.protocol === 'chat_completions'
      ? buildChatCompletionsPayload({
          model: finalModel,
          messages: chatCompletionsMessages,
          temperature,
          maxTokens,
          topP,
          stream: false,
          extraFields: providerConfig.provider === 'deepseek'
            ? { thinking: { type: 'disabled' } }
            : undefined,
        })
      : buildChatRequestPayload({
          model: finalModel,
          messages: {
            input: responsesInput,
            instructions: responsesInstructions,
          },
          temperature,
          maxTokens,
          topP,
          stream: false,
          enableWebSearch: finalEnableWebSearch,
        });

    const response = await upstreamFetch(providerConfig.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finalApiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = parseUpstreamErrorMessage(errorText, `API Error: ${response.status}`);

      if (containsImages && errorMessage.includes('upstream_error')) {
        errorMessage = `当前接口的 ${finalModel} 暂不支持图片识别，请更换支持视觉的模型或接口。`;
      }

      throw new Error(errorMessage);
    }

    const json = await response.json();
    return {
      content: extractTextContent(json),
      files: extractResponseFiles(json),
      model: finalModel,
    };
  }

  async function performStreamingChatCompletion({
    messages,
    apiKey,
    model,
    temperature = 0.7,
    maxTokens = 2048,
    topP = 1,
    enableWebSearch = config.DEFAULT_ENABLE_WEB_SEARCH,
    signal,
    onDelta,
    onFiles,
  }) {
    const providerConfig = resolveChatProvider(model, apiKey);
    const finalModel = providerConfig.model;
    const finalApiKey = providerConfig.apiKey;
    const finalEnableWebSearch = enableWebSearch ?? config.DEFAULT_ENABLE_WEB_SEARCH;
    const containsImages = Array.isArray(messages) && messages.some(message => Array.isArray(message?.images) && message.images.length);
    const responsesInput = await buildResponsesInput(messages);
    const responsesInstructions = buildResponsesInstructions(messages);

    if (!finalApiKey) {
      throw new Error('API Key is required');
    }

    if (!responsesInput.length) {
      throw new Error('At least one non-system message is required');
    }

    const chatCompletionsMessages = await augmentChatMessagesWithWebSearch(
      buildChatCompletionsMessages(responsesInput, responsesInstructions),
      {
        sourceMessages: messages,
        enableWebSearch: finalEnableWebSearch,
        providerConfig,
        signal,
      },
    );
    const requestBody = providerConfig.protocol === 'chat_completions'
      ? buildChatCompletionsPayload({
          model: finalModel,
          messages: chatCompletionsMessages,
          temperature,
          maxTokens,
          topP,
          stream: true,
          extraFields: providerConfig.provider === 'deepseek'
            ? { thinking: { type: 'disabled' } }
            : undefined,
        })
      : buildChatRequestPayload({
          model: finalModel,
          messages: {
            input: responsesInput,
            instructions: responsesInstructions,
          },
          temperature,
          maxTokens,
          topP,
          stream: true,
          enableWebSearch: finalEnableWebSearch,
        });

    const response = await upstreamFetch(providerConfig.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finalApiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = parseUpstreamErrorMessage(errorText, `API Error: ${response.status}`);

      if (containsImages && errorMessage.includes('upstream_error')) {
        errorMessage = `当前接口的 ${finalModel} 暂不支持图片识别，请更换支持视觉的模型或接口。`;
      }

      throw new Error(errorMessage);
    }

    let finalContent = '';
    let finalFiles = [];

    const applyChunk = (json) => {
      const delta = extractStreamTextContent(json);
      if (delta) {
        finalContent += delta;
        onDelta?.(finalContent, delta);
      } else {
        const text = extractTextContent(json);
        if (text && !finalContent) {
          finalContent = text;
          onDelta?.(finalContent, text);
        }
      }

      const files = extractResponseFiles(json);
      if (files.length) {
        finalFiles = mergeResponseFiles(finalFiles, files);
        onFiles?.(finalFiles, files);
      }
    };

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await response.json();
      applyChunk(json);
      return {
        content: finalContent,
        files: finalFiles,
        model: finalModel,
      };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return {
        content: finalContent,
        files: finalFiles,
        model: finalModel,
      };
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) {
          continue;
        }

        const payload = trimmedLine.startsWith('data: ')
          ? trimmedLine.slice(6).trim()
          : trimmedLine;

        if (!payload || payload === '[DONE]' || payload === 'null') {
          continue;
        }

        try {
          applyChunk(JSON.parse(payload));
        } catch {
          // Ignore malformed stream chunks from upstream.
        }
      }
    }

    const trailingChunk = buffer.trim();
    if (trailingChunk) {
      const payload = trailingChunk.startsWith('data: ')
        ? trailingChunk.slice(6).trim()
        : trailingChunk;

      if (payload && payload !== '[DONE]' && payload !== 'null') {
        try {
          applyChunk(JSON.parse(payload));
        } catch {
          // Ignore trailing malformed chunk.
        }
      }
    }

    return {
      content: finalContent,
      files: finalFiles,
      model: finalModel,
    };
  }

  async function performVoiceSynthesis({
    text,
    signal,
    voiceModel = config.KITTY_VOICE_MODEL,
  }) {
    const normalizedText = String(text || '').trim();
    const speechText = normalizeVoiceReplyText(normalizedText);

    if (!speechText) {
      throw new Error('语音文本为空');
    }

    const voiceProfile = resolveKittyVoiceProfile(voiceModel);
    const voiceSampleDataUrl = getVoiceCloneSampleDataUrl(voiceProfile.samplePath);

    const response = await upstreamFetch(config.MIMO_CHAT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.MIMO_CHAT_API_KEY}`,
      },
      body: JSON.stringify(buildTtsChatCompletionPayload({
        text: speechText,
        voiceSampleDataUrl,
        stylePrompt: voiceProfile.stylePrompt,
        model: config.MIMO_TTS_MODEL,
      })),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(parseUpstreamErrorMessage(errorText, `Voice API Error: ${response.status}`));
    }

    const payload = await response.json();
    const audioData = payload?.choices?.[0]?.message?.audio?.data || payload?.audio?.data || '';
    const transcript = payload?.choices?.[0]?.message?.audio?.transcript || normalizedText;
    const audioFormat = String(payload?.choices?.[0]?.message?.audio?.format || 'wav').toLowerCase();
    const audioMimeType = audioFormat === 'wav' ? 'audio/wav' : 'audio/mpeg';

    if (!audioData) {
      throw new Error('语音接口未返回音频数据');
    }

    const rawAudioBuffer = Buffer.from(audioData, 'base64');
    const normalizedAudio = audioMimeType === 'audio/wav'
      ? normalizeVoiceAudioBuffer(rawAudioBuffer, transcript || normalizedText)
      : { buffer: rawAudioBuffer, duration: undefined, trimmed: false };

    if (normalizedAudio.trimmed) {
      console.warn('Trimmed abnormal voice audio tail.', {
        textPreview: String(transcript || normalizedText).slice(0, 80),
        finalDuration: normalizedAudio.duration,
      });
    }

    const savedAudio = saveGeneratedAudio({
      audioBuffer: normalizedAudio.buffer,
      mimeType: audioMimeType,
      duration: normalizedAudio.duration,
    });

    return {
      ...savedAudio,
      transcript: String(transcript || normalizedText),
    };
  }

  async function ensureVoiceReplyText({
    messages,
    apiKey,
    model,
    temperature,
    maxTokens,
    topP,
    enableWebSearch,
    signal,
  }) {
    const firstResult = await performChatCompletion({
      messages,
      apiKey,
      model,
      temperature,
      maxTokens,
      topP,
      enableWebSearch,
      signal,
    });

    const firstContent = String(firstResult?.content || '').trim();
    if (firstContent) {
      return firstResult;
    }

    const retryMessages = [
      {
        role: 'system',
        content: 'Provide only the final user-facing answer text. Do not output reasoning. Do not leave the final answer empty.',
      },
      ...messages,
    ];

    return performChatCompletion({
      messages: retryMessages,
      apiKey,
      model,
      temperature,
      maxTokens: Math.max(Number(maxTokens) || 0, 512),
      topP,
      enableWebSearch: false,
      signal,
    });
  }

  async function performSingleImageGeneration({
    prompt,
    images,
    provider,
    signal,
    onProgress,
  }) {
    const providerConfig = imageProviderRegistry.resolve(provider);
    const normalizedPrompt = String(prompt || '').trim();
    const sourceImages = Array.isArray(images) ? images.filter(item => typeof item === 'string' && item.trim()) : [];
    const imageRequestTimeoutMs = Number(config.IMAGE_REQUEST_TIMEOUT_MS || 300_000);
    const isAccountPoolError = (message) => /No available compatible accounts/i.test(String(message || ''));
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    if (!providerConfig.apiKey) {
      throw new Error(`${providerConfig.label} 图片模型尚未配置`);
    }

    if (!providerConfig.generationUrl || !providerConfig.editUrl) {
      throw new Error(`${providerConfig.label} 图片接口地址未配置`);
    }

    if (!normalizedPrompt) {
      throw new Error('Prompt is required');
    }

    const isImageEdit = sourceImages.length > 0;
    const isRateLimitError = (message, status) => (
      status === 429
      || /rate limit|too many requests|limit reached/i.test(String(message || ''))
    );
    const isNetworkFetchError = (error) => (
      error instanceof TypeError
      && /fetch failed/i.test(String(error.message || ''))
    );
    const runWithImageRequestTimeout = async (requestFactory) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new Error('Image request timeout'));
      }, imageRequestTimeoutMs);
      const abortFromParent = () => controller.abort(signal?.reason);

      if (signal) {
        if (signal.aborted) {
          controller.abort(signal.reason);
        } else {
          signal.addEventListener('abort', abortFromParent, { once: true });
        }
      }

      try {
        return await requestFactory(controller.signal);
      } catch (error) {
        if (controller.signal.aborted && !signal?.aborted) {
          throw new Error('图片生成请求超时，请稍后重试');
        }

        throw error;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener?.('abort', abortFromParent);
      }
    };
    const sendImageRequest = async (requestPrompt) => {
      const size = resolveImageRequestSize(requestPrompt, config.DEFAULT_IMAGE_SIZE);
      const aspectRatio = extractRequestedImageAspectRatio(requestPrompt);
      const requestConfig = buildImageProviderRequest({
        provider: providerConfig,
        prompt: requestPrompt,
        images: sourceImages,
        size,
        aspectRatio,
      });
      onProgress?.('submitting');
      const request = runWithImageRequestTimeout((requestSignal) => upstreamFetch(requestConfig.url, {
        ...requestConfig.init,
        signal: requestSignal,
      }));
      onProgress?.('generating');
      return request;
    };
    const sendImageRequestWithRetry = async (requestPrompt) => {
      try {
        return await sendImageRequest(requestPrompt);
      } catch (error) {
        if (!isNetworkFetchError(error)) {
          throw error;
        }

        await sleep(450);
        return sendImageRequest(requestPrompt);
      }
    };

    const extractImageError = async (response) => {
      const errorText = await response.text();
      return parseUpstreamErrorMessage(errorText, `Image API Error: ${response.status}`);
    };

    let requestPrompt = normalizedPrompt;
    let response = await sendImageRequestWithRetry(requestPrompt);
    let errorMessage = '';

    if (!response.ok) {
      errorMessage = await extractImageError(response);
      if (isRateLimitError(errorMessage, response.status)) {
        throw new Error('图片上游当前限流，请稍后重试');
      }

      const compatiblePrompt = !isImageEdit ? buildCompatibleImagePrompt(normalizedPrompt) : '';
      const shouldRetry = isAccountPoolError(errorMessage) || errorMessage.includes('Upstream request failed');

      if (shouldRetry) {
        await sleep(800);
        response = await sendImageRequestWithRetry(requestPrompt);
        if (!response.ok) {
          errorMessage = await extractImageError(response);
        }
      }

      if (!response.ok && !isImageEdit && errorMessage.includes('Upstream request failed') && compatiblePrompt && compatiblePrompt !== normalizedPrompt) {
        requestPrompt = compatiblePrompt;
        response = await sendImageRequestWithRetry(requestPrompt);
        if (!response.ok) {
          errorMessage = await extractImageError(response);
        }
      }

      if (!response.ok) {
        if (isAccountPoolError(errorMessage)) {
          throw new Error('图片上游账号池暂时不可用，请稍后重试');
        }

        if (isRateLimitError(errorMessage, response.status)) {
          throw new Error('图片上游当前限流，请稍后重试');
        }

        throw new Error(errorMessage);
      }
    }

    onProgress?.('receiving');
    const payload = await response.json();
    onProgress?.('persisting');
    const generatedAssets = await resolveGeneratedImageAssets(payload);
    const generatedImages = generatedAssets.map(asset => asset.url).filter(Boolean);

    if (!generatedImages.length) {
      throw new Error('上游未返回图片结果');
    }

    const primaryAsset = generatedAssets[0] || {};
    return {
      images: generatedImages,
      mode: isImageEdit ? 'edit' : 'generate',
      model: providerConfig.model,
      imageProvider: providerConfig.id,
      imageFileName: primaryAsset.fileName,
      imageFileSize: primaryAsset.fileSize,
      imageMimeType: primaryAsset.mimeType,
      imageWidth: primaryAsset.width,
      imageHeight: primaryAsset.height,
    };
  }

  async function performImageGeneration({
    prompt,
    images,
    provider,
    signal,
    onProgress,
    count = 1,
  }) {
    const requestedCount = Number.isSafeInteger(count) && count > 0 ? count : 1;
    const singleImagePrompt = getSingleImageRequestPrompt(prompt);
    const outcomes = await Promise.allSettled(Array.from(
      { length: requestedCount },
      () => performSingleImageGeneration({
        prompt: singleImagePrompt,
        images,
        provider,
        signal,
        onProgress,
      }),
    ));
    const successes = outcomes
      .filter(outcome => outcome.status === 'fulfilled')
      .map(outcome => outcome.value);

    if (!successes.length) {
      const failure = outcomes.find(outcome => outcome.status === 'rejected');
      throw failure?.reason || new Error('Image generation failed');
    }

    const primaryResult = successes[0];
    return {
      ...primaryResult,
      images: successes.flatMap(result => result.images || []),
      completedCount: successes.length,
      failedCount: outcomes.length - successes.length,
    };
  }

  return {
    normalizeChatModel,
    isKittyVoiceModel,
    resolveKittyVoiceProfile,
    resolveChatProvider,
    buildVoiceReplyMessages,
    buildChatRequestPayload,
    buildChatCompletionsPayload,
    buildTtsChatCompletionPayload,
    buildResponsesInput,
    buildResponsesInstructions,
    buildChatCompletionsMessages,
    extractTextContent,
    extractStreamTextContent,
    extractResponseFiles,
    mergeResponseFiles,
    buildCompatibleImagePrompt,
    appendOptionalImageSize,
    resolveGeneratedImages,
    streamResponse,
    performChatCompletion,
    performStreamingChatCompletion,
    performVoiceSynthesis,
    ensureVoiceReplyText,
    performImageGeneration,
    resolveImageProvider: imageProviderRegistry.resolve,
  };
}
