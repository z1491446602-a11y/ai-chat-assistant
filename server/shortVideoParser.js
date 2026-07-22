import { isIP } from 'node:net';

const MAX_SHARE_TEXT_LENGTH = 2_000;
const MAX_TEXT_LENGTH = 500;

export const SHORT_VIDEO_PLATFORMS = Object.freeze({
  douyin: Object.freeze({
    id: 'douyin',
    name: 'Douyin',
    endpoint: '/api/douyin/douyin.php',
    hosts: ['douyin.com', 'iesdouyin.com'],
  }),
  kuaishou: Object.freeze({
    id: 'kuaishou',
    name: 'Kuaishou',
    endpoint: '/api/kuaishou/ksjx.php',
    hosts: ['kuaishou.com', 'gifshow.com'],
  }),
  xiaohongshu: Object.freeze({
    id: 'xiaohongshu',
    name: 'Xiaohongshu',
    endpoint: '/api/xiaohongshu/xhsjx.php',
    hosts: ['xiaohongshu.com', 'xhslink.com', 'xhs.com'],
  }),
  bilibili: Object.freeze({
    id: 'bilibili',
    name: 'Bilibili',
    endpoint: '/api/bilibili/index.php',
    hosts: ['bilibili.com', 'b23.tv'],
  }),
});

function cleanText(value, limit = MAX_TEXT_LENGTH) {
  return String(value || '').trim().replace(/\s+/gu, ' ').slice(0, limit);
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function isPublicHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return Boolean(
      (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && !parsed.username
      && !parsed.password
      && parsed.hostname
      && !isIP(parsed.hostname),
    );
  } catch {
    return false;
  }
}

function uniqueUrls(values) {
  return [...new Set(values
    .filter(isPublicHttpUrl)
    .map(value => String(value).trim()))];
}

function hostnameMatches(hostname, allowedHost) {
  return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);
}

function getPlatform(platformId) {
  return SHORT_VIDEO_PLATFORMS[String(platformId || '').trim().toLowerCase()] || null;
}

export function extractShareUrl(value) {
  const source = String(value || '').trim();
  if (!source || source.length > MAX_SHARE_TEXT_LENGTH) {
    throw new Error('A sharing link is required');
  }

  const match = source.match(/https?:\/\/[^\s\u3002\uff0c\u3001\u300a\u300b"'<>]+/iu);
  const candidate = (match ? match[0] : source).replace(/[\u3002,.!\uff01?\uff1f\u3001]+$/u, '');
  if (!isPublicHttpUrl(candidate)) {
    throw new Error('A public HTTP(S) link is required');
  }

  return new URL(candidate).href;
}

export function resolveParserRequest(platformId, shareText, parserBaseUrl) {
  const platform = getPlatform(platformId);
  if (!platform) {
    throw new Error('Unsupported platform');
  }

  const sourceUrl = extractShareUrl(shareText);
  const source = new URL(sourceUrl);
  const hostname = source.hostname.toLowerCase().replace(/\.$/u, '');
  if (!platform.hosts.some(host => hostnameMatches(hostname, host))) {
    throw new Error('The sharing link does not match the selected platform');
  }

  const endpoint = new URL(platform.endpoint, `${String(parserBaseUrl || '').replace(/\/+$/u, '')}/`);
  endpoint.searchParams.set('url', sourceUrl);
  return {
    platform: platform.id,
    sourceUrl,
    endpoint: endpoint.toString(),
  };
}

function mediaUrl(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value.url || value.image || value.video || '';
  return '';
}

function collectVideoUrls(data) {
  const candidates = data.type === 'image'
    ? [data.video, data.video_url, data.videoUrl, data.download_url]
    : [data.url, data.video, data.video_url, data.videoUrl, data.download_url];
  for (const item of normalizeArray(data.video_backup)) candidates.push(mediaUrl(item));
  for (const item of normalizeArray(data.videos)) candidates.push(mediaUrl(item));
  for (const item of normalizeArray(data.live_photo)) candidates.push(item?.video);
  return uniqueUrls(candidates);
}

function collectImageUrls(data) {
  const candidates = [];
  for (const item of normalizeArray(data.images)) candidates.push(mediaUrl(item));
  for (const item of normalizeArray(data.imgurl)) candidates.push(mediaUrl(item));
  for (const item of normalizeArray(data.live_photo)) {
    if (item?.image && !item?.video) candidates.push(item.image);
  }
  if (data.type === 'image') candidates.push(data.url);
  return uniqueUrls(candidates);
}

function collectMusicUrls(data) {
  return uniqueUrls([data.music?.url, data.music?.playUrl]);
}

export function normalizeParserResponse(payload, platform) {
  const data = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data
    : {};
  const videos = collectVideoUrls(data);
  const images = collectImageUrls(data);
  const music = collectMusicUrls(data);
  const author = typeof data.author === 'string'
    ? data.author
    : data.author?.name || data.auther || data.user?.name || data.userName || '';
  const rawType = cleanText(data.type, 20).toLowerCase();
  const type = ['video', 'image', 'live'].includes(rawType)
    ? rawType
    : videos.length ? 'video' : images.length ? 'image' : 'unknown';

  return {
    platform: String(platform || '').trim(),
    title: cleanText(data.title || data.desc || data.description || 'Untitled'),
    description: cleanText(data.desc || data.description || ''),
    author: cleanText(author, 120),
    cover: isPublicHttpUrl(data.cover || data.coverUrl || data.avatar) ? String(data.cover || data.coverUrl || data.avatar).trim() : '',
    type,
    duration: cleanText(data.duration, 80),
    videos,
    images,
    music,
  };
}
