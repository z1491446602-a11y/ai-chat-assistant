import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVideoFileStore } from '../../server/videoFiles.js';

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-files-'));
  tempDirs.push(dir);
  return dir;
}

function mp4Buffer(extra = 8) {
  return Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp'), Buffer.alloc(extra)]);
}

function fakeSpawn(metadata) {
  return vi.fn(() => {
    const child = {
      stdout: Readable.from([JSON.stringify(metadata)]),
      stderr: Readable.from([]),
      once(event, callback) {
        if (event === 'error') child.onError = callback;
        if (event === 'close') child.stdout.once('end', () => callback(0));
        return child;
      },
    };
    return child;
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('video file store', () => {
  it('requires HTTPS and an exact hostname allowlist match before fetch', async () => {
    const fetchImpl = vi.fn();
    const store = createVideoFileStore({
      videoDir: makeTempDir(), allowedHosts: ['cdn.example.com'], fetchImpl,
    });

    await expect(store.download({ jobId: 'job-1', videoUrl: 'http://cdn.example.com/v.mp4' })).rejects.toThrow(/HTTPS/);
    await expect(store.download({ jobId: 'job-1', videoUrl: 'https://evil.cdn.example.com/v.mp4' })).rejects.toThrow(/host/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns an allowlisted temporary URL for direct playback without downloading it', () => {
    const fetchImpl = vi.fn();
    const store = createVideoFileStore({
      videoDir: makeTempDir(), allowedHosts: ['vidgen.x.ai'], fetchImpl,
    });

    expect(store.createExternalVideoReference('https://vidgen.x.ai/xai-vidgen-bucket/output.mp4')).toEqual({
      videoUrl: 'https://vidgen.x.ai/xai-vidgen-bucket/output.mp4',
      videoMimeType: 'video/mp4',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('streams, validates, probes, and atomically installs a deterministic MP4', async () => {
    const body = mp4Buffer();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body));
    const spawnImpl = fakeSpawn({
      format: { duration: '2.5' },
      streams: [{ codec_type: 'video', width: 1280, height: 720, avg_frame_rate: '30000/1001' }],
    });
    const videoDir = makeTempDir();
    const store = createVideoFileStore({
      videoDir, maxBytes: 1024, allowedHosts: ['cdn.example.com'], fetchImpl, spawnImpl, sleep: vi.fn(),
    });
    store.ensureVideoDir();

    await expect(store.downloadValidateAndSave({ jobId: 'job-1', videoUrl: 'https://cdn.example.com/v.mp4' })).resolves.toMatchObject({
      videoUrl: '/videos/job-1.mp4', size: body.length, duration: 2.5, width: 1280, height: 720,
    });
    expect(fs.existsSync(path.join(videoDir, 'job-1.mp4'))).toBe(true);
    expect(fs.readdirSync(videoDir).some(name => name.endsWith('.part'))).toBe(false);
    await expect(store.inspectExistingVideo('job-1')).resolves.toMatchObject({ videoUrl: '/videos/job-1.mp4' });
  });

  it('removes partial files after three failed download attempts', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const videoDir = makeTempDir();
    const store = createVideoFileStore({
      videoDir, allowedHosts: ['cdn.example.com'], fetchImpl, sleep: vi.fn(),
    });

    await expect(store.download({ jobId: 'job-1', videoUrl: 'https://cdn.example.com/v.mp4' })).rejects.toThrow('offline');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fs.readdirSync(videoDir)).toEqual([]);
  });
});
