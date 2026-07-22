import { describe, expect, it } from 'vitest';
import {
  extractShareUrl,
  normalizeParserResponse,
  resolveParserRequest,
} from '../server/shortVideoParser.js';

describe('short video parser boundary', () => {
  it('extracts a supported Douyin short link from sharing text', () => {
    expect(extractShareUrl('Copy this https://v.douyin.com/abcd/ now')).toBe('https://v.douyin.com/abcd/');
  });

  it('rejects a platform mismatch and non-public URL', () => {
    expect(() => resolveParserRequest('douyin', 'https://www.bilibili.com/video/BV1xx')).toThrow(/platform/i);
    expect(() => resolveParserRequest('douyin', 'http://127.0.0.1/private')).toThrow(/public/i);
  });

  it('only resolves an approved fixed PHP endpoint', () => {
    expect(resolveParserRequest('bilibili', 'https://b23.tv/abc', 'http://127.0.0.1:5201')).toEqual({
      platform: 'bilibili',
      sourceUrl: 'https://b23.tv/abc',
      endpoint: 'http://127.0.0.1:5201/api/bilibili/index.php?url=https%3A%2F%2Fb23.tv%2Fabc',
    });
  });

  it('normalizes video, image and music fields from legacy parser responses', () => {
    expect(normalizeParserResponse({
      code: 200,
      msg: 'ok',
      data: {
        title: 'Example post',
        author: { name: 'Creator' },
        coverUrl: 'https://cdn.example.com/cover.jpg',
        video_url: 'https://cdn.example.com/video.mp4',
        videos: [{ url: 'https://cdn.example.com/video.mp4' }, { url: 'https://cdn.example.com/backup.mp4' }],
        images: [{ image: 'https://cdn.example.com/image.jpg' }],
        music: { playUrl: 'https://cdn.example.com/audio.mp3' },
      },
    }, 'douyin')).toEqual({
      platform: 'douyin',
      title: 'Example post',
      description: '',
      author: 'Creator',
      cover: 'https://cdn.example.com/cover.jpg',
      type: 'video',
      duration: '',
      videos: [
        'https://cdn.example.com/video.mp4',
        'https://cdn.example.com/backup.mp4',
      ],
      images: ['https://cdn.example.com/image.jpg'],
      music: ['https://cdn.example.com/audio.mp3'],
    });
  });
});
