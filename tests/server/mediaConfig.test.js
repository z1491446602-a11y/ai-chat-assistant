import fs from 'fs';
import path from 'path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createServerConfig } from '../../server/config.js';

const ENV_KEYS = [
  'STORAGE_DIR',
  'AUDIO_DIR',
  'LEGACY_AUDIO_DIR',
  'MEDIA_TASK_MAX_CONCURRENCY',
  'IMAGE_TASK_MAX_CONCURRENCY',
  'VIDEO_TASK_MAX_CONCURRENCY',
  'MEDIA_TASK_MAX_QUEUE',
  'MEDIA_TASK_MAX_QUEUED_PER_OWNER',
  'AI_TASK_RETENTION_MS',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('media server config', () => {
  it('documents current and legacy audio directory overrides', () => {
    const envExample = fs.readFileSync(path.resolve('.env.example'), 'utf8');

    expect(envExample).toMatch(/^AUDIO_DIR=/m);
    expect(envExample).toMatch(/^LEGACY_AUDIO_DIR=/m);
  });

  it('stores new audio outside public while retaining the legacy public directory', () => {
    const rootDir = path.resolve('example-root');
    const config = createServerConfig(rootDir);

    expect(config.AUDIO_DIR).toBe(path.join(rootDir, 'storage', 'audios'));
    expect(config.LEGACY_AUDIO_DIR).toBe(path.join(rootDir, 'public', 'audios'));
  });

  it('honors explicit audio directory overrides', () => {
    process.env.AUDIO_DIR = 'D:\\durable-audio';
    process.env.LEGACY_AUDIO_DIR = 'D:\\legacy-audio';

    const config = createServerConfig(path.resolve('example-root'));

    expect(config.AUDIO_DIR).toBe('D:\\durable-audio');
    expect(config.LEGACY_AUDIO_DIR).toBe('D:\\legacy-audio');
  });

  it('uses conservative media task limits and documents every override', () => {
    const config = createServerConfig(path.resolve('example-root'));
    const envExample = fs.readFileSync(path.resolve('.env.example'), 'utf8');

    expect(config).toMatchObject({
      MEDIA_TASK_MAX_CONCURRENCY: 4,
      IMAGE_TASK_MAX_CONCURRENCY: 3,
      VIDEO_TASK_MAX_CONCURRENCY: 1,
      MEDIA_TASK_MAX_QUEUE: 24,
      MEDIA_TASK_MAX_QUEUED_PER_OWNER: 2,
      AI_TASK_RETENTION_MS: 1_800_000,
    });
    for (const key of ENV_KEYS.slice(3)) {
      expect(envExample).toMatch(new RegExp(`^${key}=`, 'm'));
    }
  });

  it('honors valid media task limit overrides', () => {
    process.env.MEDIA_TASK_MAX_CONCURRENCY = '6';
    process.env.IMAGE_TASK_MAX_CONCURRENCY = '4';
    process.env.VIDEO_TASK_MAX_CONCURRENCY = '2';
    process.env.MEDIA_TASK_MAX_QUEUE = '40';
    process.env.MEDIA_TASK_MAX_QUEUED_PER_OWNER = '3';
    process.env.AI_TASK_RETENTION_MS = '900000';

    expect(createServerConfig(path.resolve('example-root'))).toMatchObject({
      MEDIA_TASK_MAX_CONCURRENCY: 6,
      IMAGE_TASK_MAX_CONCURRENCY: 4,
      VIDEO_TASK_MAX_CONCURRENCY: 2,
      MEDIA_TASK_MAX_QUEUE: 40,
      MEDIA_TASK_MAX_QUEUED_PER_OWNER: 3,
      AI_TASK_RETENTION_MS: 900_000,
    });
  });
});
