import { describe, expect, it, vi } from 'vitest';
import { buildVideoRequestBody, createVideoProvider, parseVideoStatus } from '../../server/videoProvider.js';

describe('Seedance 1.5 provider payloads', () => {
  it('builds text-only payload with documented fields', () => {
    expect(buildVideoRequestBody({
      model: 'seedance_1_5_pro_720p', prompt: 'A calm lake', durationSeconds: 8, aspectRatio: '16:9',
    })).toEqual({
      model: 'seedance_1_5_pro_720p',
      prompt: 'A calm lake',
      content: [{ type: 'text', text: 'A calm lake' }],
      duration: 8,
      ratio: '16:9',
      generate_audio: false,
    });
  });

  it('builds first/last-frame content entries', () => {
    expect(buildVideoRequestBody({
      model: 'seedance_1_5_pro_480p', prompt: 'A paper boat', image: 'https://media.example/first.png', lastFrame: 'https://media.example/last.png',
    })).toEqual({
      model: 'seedance_1_5_pro_480p',
      prompt: 'A paper boat',
      content: [
        { type: 'text', text: 'A paper boat' },
        { type: 'image_url', image_url: { url: 'https://media.example/first.png' }, role: 'first_frame' },
        { type: 'image_url', image_url: { url: 'https://media.example/last.png' }, role: 'last_frame' },
      ],
      duration: 5,
      ratio: 'adaptive',
      generate_audio: false,
    });
  });

  it('supports automatic duration and rejects unsupported duration, ratio, and reference inputs', () => {
    expect(buildVideoRequestBody({ model: 'seedance_1_5_pro_480p', prompt: 'go', durationSeconds: -1 }).duration).toBe(-1);
    expect(() => buildVideoRequestBody({ model: 'seedance_1_5_pro_480p', prompt: 'go', durationSeconds: 13 })).toThrow('4 to 12 seconds');
    expect(() => buildVideoRequestBody({ model: 'seedance_1_5_pro_480p', prompt: 'go', aspectRatio: '2:1' })).toThrow('aspect ratio');
    expect(() => buildVideoRequestBody({ model: 'seedance_1_5_pro_480p', prompt: 'go', referenceImages: ['https://media.example/ref.png'] })).toThrow('does not support reference images');
    expect(() => buildVideoRequestBody({ model: 'seedance_1_5_pro_480p', prompt: 'go', lastFrame: 'last' })).toThrow('first frame');
  });

  it('rejects retired models', () => {
    expect(() => buildVideoRequestBody({ model: 'seedance_2_0_pro', prompt: 'go' })).toThrow('seedance_1_5_pro_720p');
    expect(() => buildVideoRequestBody({ model: 'grok-imagine-video-1.5', prompt: 'go' })).toThrow('seedance_1_5_pro_720p');
  });
});

describe('video provider status', () => {
  it('normalizes queued, processing, completed, and failed responses', () => {
    expect(parseVideoStatus({ status: 'queued' })).toEqual({ status: 'queued' });
    expect(parseVideoStatus({ data: { status: 'running' } })).toEqual({ status: 'processing' });
    expect(parseVideoStatus({ status: 'succeeded', video_url: 'https://cdn/video.mp4' })).toEqual({ status: 'completed', video_url: 'https://cdn/video.mp4' });
    expect(parseVideoStatus({ status: 'error', error: { message: 'bad task' } })).toEqual({ status: 'failed', error: 'bad task' });
  });
});

describe('createVideoProvider', () => {
  it('defaults to Seedance 1.5 Pro 720p and submits bearer authorization', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'up-default' }), { status: 200 }));
    const provider = createVideoProvider({ apiUrl: 'https://api.example/v1/seedance/videos', apiKey: 'secret', fetchImpl });

    await provider.submit({ prompt: 'go' });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      model: 'seedance_1_5_pro_720p',
      prompt: 'go',
      content: [{ type: 'text', text: 'go' }],
      duration: 5,
      ratio: 'adaptive',
      generate_audio: false,
    });
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer secret' });
  });

  it('uses the task-selected 480p model', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'up-480' }), { status: 200 }));
    const provider = createVideoProvider({ apiUrl: 'https://api.example/v1/seedance/videos', apiKey: 'secret', fetchImpl });

    await provider.submit({ model: 'seedance_1_5_pro_480p', prompt: 'go' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('seedance_1_5_pro_480p');
  });

  it('does not retry ordinary submit failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Invalid duration' } }), { status: 400 }));
    const provider = createVideoProvider({ apiUrl: 'https://api.example/v1/seedance/videos', apiKey: 'secret', fetchImpl, sleep: vi.fn() });

    await expect(provider.submit({ prompt: 'go' })).rejects.toThrow('Invalid duration');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses the independent result query endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', video_url: 'https://cdn/v.mp4' }), { status: 200 }));
    const provider = createVideoProvider({ apiUrl: 'https://api.example/v1/seedance/videos', queryUrl: 'https://api.example/v1/result/{id}', apiKey: 'secret', fetchImpl });

    await provider.getStatus('task/1');
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example/v1/result/task%2F1', expect.any(Object));
  });

  it('retries transient polling failures and returns the completed URL', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed', video_url: 'https://cdn/v.mp4' }), { status: 200 }));
    const provider = createVideoProvider({ apiUrl: 'https://api.example/v1/seedance/videos', apiKey: 'secret', fetchImpl, sleep: vi.fn().mockResolvedValue(), pollIntervalMs: 1, timeoutMs: 1000, now: (() => { let n = 0; return () => n++; })() });

    await expect(provider.poll('up-1')).resolves.toBe('https://cdn/v.mp4');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
