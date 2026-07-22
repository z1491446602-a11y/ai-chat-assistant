import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerConfig } from '../../server/config.js';
import { createEmptyData } from '../../server/storage.js';

const VIDEO_ENV_KEYS = [
  'VIDEO_DIR',
  'HOST',
  'VIDEO_API_URL',
  'VIDEO_QUERY_URL',
  'VIDEO_ASSET_API_URL',
  'VIDEO_API_KEY',
  'VIDEO_API_MODEL',
  'VIDEO_POLL_INTERVAL_MS',
  'VIDEO_ASSET_POLL_INTERVAL_MS',
  'VIDEO_ASSET_TIMEOUT_MS',
  'VIDEO_TIMEOUT_MS',
  'GROK_VIDEO_API_URL',
  'GROK_VIDEO_API_KEY',
  'GROK_VIDEO_POLL_INTERVAL_MS',
  'GROK_VIDEO_TIMEOUT_MS',
  'VIDEO_MAX_BYTES',
  'VIDEO_ALLOWED_HOSTS',
  'FFPROBE_PATH',
];

afterEach(() => {
  for (const key of VIDEO_ENV_KEYS) delete process.env[key];
});

describe('video server config', () => {
  it('uses secure production defaults', () => {
    const rootDir = path.resolve('example-root');
    const config = createServerConfig(rootDir);

    expect(config.HOST).toBe('127.0.0.1');
    expect(config.VIDEO_DIR).toBe(path.join(rootDir, 'storage', 'videos'));
    expect(config.VIDEO_API_URL).toBe('https://api.chancexj.com/v1/seedance/videos');
    expect(config.VIDEO_QUERY_URL).toBe('https://api.chancexj.com/v1/result/{id}');
    expect(config.VIDEO_ASSET_API_URL).toBe('https://api.chancexj.com');
    expect(config.VIDEO_API_KEY).toBe('');
    expect(config.VIDEO_API_MODEL).toBe('seedance_1_5_pro_720p');
    expect(config.VIDEO_POLL_INTERVAL_MS).toBe(20_000);
    expect(config.VIDEO_ASSET_POLL_INTERVAL_MS).toBe(5_000);
    expect(config.VIDEO_ASSET_TIMEOUT_MS).toBe(300_000);
    expect(config.VIDEO_TIMEOUT_MS).toBe(1_800_000);
    expect(config.VIDEO_MAX_BYTES).toBe(209_715_200);
    expect(config.VIDEO_ALLOWED_HOSTS).toEqual(['opcbucket.oss-cn-beijing.aliyuncs.com', 'vidgen.x.ai']);
    expect(config.VIDEO_DOWNLOAD_HOSTS).toEqual(['opcbucket.oss-cn-beijing.aliyuncs.com', 'vidgen.x.ai']);
    expect(config.GROK_VIDEO_API_URL).toBe('');
    expect(config.GROK_VIDEO_API_KEY).toBe('');
    expect(config.FFPROBE_PATH).toBe('ffprobe');
  });

  it('parses an exact comma-separated host allowlist', () => {
    process.env.VIDEO_ALLOWED_HOSTS = ' media.example.com,cdn.example.com, media.example.com ';
    const config = createServerConfig('.');
    expect(config.VIDEO_ALLOWED_HOSTS).toEqual(['media.example.com', 'cdn.example.com']);
    expect(config.VIDEO_DOWNLOAD_HOSTS).toEqual(config.VIDEO_ALLOWED_HOSTS);
  });

  it('allows only the explicit Tuluo HTTP Grok gateway', () => {
    process.env.GROK_VIDEO_API_URL = 'http://tuluo.top:8000';
    expect(createServerConfig('.').GROK_VIDEO_API_URL).toBe('http://tuluo.top:8000');

    process.env.GROK_VIDEO_API_URL = 'http://example.test:8000';
    expect(() => createServerConfig('.')).toThrow('GROK_VIDEO_API_URL');
  });

  it('initializes durable video job storage', () => {
    expect(createEmptyData().videoJobs).toEqual({});
  });
});
