import { describe, expect, it } from 'vitest';
import { buildImageProviderRequest, createImageProviderRegistry } from '../../server/imageProvider.js';

const registry = createImageProviderRegistry({
  IMAGE_DEFAULT_PROVIDER: 'gpt',
  IMAGE_GPT_API_KEY: 'gpt-secret',
  IMAGE_GPT_GENERATION_URL: 'https://gpt.example/v1/images/generations',
  IMAGE_GPT_EDIT_URL: 'https://gpt.example/v1/images/edits',
  IMAGE_GPT_MODEL: 'gpt-image-2',
  IMAGE_GROK_API_KEY: 'grok-secret',
  IMAGE_GROK_GENERATION_URL: 'https://grok.example/v1/images/generations',
  IMAGE_GROK_EDIT_URL: 'https://grok.example/v1/images/edits',
  IMAGE_GROK_MODEL: 'grok-imagine-image-quality',
});

describe('image provider requests', () => {
  it('uses an exact whitelist and defaults to GPT', () => {
    expect(registry.resolve().id).toBe('gpt');
    expect(registry.resolve('grok').model).toBe('grok-imagine-image-quality');
    expect(() => registry.resolve('custom')).toThrow('不支持的图片生成模型');
  });

  it('builds GPT text generation with the requested size and base64 response', () => {
    const request = buildImageProviderRequest({
      provider: registry.resolve('gpt'),
      prompt: 'landscape poster, 3:2',
      size: '1536x1024',
    });
    const body = JSON.parse(request.init.body);

    expect(request.url).toBe('https://gpt.example/v1/images/generations');
    expect(body).toEqual({
      model: 'gpt-image-2',
      prompt: 'landscape poster, 3:2',
      n: 1,
      response_format: 'b64_json',
      size: '1536x1024',
    });
  });

  it('uses JSON data URLs for Grok edits so the result can be returned as base64', () => {
    const image = 'data:image/png;base64,iVBORw0KGgo=';
    const request = buildImageProviderRequest({
      provider: registry.resolve('grok'),
      prompt: 'edit this image',
      images: [image],
      size: '1024x1024',
      aspectRatio: '1:1',
    });
    const body = JSON.parse(request.init.body);

    expect(request.url).toBe('https://grok.example/v1/images/edits');
    expect(request.init.headers['Content-Type']).toBe('application/json');
    expect(body.image).toEqual({ image_url: image });
    expect(body.aspect_ratio).toBe('1:1');
    expect(body.size).toBeUndefined();
    expect(body.response_format).toBe('b64_json');
  });

  it('uses multipart uploads for GPT edits', () => {
    const request = buildImageProviderRequest({
      provider: registry.resolve('gpt'),
      prompt: 'edit this image',
      images: ['data:image/png;base64,iVBORw0KGgo='],
    });

    expect(request.url).toBe('https://gpt.example/v1/images/edits');
    expect(request.init.body).toBeInstanceOf(FormData);
    expect(request.init.body.get('model')).toBe('gpt-image-2');
    expect(request.init.body.get('response_format')).toBe('b64_json');
    expect(request.init.body.getAll('image')).toHaveLength(1);
  });
});
