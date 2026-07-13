const FALLBACK_SUGGESTIONS = [
  '总结今天值得关注的国内外新闻',
  '科技：今天 AI 行业有哪些新进展？',
  '财经：今天市场有哪些重要变化？',
  '生活：今天有哪些实用提醒？',
  '开源社区今天有哪些热门项目？',
  '帮我快速了解今天的热门话题',
];

function getChinaDate(date) {
  return new globalThis.Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function parseDailySuggestions(rawContent) {
  const content = String(rawContent || '').trim();
  if (!content) return [];

  let values = [];
  const jsonStart = content.indexOf('[');
  const jsonEnd = content.lastIndexOf(']');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
      if (Array.isArray(parsed)) values = parsed;
    } catch {
      values = [];
    }
  }

  if (!values.length) {
    values = content.split(/\r?\n/).map(line => line
      .replace(/^\s*(?:[-*]|\d+[.)、])\s*/, '')
      .replace(/^["'“”]+|["'“”]+$/g, ''));
  }

  return [...new Set(values
    .filter(value => typeof value === 'string')
    .map(value => value.replace(/\s+/g, ' ').trim())
    .filter(value => value.length >= 8 && value.length <= 64 && !/https?:\/\//i.test(value)))]
    .slice(0, 8);
}

export function createDailySuggestionsService({ generate, now = () => new Date() }) {
  let cachedResult = null;
  let inFlight = null;

  async function get() {
    const date = getChinaDate(now());
    if (cachedResult?.date === date) return cachedResult;
    if (inFlight?.date === date) return inFlight.promise;

    const promise = (async () => {
      try {
        const suggestions = parseDailySuggestions(await generate(date));
        if (suggestions.length < 4) throw new Error('Not enough valid daily suggestions');
        cachedResult = { date, suggestions, source: 'live' };
      } catch (error) {
        console.warn('Daily suggestions generation failed, using fallback:', error instanceof Error ? error.message : error);
        cachedResult = { date, suggestions: FALLBACK_SUGGESTIONS, source: 'fallback' };
      }
      return cachedResult;
    })();

    inFlight = { date, promise };
    try {
      return await promise;
    } finally {
      if (inFlight?.promise === promise) inFlight = null;
    }
  }

  return { get };
}

export function registerDailySuggestionsRoute(app, { performChatCompletion }) {
  const service = createDailySuggestionsService({
    generate: async (date) => {
      const result = await performChatCompletion({
        messages: [
          {
            role: 'system',
            content: '你负责生成聊天助手首页的每日热点提问。必须先联网核对当天信息，不得编造新闻。只输出 JSON 字符串数组，不要 Markdown、解释或来源链接。',
          },
          {
            role: 'user',
            content: `当前北京时间日期是 ${date}。生成 8 个适合普通用户点击提问的当日话题，兼顾国内外新闻、科技 AI、财经、生活和开源。每项 12 至 32 个汉字，以“热点：”“科技：”“财经：”“生活：”等短标签开头，并把具体事件写进问题。`,
          },
        ],
        temperature: 0.35,
        maxTokens: 800,
        enableWebSearch: true,
        signal: globalThis.AbortSignal.timeout(20_000),
      });
      return result.content;
    },
  });

  app.get('/api/daily-suggestions', async (req, res) => {
    const result = await service.get();
    res.setHeader('Cache-Control', 'public, max-age=900, stale-while-revalidate=3600');
    res.json(result);
  });
}
