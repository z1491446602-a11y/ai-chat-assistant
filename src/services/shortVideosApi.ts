export type ShortVideoPlatform = 'douyin' | 'kuaishou' | 'xiaohongshu' | 'bilibili';

export type ShortVideoResult = {
  platform: ShortVideoPlatform;
  title: string;
  description: string;
  author: string;
  cover: string;
  type: 'video' | 'image' | 'live' | 'unknown';
  duration: string;
  videos: string[];
  images: string[];
  music: string[];
  imageDownloads: string[];
  videoDownloads: string[];
};

export async function parseShortVideo(platform: ShortVideoPlatform, url: string) {
  const response = await fetch('/api/short-videos/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ platform, url }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.result) {
    throw new Error(payload?.error || '解析失败，请稍后重试。');
  }
  return payload.result as ShortVideoResult;
}
