export const GROK_VIDEO_MODEL = 'grok-imagine-video-1.5';
export const GROK_VIDEO_ASPECT_RATIOS = Object.freeze(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']);
export const GROK_MIN_VIDEO_DURATION_SECONDS = 1;
export const GROK_MAX_VIDEO_DURATION_SECONDS = 15;
export const GROK_MAX_VIDEO_REFERENCE_IMAGES = 1;
const RESOLUTIONS = new Set(['480p', '720p', '1080p']);

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Grok video provider returned invalid JSON');
  }
}

function readError(payload, fallback) {
  const value = payload?.error?.message || payload?.error || payload?.message || fallback;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function assertSuccess(response, payload, fallback) {
  if (response.ok) return;
  const error = new Error(readError(payload, fallback));
  error.status = response.status;
  throw error;
}

function buildPrompt(prompt, hasImage) {
  const imageInstruction = hasImage
    ? ' Use the provided image as the exact first frame and preserve its subject, identity, clothing, and setting.'
    : '';
  return `Follow the user description exactly.${imageInstruction} Do not replace the requested subject, action, setting, camera behavior, or visual style with unrelated content. The generated video must visibly match the description.\n\nUser description:\n${prompt}`;
}

function normalizeStatus(payload) {
  const status = String(payload?.status || payload?.state || '').trim().toLowerCase();
  const progress = Number.isFinite(payload?.progress) ? payload.progress : undefined;
  if (['pending', 'queued', 'submitted'].includes(status)) return { status: 'pending', progress };
  if (['processing', 'running', 'in_progress'].includes(status)) return { status: 'processing', progress };
  if (['done', 'completed', 'succeeded', 'success'].includes(status)) {
    const videoUrl = String(payload?.video?.url || payload?.video_url || payload?.videoUrl || payload?.url || '').trim();
    if (!videoUrl) throw new Error('Completed Grok video response is missing video URL');
    return { status: 'completed', progress, videoUrl };
  }
  if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
    return { status: 'failed', progress, error: readError(payload, 'Grok video generation failed') };
  }
  throw new Error(`Unknown Grok video status: ${status || 'empty'}`);
}

export function createGrokVideoProvider({
  baseUrl,
  apiKey,
  pollIntervalMs = 20_000,
  timeoutMs = 1_800_000,
  fetchImpl = globalThis.fetch,
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
  now = Date.now,
} = {}) {
  const rootUrl = String(baseUrl || '').trim().replace(/\/+$/u, '');
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${String(apiKey || '')}`,
  };

  async function submit({
    prompt,
    image = '',
    lastFrame = '',
    referenceImages = [],
    durationSeconds = 4,
    resolution = '720p',
    aspectRatio = '16:9',
    signal,
  } = {}) {
    const normalizedPrompt = String(prompt || '').trim();
    const normalizedImage = String(image || '').trim();
    const normalizedLastFrame = String(lastFrame || '').trim();
    const normalizedReferences = Array.isArray(referenceImages)
      ? referenceImages.map(item => String(item || '').trim()).filter(Boolean)
      : (() => { throw new Error('Grok video reference images must be an array'); })();
    const normalizedDuration = Number(durationSeconds);
    const normalizedResolution = String(resolution || '').trim();
    if (!normalizedPrompt) throw new Error('Grok video prompt is required');
    if (!Number.isInteger(normalizedDuration)
      || normalizedDuration < GROK_MIN_VIDEO_DURATION_SECONDS
      || normalizedDuration > GROK_MAX_VIDEO_DURATION_SECONDS) {
      throw new Error(`Grok video duration must be an integer from ${GROK_MIN_VIDEO_DURATION_SECONDS} to ${GROK_MAX_VIDEO_DURATION_SECONDS} seconds`);
    }
    if (!RESOLUTIONS.has(normalizedResolution)) throw new Error('Grok video resolution must be 480p, 720p, or 1080p');
    if (!GROK_VIDEO_ASPECT_RATIOS.includes(String(aspectRatio || '').trim())) {
      throw new Error(`Grok video aspect ratio must be one of ${GROK_VIDEO_ASPECT_RATIOS.join(', ')}`);
    }
    if (normalizedLastFrame) throw new Error('Grok video does not support a last frame');
    if (normalizedReferences.length > GROK_MAX_VIDEO_REFERENCE_IMAGES) {
      throw new Error('Grok video through this provider supports one image input');
    }
    if (normalizedImage && normalizedReferences.length) {
      throw new Error('Grok image-to-video and reference images cannot be used together');
    }
    const effectiveImage = normalizedImage || normalizedReferences[0] || '';
    if (normalizedResolution === '1080p' && !effectiveImage) {
      throw new Error('Grok 1080p is supported only for image-to-video');
    }

    const body = {
      model: GROK_VIDEO_MODEL,
      prompt: buildPrompt(normalizedPrompt, Boolean(effectiveImage)),
      duration: normalizedDuration,
      resolution: normalizedResolution,
      aspect_ratio: String(aspectRatio || '16:9').trim(),
    };
    if (effectiveImage) body.image = { url: effectiveImage };

    const response = await fetchImpl(`${rootUrl}/v1/videos/generations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    const payload = await readJson(response);
    assertSuccess(response, payload, 'Grok video generation request failed');
    const requestId = String(payload?.request_id || '').trim();
    if (!requestId) throw new Error('Grok video response is missing request_id');
    return { id: requestId, upstreamTaskId: requestId, status: 'queued' };
  }

  async function getStatus(requestId, signal) {
    const response = await fetchImpl(`${rootUrl}/v1/videos/${encodeURIComponent(String(requestId || ''))}`, {
      headers: { Authorization: headers.Authorization },
      signal,
    });
    const payload = await readJson(response);
    assertSuccess(response, payload, 'Grok video status request failed');
    return normalizeStatus(payload);
  }

  async function poll(requestId, onStageOrOptions = {}) {
    const onStage = typeof onStageOrOptions === 'function' ? onStageOrOptions : onStageOrOptions.onStage;
    const signal = typeof onStageOrOptions === 'function' ? undefined : onStageOrOptions.signal;
    const startedAt = now();
    let retryCount = 0;
    while (true) {
      if (now() - startedAt >= timeoutMs) throw new Error('Grok video generation timed out');
      try {
        const result = await getStatus(requestId, signal);
        retryCount = 0;
        onStage?.(result.status);
        if (result.status === 'completed') return result.videoUrl;
        if (result.status === 'failed') {
          const error = new Error(result.error || 'Grok video generation failed');
          error.retryable = false;
          throw error;
        }
        await sleep(pollIntervalMs, signal);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        const retryable = error?.retryable !== false && (
          error?.status === 429 || error?.status >= 500 || !Number.isFinite(error?.status)
        );
        if (!retryable) throw error;
        const delay = Math.min(30_000, Math.max(pollIntervalMs, 1_000 * (2 ** retryCount)));
        retryCount += 1;
        await sleep(delay, signal);
      }
    }
  }

  return { submit, submitVideo: submit, getStatus, getVideoStatus: getStatus, poll, pollVideo: poll };
}
