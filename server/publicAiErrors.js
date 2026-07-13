const PUBLIC_FALLBACKS = Object.freeze({
  image: '图片生成失败，请稍后重试。',
  video: '视频生成失败，请稍后重试。',
  chat: '回复生成失败，请稍后重试。',
});

function getSafetyMessage(taskType) {
  if (taskType === 'image') {
    return '图片内容可能不符合安全规范，请调整描述后重试。';
  }
  if (taskType === 'video') {
    return '视频内容可能不符合安全规范，请调整描述后重试。';
  }
  return '内容可能不符合安全规范，请调整后重试。';
}

export function toPublicAiErrorMessage(error, taskType = 'chat') {
  const normalizedTaskType = taskType === 'image' || taskType === 'video' ? taskType : 'chat';
  const message = String(error?.message || error || '').toLowerCase();

  if (/unsafe|safety|policy|moderation|content violation|guardrail|content filtered/u.test(message)) {
    return getSafetyMessage(normalizedTaskType);
  }
  if (/rate[ _-]?limit|too many requests|limit reached|quota exceeded|\b429\b/u.test(message)) {
    return '请求过于频繁，请稍后重试。';
  }
  if (/timed?\s*out|timeout|deadline exceeded|aborterror/u.test(message)) {
    return '生成服务响应超时，请稍后重试。';
  }
  if (/account pool|no (?:available )?accounts?|all accounts? (?:are )?(?:busy|unavailable)|accounts? exhausted/u.test(message)) {
    return '当前生成服务繁忙，请稍后重试。';
  }
  if (/network|fetch failed|econn(?:reset|refused|aborted)|enotfound|socket hang up|connection (?:failed|reset|refused)/u.test(message)) {
    return '网络连接异常，请稍后重试。';
  }
  if (/unauthorized|authentication|invalid (?:api[ _-]?)?key|permission denied|forbidden|\b40[13]\b/u.test(message)) {
    return '生成服务暂时不可用，请稍后重试。';
  }

  return PUBLIC_FALLBACKS[normalizedTaskType];
}
