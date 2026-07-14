import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerConfig } from '../../server/config.js';
import { createEmptyData } from '../../server/storage.js';

const VIDEO_ENV_KEYS = [
  'VIDEO_DIR',
  'VIDEO_API_URL',
  'VIDEO_API_KEY',
  'VIDEO_API_MODEL',
  'VIDEO_POLL_INTERVAL_MS',
  'VIDEO_TIMEOUT_MS',
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

    expect(config.VIDEO_DIR).toBe(path.join(rootDir, 'storage', 'videos'));
    expect(config.VIDEO_API_URL).toBe('https://api.chancexj.com/v1/videos');
    expect(config.VIDEO_API_KEY).toBe('');
    expect(config.VIDEO_API_MODEL).toBe('veo_3_1_fast');
    expect(config.VIDEO_POLL_INTERVAL_MS).toBe(10_000);
    expect(config.VIDEO_TIMEOUT_MS).toBe(1_800_000);
    expect(config.VIDEO_MAX_BYTES).toBe(209_715_200);
    expect(config.VIDEO_ALLOWED_HOSTS).toEqual(['opcbucket.oss-cn-beijing.aliyuncs.com']);
    expect(config.VIDEO_DOWNLOAD_HOSTS).toEqual(['opcbucket.oss-cn-beijing.aliyuncs.com']);
    expect(config.FFPROBE_PATH).toBe('ffprobe');
  });

  it('parses an exact comma-separated host allowlist', () => {
    process.env.VIDEO_ALLOWED_HOSTS = ' media.example.com,cdn.example.com, media.example.com ';
    const config = createServerConfig('.');
    expect(config.VIDEO_ALLOWED_HOSTS).toEqual(['media.example.com', 'cdn.example.com']);
    expect(config.VIDEO_DOWNLOAD_HOSTS).toEqual(config.VIDEO_ALLOWED_HOSTS);
  });

  it('initializes durable video job storage', () => {
    expect(createEmptyData().videoJobs).toEqual({});
  });
});
