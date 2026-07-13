import { describe, expect, it, vi } from 'vitest';
import {
  buildVideoRequestBody,
  createVideoProvider,
  parseVideoStatus,
} from '../../server/videoProvider.js';

describe('video provider payloads', () => {
  it('builds exact payloads for zero, one, two, and three images', () => {
    expect(buildVideoRequestBody({ model: 'veo', prompt: 'go', images: [] }))
      .toEqual({ model: 'veo', prompt: 'go' });
    expect(buildVideoRequestBody({ model: 'veo', prompt: 'go', images: ['https://a/1.png'] }))
      .toEqual({ model: 'veo', prompt: 'go', image: { image_url: 'https://a/1.png' } });
    expect(buildVideoRequestBody({ model: 'veo', prompt: 'go', images: ['https://a/1.png', 'https://a/2.png'] }))
      .toEqual({
        model: 'veo',
        prompt: 'go',
        images: [{ image_url: 'https://a/1.png' }, { image_url: 'https://a/2.png' }],
      });
    expect(buildVideoRequestBody({ model: 'veo', prompt: 'go', images: ['https://a/1.png', 'https://a/2.png', 'https://a/3.png'] }))
      .toEqual({
        model: 'veo',
        prompt: 'go',
        images: [{ image_url: 'https://a/1.png' }, { image_url: 'https://a/2.png' }, { image_url: 'https://a/3.png' }],
      });
  });

  it('rejects an empty prompt and more than three images', () => {
    expect(() => buildVideoRequestBody({ model: 'veo', prompt: ' ', images: [] })).toThrow(/prompt/i);
    expect(() => buildVideoRequestBody({ model: 'veo', prompt: 'go', images: ['1', '2', '3', '4'] })).toThrow('at most 3 images');
  });
});

describe('video provider status', () => {
  it('normalizes only the four public statuses and completion URL', () => {
    expect(parseVideoStatus({ status: 'queued' })).toEqual({ status: 'queued' });
    expect(parseVideoStatus({ data: { status: 'running' } })).toEqual({ status: 'processing' });
    expect(parseVideoStatus({ status: 'succeeded', video_url: 'https://cdn/video.mp4' }))
      .toEqual({ status: 'completed', video_url: 'https://cdn/video.mp4' });
    expect(parseVideoStatus({ status: 'error', error: { message: 'bad task' } }))
      .toEqual({ status: 'failed', error: 'bad task' });
  });
});

describe('createVideoProvider', () => {
  it('submits once using x-api-key only', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'up-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const provider = createVideoProvider({
      apiUrl: 'https://api.example/v1/videos', apiKey: 'secret', model: 'veo', fetchImpl,
    });

    await expect(provider.submit({ prompt: 'go', images: [] })).resolves.toEqual({
      id: 'up-1', upstreamTaskId: 'up-1', status: 'queued',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'secret',
    });
  });

  it('retries retryable polling responses and returns completion', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed', video_url: 'https://cdn/v.mp4' }), { status: 200 }));
    const sleep = vi.fn().mockResolvedValue();
    const provider = createVideoProvider({
      apiUrl: 'https://api.example/v1/videos', apiKey: 'secret', model: 'veo',
      fetchImpl, sleep, pollIntervalMs: 1, timeoutMs: 1_000, now: (() => { let n = 0; return () => n++; })(),
    });

    const onStage = vi.fn();
    await expect(provider.poll('up-1', onStage)).resolves.toBe('https://cdn/v.mp4');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.every(([delay]) => delay <= 30_000)).toBe(true);
    expect(onStage).toHaveBeenCalledWith('completed');
  });

  it('does not retry a terminal failed status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'failed', error: 'rejected',
    }), { status: 200 }));
    const provider = createVideoProvider({
      apiUrl: 'https://api.example/v1/videos', apiKey: 'secret', model: 'veo', fetchImpl, sleep: vi.fn(),
    });

    await expect(provider.poll('up-1')).rejects.toThrow('rejected');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
