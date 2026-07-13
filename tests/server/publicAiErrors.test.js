import { describe, expect, it } from 'vitest';
import { toPublicAiErrorMessage } from '../../server/publicAiErrors.js';

describe('public AI errors', () => {
  it('maps unsafe image errors to an allowlisted Chinese message', () => {
    expect(toPublicAiErrorMessage(
      'The generated images appear to be unsafe',
      'image',
    )).toBe('图片内容可能不符合安全规范，请调整描述后重试。');
  });

  it.each([
    ['This request was rejected by the content policy', '内容可能不符合安全规范，请调整后重试。'],
    ['429 Too Many Requests: rate limit exceeded', '请求过于频繁，请稍后重试。'],
    ['Request timed out after 30 seconds', '生成服务响应超时，请稍后重试。'],
    ['No available account in account pool', '当前生成服务繁忙，请稍后重试。'],
    ['fetch failed: ECONNRESET', '网络连接异常，请稍后重试。'],
    ['401 Unauthorized: invalid API key', '生成服务暂时不可用，请稍后重试。'],
  ])('maps an upstream error without exposing it: %s', (upstreamError, expected) => {
    const message = toPublicAiErrorMessage(upstreamError, 'chat');
    expect(message).toBe(expected);
    expect(message).not.toMatch(/[A-Za-z]/u);
    expect(message).not.toContain(upstreamError);
  });

  it.each([
    ['image', '图片生成失败，请稍后重试。'],
    ['video', '视频生成失败，请稍后重试。'],
    ['chat', '回复生成失败，请稍后重试。'],
  ])('uses a Chinese %s fallback for unknown English errors', (taskType, expected) => {
    const upstreamError = 'Unexpected upstream failure ref secret-123';
    const message = toPublicAiErrorMessage(upstreamError, taskType);

    expect(message).toBe(expected);
    expect(message).not.toMatch(/[A-Za-z0-9]/u);
    expect(message).not.toContain(upstreamError);
  });

  it('accepts Error objects without exposing their message', () => {
    const message = toPublicAiErrorMessage(new Error('socket hang up'), 'video');
    expect(message).toBe('网络连接异常，请稍后重试。');
    expect(message).not.toContain('socket');
  });
});
