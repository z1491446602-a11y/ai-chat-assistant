import { afterEach, describe, expect, it } from 'vitest';
import { createServerConfig } from '../../server/config.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function useCleanEnv(overrides = {}) {
  process.env = {
    NODE_ENV: 'test',
    ...overrides,
  };
}

describe('upstream transport security', () => {
  it('does not ship public HTTP defaults for legacy or Grok image providers', () => {
    useCleanEnv();

    expect(createServerConfig('C:/app')).toMatchObject({
      DEFAULT_IMAGE_API_URL: '',
      IMAGE_GROK_GENERATION_URL: '',
      IMAGE_GROK_EDIT_URL: '',
    });
  });

  it.each([
    ['CHAT_API_KEY', 'CHAT_API_URL', 'http://chat.example.com/v1/responses'],
    ['VIDEO_API_KEY', 'VIDEO_API_URL', 'http://video.example.com/v1/videos'],
    ['DEEPSEEK_VOICE_CHAT_API_KEY', 'DEEPSEEK_VOICE_CHAT_API_URL', 'http://deepseek.example.com/chat'],
    ['MIMO_CHAT_API_KEY', 'MIMO_CHAT_API_URL', 'http://mimo.example.com/chat'],
    ['IMAGE_API_KEY', 'IMAGE_API_URL', 'http://legacy-images.example.com'],
    ['IMAGE_GPT_API_KEY', 'IMAGE_GPT_GENERATION_URL', 'http://gpt-images.example.com/generate'],
    ['IMAGE_GPT_API_KEY', 'IMAGE_GPT_EDIT_URL', 'http://gpt-images.example.com/edit'],
    ['IMAGE_GROK_API_KEY', 'IMAGE_GROK_GENERATION_URL', 'http://grok-images.example.com/generate'],
    ['IMAGE_GROK_API_KEY', 'IMAGE_GROK_EDIT_URL', 'http://grok-images.example.com/edit'],
    ['BOCHA_WEB_SEARCH_API_KEY', 'BOCHA_WEB_SEARCH_API_URL', 'http://search.example.com/v1/search'],
    ['BAIDU_SPEECH_API_KEY', 'BAIDU_SPEECH_TOKEN_URL', 'http://speech.example.com/token'],
    ['BAIDU_SPEECH_API_KEY', 'BAIDU_SPEECH_ASR_URL', 'http://speech.example.com/asr'],
  ])('rejects a public HTTP URL when %s is configured', (keyName, urlName, url) => {
    useCleanEnv({
      [keyName]: 'configured-secret',
      [urlName]: url,
    });

    expect(() => createServerConfig('C:/app')).toThrow(new RegExp(urlName));
  });

  it.each([
    ['CHAT_API_URL', 'http://chat.example.com/v1/responses'],
    ['VIDEO_API_URL', 'http://video.example.com/v1/videos'],
    ['DEEPSEEK_VOICE_CHAT_API_URL', 'http://deepseek.example.com/chat'],
    ['MIMO_CHAT_API_URL', 'http://mimo.example.com/chat'],
    ['IMAGE_API_URL', 'http://legacy-images.example.com'],
    ['IMAGE_GPT_GENERATION_URL', 'http://gpt-images.example.com/generate'],
    ['IMAGE_GPT_EDIT_URL', 'http://gpt-images.example.com/edit'],
    ['IMAGE_GROK_GENERATION_URL', 'http://grok-images.example.com/generate'],
    ['IMAGE_GROK_EDIT_URL', 'http://grok-images.example.com/edit'],
    ['BOCHA_WEB_SEARCH_API_URL', 'http://search.example.com/v1/search'],
    ['BAIDU_SPEECH_TOKEN_URL', 'http://speech.example.com/token'],
    ['BAIDU_SPEECH_ASR_URL', 'http://speech.example.com/asr'],
  ])('rejects public HTTP in %s even when no credential exists at startup', (urlName, url) => {
    useCleanEnv({ [urlName]: url });

    expect(() => createServerConfig('C:/app')).toThrow(new RegExp(urlName));
  });

  it.each([
    'http://localhost:8080/v1',
    'http://127.0.0.1:8080/v1',
    'http://10.20.30.40:8080/v1',
    'http://172.16.10.20:8080/v1',
    'http://192.168.1.20:8080/v1',
    'http://[::1]:8080/v1',
    'http://[fd00::1]:8080/v1',
  ])('allows an explicit loopback or private HTTP upstream: %s', url => {
    useCleanEnv({ CHAT_API_KEY: 'configured-secret', CHAT_API_URL: url });

    expect(() => createServerConfig('C:/app')).not.toThrow();
  });

  it.each([
    'https://user@api.example.com/v1',
    'https://user:password@api.example.com/v1',
    'https://:password@api.example.com/v1',
    'http://user:password@127.0.0.1:8080/v1',
  ])('rejects upstream URLs containing embedded credentials: %s', url => {
    useCleanEnv({ CHAT_API_URL: url });

    expect(() => createServerConfig('C:/app')).toThrow(/CHAT_API_URL/u);
  });

  it.each([
    'http://127.1:8080/v1',
    'http://2130706433:8080/v1',
    'http://0177.0.0.1:8080/v1',
    'http://0x7f.0.0.1:8080/v1',
    'http://192.168.1:8080/v1',
    'http://0300.0250.0001.0001:8080/v1',
    'http://localhost.:8080/v1',
    'http://[0:0:0:0:0:0:0:1]:8080/v1',
  ])('rejects non-canonical host forms even when they normalize to private addresses: %s', url => {
    useCleanEnv({ CHAT_API_URL: url });

    expect(() => createServerConfig('C:/app')).toThrow(/CHAT_API_URL/u);
  });

  it.each([
    'http://[::ffff:127.0.0.1]:8080/v1',
    'http://[::ffff:7f00:1]:8080/v1',
    'http://[::ffff:c0a8:101]:8080/v1',
  ])('rejects IPv4-mapped IPv6 HTTP exceptions: %s', url => {
    useCleanEnv({ CHAT_API_URL: url });

    expect(() => createServerConfig('C:/app')).toThrow(/CHAT_API_URL/u);
  });

  it.each([
    'http://169.254.169.254/latest/meta-data',
    'http://[fe80::1]:8080/v1',
  ])('rejects link-local HTTP addresses rather than treating them as private: %s', url => {
    useCleanEnv({ CHAT_API_URL: url });

    expect(() => createServerConfig('C:/app')).toThrow(/CHAT_API_URL/u);
  });

  it('rejects malformed and non-HTTP upstream URLs when credentials are configured', () => {
    useCleanEnv({ CHAT_API_KEY: 'configured-secret', CHAT_API_URL: 'not-a-url' });
    expect(() => createServerConfig('C:/app')).toThrow(/CHAT_API_URL/u);

    useCleanEnv({ CHAT_API_KEY: 'configured-secret', CHAT_API_URL: 'ftp://127.0.0.1/chat' });
    expect(() => createServerConfig('C:/app')).toThrow(/CHAT_API_URL/u);
  });

  it.each(['IMAGE_GPT_GENERATION_URL', 'IMAGE_GPT_EDIT_URL'])(
    'also protects %s when the legacy endpoint can fall back to CHAT_API_KEY',
    urlName => {
      useCleanEnv({
        CHAT_API_KEY: 'configured-secret',
        [urlName]: 'http://gpt-images.example.com/v1/images',
      });

      expect(() => createServerConfig('C:/app')).toThrow(new RegExp(urlName));
    },
  );
});
