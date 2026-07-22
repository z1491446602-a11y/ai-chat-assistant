import { describe, expect, it, vi } from 'vitest';
import { createGrokVideoProvider } from '../../server/grokVideoProvider.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Grok video provider adapter', () => {
  it('keeps the user prompt intact inside a strict prompt-following instruction', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ request_id: 'request-1' }));
    const provider = createGrokVideoProvider({
      baseUrl: 'http://example.test:8000',
      apiKey: 'secret',
      fetchImpl,
    });

    await expect(provider.submit({ prompt: 'A paper boat', resolution: '720p' }))
      .resolves.toEqual({ id: 'request-1', upstreamTaskId: 'request-1', status: 'queued' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://example.test:8000/v1/videos/generations',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret',
        },
        body: expect.any(String),
      }),
    );
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toMatchObject({
      model: 'grok-imagine-video-1.5',
      duration: 4,
      resolution: '720p',
      aspect_ratio: '16:9',
    });
    expect(body.prompt).toContain('A paper boat');
    expect(body.prompt).toContain('Do not replace the requested subject');
  });

  it('serializes image guidance with the official image object', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => jsonResponse({ request_id: 'request-2' }));
    const provider = createGrokVideoProvider({ baseUrl: 'http://example.test:8000', apiKey: 'secret', fetchImpl });

    await provider.submit({
      prompt: 'A paper boat floats forward',
      image: 'https://example.test/input.jpg',
      durationSeconds: 1,
      aspectRatio: '9:16',
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      image: { url: 'https://example.test/input.jpg' },
      duration: 1,
      resolution: '720p',
      aspect_ratio: '9:16',
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('image_url');
  });

  it('maps one legacy Grok reference image to image guidance and rejects unsupported extras', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => jsonResponse({ request_id: 'request-2' }));
    const provider = createGrokVideoProvider({ baseUrl: 'http://example.test:8000', apiKey: 'secret', fetchImpl });

    await provider.submit({
      prompt: 'A character walks through a city square',
      referenceImages: ['https://example.test/front.jpg'],
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      image: { url: 'https://example.test/front.jpg' },
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('reference_images');

    await expect(provider.submit({
      prompt: 'A character walks', referenceImages: ['https://example.test/reference.jpg'], lastFrame: 'https://example.test/end.jpg',
    })).rejects.toThrow('does not support a last frame');
    await expect(provider.submit({
      prompt: 'Too many images', referenceImages: ['1', '2'],
    })).rejects.toThrow('supports one image input');
  });

  it('normalizes pending and completed status responses with video.url', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'pending', progress: 0 }, 202))
      .mockResolvedValueOnce(jsonResponse({
        status: 'done', progress: 100,
        video: { url: 'https://cdn.example.test/video.mp4', duration: 4 },
      }));
    const provider = createGrokVideoProvider({
      baseUrl: 'http://example.test:8000', apiKey: 'secret', fetchImpl,
    });

    await expect(provider.getStatus('request-1')).resolves.toEqual({
      status: 'pending', progress: 0,
    });
    await expect(provider.getStatus('request-1')).resolves.toEqual({
      status: 'completed',
      progress: 100,
      videoUrl: 'https://cdn.example.test/video.mp4',
    });
  });
});
