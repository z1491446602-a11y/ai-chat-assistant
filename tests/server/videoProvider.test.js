import { describe, expect, it, vi } from 'vitest';
import {
  buildVideoRequestBody,
  createVideoProvider,
  parseVideoStatus,
} from '../../server/videoProvider.js';

describe('video provider payloads', () => {
  it('keeps text, first frame, last frame, and subject references in distinct fields', () => {
    expect(buildVideoRequestBody({ model: 'veo', prompt: 'go' })).toEqual({
      model: 'veo', prompt: 'go',
    });
    expect(buildVideoRequestBody({ model: 'veo', prompt: 'go', image: 'https://a/first.png' }))
      .toEqual({
        model: 'veo', prompt: 'go',
        image: { image_url: 'https://a/first.png' },
      });
    expect(buildVideoRequestBody({
      model: 'veo', prompt: 'go', image: 'https://a/first.png', lastFrame: 'https://a/last.png',
    })).toEqual({
      model: 'veo', prompt: 'go',
      image: { image_url: 'https://a/first.png' },
      lastFrame: { image_url: 'https://a/last.png' },
    });
    expect(buildVideoRequestBody({
      model: 'veo',
      prompt: 'go',
      referenceImages: ['https://a/front.png', 'https://a/side.png', 'https://a/back.png'],
    })).toEqual({
      model: 'veo',
      prompt: 'go',
      referenceImages: ['https://a/front.png', 'https://a/side.png', 'https://a/back.png'],
    });
    expect(buildVideoRequestBody({
      model: 'veo',
      prompt: 'go',
      image: 'https://a/storyboard.png',
      referenceImages: ['https://a/character.png'],
    })).toEqual({
      model: 'veo',
      prompt: 'go',
      image: { image_url: 'https://a/storyboard.png' },
      referenceImages: ['https://a/character.png'],
    });
  });

  it('rejects invalid prompts, durations, tail-only input, and excess references', () => {
    expect(() => buildVideoRequestBody({ model: 'veo', prompt: ' ' })).toThrow(/prompt/i);
    expect(() => buildVideoRequestBody({ model: 'veo', prompt: 'go', durationSeconds: 6 }))
      .toThrow('8 seconds');
    expect(() => buildVideoRequestBody({ model: 'veo', prompt: 'go', lastFrame: 'last' }))
      .toThrow('first frame');
    expect(() => buildVideoRequestBody({
      model: 'veo', prompt: 'go', referenceImages: ['1', '2', '3', '4'],
    })).toThrow('at most 3 reference images');
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

    await expect(provider.submit({ prompt: 'go' })).resolves.toEqual({
      id: 'up-1', upstreamTaskId: 'up-1', status: 'queued',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'secret',
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      model: 'veo', prompt: 'go',
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
