import { describe, expect, it, vi } from 'vitest';
import { createAiProviders } from '../../server/aiProviders.js';

function createProviders(upstreamFetch) {
  return createAiProviders({
    upstreamFetch,
    buildFileContextBlocks: () => [],
    saveGeneratedAudio: async () => ({}),
    normalizeVoiceAudioBuffer: async value => value,
    getAudioMimeTypeFromPath: () => 'audio/wav',
    parseUpstreamErrorMessage: value => String(value || ''),
    config: {
      IMAGE_DEFAULT_PROVIDER: 'gpt',
      IMAGE_GPT_API_KEY: 'test-key',
      IMAGE_GPT_GENERATION_URL: 'https://image.example/generations',
      IMAGE_GPT_EDIT_URL: 'https://image.example/edits',
      IMAGE_GPT_MODEL: 'gpt-image-2',
      IMAGE_GROK_API_KEY: '',
      IMAGE_GROK_GENERATION_URL: '',
      IMAGE_GROK_EDIT_URL: '',
      IMAGE_GROK_MODEL: 'grok-imagine-image-quality',
      IMAGE_REQUEST_TIMEOUT_MS: 5_000,
      DEFAULT_IMAGE_SIZE: '',
      UPLOAD_DIR: 'unused',
      DEFAULT_VOICECLONE_SAMPLE_PATH: process.cwd() + '/tests/server/aiProviders.imageBatch.test.js',
      SECOND_VOICECLONE_SAMPLE_PATH: process.cwd() + '/tests/server/aiProviders.imageBatch.test.js',
      VOICE_HISTORY_LIMIT: 6,
      VOICE_MESSAGE_MAX_CHARS: 700,
    },
  });
}

describe('image batch generation', () => {
  it('starts all requested upstream image calls concurrently and retains partial successes', async () => {
    const deferred = [];
    const upstreamFetch = vi.fn(() => new Promise(resolve => deferred.push(resolve)));
    const providers = createProviders(upstreamFetch);

    const pending = providers.performImageGeneration({
      prompt: '生成 5 张城市夜景图片',
      provider: 'gpt',
      count: 5,
    });

    expect(upstreamFetch).toHaveBeenCalledTimes(5);
    expect(upstreamFetch.mock.calls.map(([, init]) => JSON.parse(init.body).prompt)).toEqual([
      '生成一张城市夜景图片',
      '生成一张城市夜景图片',
      '生成一张城市夜景图片',
      '生成一张城市夜景图片',
      '生成一张城市夜景图片',
    ]);
    deferred[0](new Response(JSON.stringify({ data: [{ url: 'https://images.example/1.png' }] })));
    deferred[1](new Response(JSON.stringify({ data: [{ url: 'https://images.example/2.png' }] })));
    deferred[2](new Response('', { status: 500 }));
    deferred[3](new Response(JSON.stringify({ data: [{ url: 'https://images.example/4.png' }] })));
    deferred[4](new Response('', { status: 500 }));

    await expect(pending).resolves.toMatchObject({
      completedCount: 3,
      failedCount: 2,
      images: [
        'https://images.example/1.png',
        'https://images.example/2.png',
        'https://images.example/4.png',
      ],
    });
  });

  it('sends only the matching storyboard item in each concurrent upstream request', async () => {
    const deferred = [];
    const upstreamFetch = vi.fn(() => new Promise(resolve => deferred.push(resolve)));
    const providers = createProviders(upstreamFetch);
    const descriptions = [
      '橘色小猫蹲在溪边',
      '黑白花猫趴在草地上',
      '灰色虎斑猫站在浅水里',
      '白色小猫坐在圆石上',
      '黑猫扑向水面',
    ];
    const prompt = [
      '生成五张图片，比例 16:9，写实风格',
      ...descriptions.map((description, index) => `第${index + 1}张：${description}`),
    ].join('\n');

    const pending = providers.performImageGeneration({
      prompt,
      provider: 'gpt',
      count: 5,
    });

    expect(upstreamFetch).toHaveBeenCalledTimes(5);
    const requestPrompts = upstreamFetch.mock.calls.map(([, init]) => JSON.parse(init.body).prompt);
    requestPrompts.forEach((requestPrompt, index) => {
      expect(requestPrompt).toContain(descriptions[index]);
      expect(requestPrompt).toContain('16:9');
      expect(requestPrompt).toContain('写实风格');
      descriptions.forEach((description, otherIndex) => {
        if (otherIndex !== index) expect(requestPrompt).not.toContain(description);
      });
    });

    deferred.forEach((resolve, index) => {
      resolve(new Response(JSON.stringify({ data: [{ url: `https://images.example/${index + 1}.png` }] })));
    });
    await expect(pending).resolves.toMatchObject({ completedCount: 5, failedCount: 0 });
  });
});
