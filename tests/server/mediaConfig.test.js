import fs from 'fs';
import path from 'path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createServerConfig } from '../../server/config.js';

const ENV_KEYS = ['STORAGE_DIR', 'AUDIO_DIR', 'LEGACY_AUDIO_DIR'];
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
});
