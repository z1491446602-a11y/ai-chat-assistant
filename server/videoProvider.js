const PUBLIC_STATUSES = new Set(['queued', 'processing', 'completed', 'failed']);
export const MAX_VIDEO_REFERENCE_IMAGES = 9;
export const DEFAULT_VIDEO_DURATION_SECONDS = 5;
export const AUTO_VIDEO_DURATION_SECONDS = -1;
export const MIN_VIDEO_DURATION_SECONDS = 4;
export const MAX_VIDEO_DURATION_SECONDS = 12;
export const DEFAULT_VIDEO_ASPECT_RATIO = 'adaptive';
export const VIDEO_ASPECT_RATIOS = Object.freeze(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive']);
export const SEEDANCE_VIDEO_MODEL = 'seedance_1_5_pro_720p';
export const SEEDANCE_FAST_PRO_VIDEO_MODEL = 'seedance_1_5_pro_480p';
export const SEEDANCE_VIDEO_MODELS = Object.freeze([
  SEEDANCE_VIDEO_MODEL,
  SEEDANCE_FAST_PRO_VIDEO_MODEL,
]);

function normalizeImage(image) {
  return String(image || '').trim();
}

function normalizeReferenceImages(referenceImages) {
  if (referenceImages == null) return [];
  if (!Array.isArray(referenceImages)) throw new Error('Video reference images must be an array');
  return referenceImages.map(normalizeImage).filter(Boolean);
}

export function buildVideoRequestBody({
  model,
  prompt,
  image = '',
  lastFrame = '',
  referenceImages = [],
  durationSeconds,
  aspectRatio = DEFAULT_VIDEO_ASPECT_RATIO,
}) {
  const hasExplicitDuration = durationSeconds !== undefined && durationSeconds !== null;
  const normalizedDuration = hasExplicitDuration
    ? Number(durationSeconds)
    : DEFAULT_VIDEO_DURATION_SECONDS;
  const normalizedPrompt = String(prompt || '').trim();
  const normalizedImage = normalizeImage(image);
  const normalizedLastFrame = normalizeImage(lastFrame);
  const normalizedReferenceImages = normalizeReferenceImages(referenceImages);
  const normalizedAspectRatio = String(aspectRatio || DEFAULT_VIDEO_ASPECT_RATIO).trim();
  const normalizedModel = String(model || '').trim() || SEEDANCE_VIDEO_MODEL;
  if (!normalizedPrompt) throw new Error('Video prompt is required');
  if (!SEEDANCE_VIDEO_MODELS.includes(normalizedModel)) {
    throw new Error(`Video model must be one of ${SEEDANCE_VIDEO_MODELS.join(', ')}`);
  }
  if (normalizedDuration !== AUTO_VIDEO_DURATION_SECONDS && (!Number.isInteger(normalizedDuration)
    || normalizedDuration < MIN_VIDEO_DURATION_SECONDS
    || normalizedDuration > MAX_VIDEO_DURATION_SECONDS)) {
    throw new Error(`Seedance 1.5 Pro video duration must be -1 (automatic) or an integer from ${MIN_VIDEO_DURATION_SECONDS} to ${MAX_VIDEO_DURATION_SECONDS} seconds`);
  }
  if (normalizedLastFrame && !normalizedImage) {
    throw new Error('Video last frame requires a first frame');
  }
  if (normalizedReferenceImages.length) {
    throw new Error('Seedance 1.5 Pro does not support reference images; use a first or last frame');
  }
  if (normalizedAspectRatio && !VIDEO_ASPECT_RATIOS.includes(normalizedAspectRatio)) {
    throw new Error(`Video aspect ratio must be one of ${VIDEO_ASPECT_RATIOS.join(', ')}`);
  }
  const content = [{ type: 'text', text: normalizedPrompt }];
  if (normalizedImage) {
    content.push({ type: 'image_url', image_url: { url: normalizedImage }, role: 'first_frame' });
  }
  if (normalizedLastFrame) {
    content.push({ type: 'image_url', image_url: { url: normalizedLastFrame }, role: 'last_frame' });
  }
  const body = {
    model: normalizedModel,
    // The gateway currently validates this legacy field even though the documented
    // Seedance 1.5 contract carries the same text inside content.
    prompt: normalizedPrompt,
    content,
    duration: normalizedDuration,
    ratio: normalizedAspectRatio,
    // The gateway's audio path currently fails with multipart: NextPart: EOF.
    generate_audio: false,
  };
  return body;
}

function readStatusPayload(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

function readError(payload) {
  const value = payload?.error?.message || payload?.error || payload?.message || '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function parseVideoStatus(payload) {
  const data = readStatusPayload(payload) || {};
  const rawStatus = String(data.status || data.state || '').trim().toLowerCase();
  const statusMap = {
    pending: 'queued',
    queued: 'queued',
    submitted: 'queued',
    running: 'processing',
    processing: 'processing',
    in_progress: 'processing',
    succeeded: 'completed',
    success: 'completed',
    completed: 'completed',
    failed: 'failed',
    error: 'failed',
    cancelled: 'failed',
    canceled: 'failed',
  };
  const status = statusMap[rawStatus];
  if (!PUBLIC_STATUSES.has(status)) throw new Error(`Unknown video status: ${rawStatus || 'empty'}`);

  if (status === 'completed') {
    const videoUrl = data.video_url
      || data.videoUrl
      || data.content?.video_url
      || data.content?.videoUrl
      || data.output?.video_url
      || data.output?.url;
    if (!videoUrl) throw new Error('Completed video response is missing video_url');
    return { status, video_url: String(videoUrl) };
  }
  if (status === 'failed') return { status, error: readError(data) || 'Video generation failed' };
  return { status };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    // ChanceXJ can append an SSE error event to an otherwise valid JSON error.
    const eventIndex = text.search(/(?:\r?\n)?event\s*:/iu);
    if (eventIndex > 0) {
      try {
        return JSON.parse(text.slice(0, eventIndex).trim());
      } catch {
        // Fall through to the stable parse error below.
      }
    }
    throw new Error('Video provider returned invalid JSON');
  }
}

function createHttpError(response, payload) {
  const error = new Error(readError(payload) || `Video provider request failed (${response.status})`);
  error.status = response.status;
  return error;
}

function shouldRetryMissingTaskId(error) {
  return error?.status === 502
    && /GlobalAI did not return a task id/i.test(String(error?.message || ''));
}

export function createVideoProvider({
  apiUrl,
  queryUrl = '',
  apiKey,
  model = SEEDANCE_VIDEO_MODEL,
  pollIntervalMs = 20_000,
  timeoutMs = 1_800_000,
  fetchImpl = globalThis.fetch,
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
  now = Date.now,
} = {}) {
  const baseUrl = String(apiUrl || '').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${String(apiKey || '')}` };
  const statusUrlTemplate = String(queryUrl || '').trim();

  async function submit({
    model: requestedModel = model,
    prompt,
    image = '',
    lastFrame = '',
    referenceImages = [],
    durationSeconds = DEFAULT_VIDEO_DURATION_SECONDS,
    aspectRatio = DEFAULT_VIDEO_ASPECT_RATIO,
    signal,
  } = {}) {
    const body = JSON.stringify(buildVideoRequestBody({
      model: requestedModel,
      prompt,
      image,
      lastFrame,
      referenceImages,
      durationSeconds,
      aspectRatio,
    }));
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchImpl(baseUrl, {
          method: 'POST', headers, body, signal,
        });
        const payload = await readJson(response);
        if (!response.ok) throw createHttpError(response, payload);
        const data = readStatusPayload(payload) || {};
        const upstreamTaskId = data.id || data.task_id || data.taskId;
        if (!upstreamTaskId) throw new Error('Video provider response is missing task id');
        let parsedStatus;
        try {
          parsedStatus = parseVideoStatus(data);
        } catch {
          parsedStatus = { status: 'queued' };
        }
        return {
          id: String(upstreamTaskId),
          upstreamTaskId: String(upstreamTaskId),
          status: parsedStatus.status,
          ...(parsedStatus.video_url ? { videoUrl: parsedStatus.video_url } : {}),
        };
      } catch (error) {
        if (error?.name === 'AbortError' || !shouldRetryMissingTaskId(error) || attempt === maxAttempts) {
          throw error;
        }
        await sleep(1_000 * (2 ** (attempt - 1)), signal);
      }
    }
    throw new Error('Video provider submission exhausted retries');
  }

  async function getStatus(upstreamTaskId, signal) {
    const encodedId = encodeURIComponent(String(upstreamTaskId));
    const statusUrl = statusUrlTemplate
      ? (statusUrlTemplate.includes('{id}')
        ? statusUrlTemplate.replace('{id}', encodedId)
        : `${statusUrlTemplate.replace(/\/+$/, '')}/${encodedId}`)
      : `${baseUrl}/${encodedId}`;
    const response = await fetchImpl(statusUrl, {
      method: 'GET', headers, signal,
    });
    try {
      const payload = await readJson(response);
      if (!response.ok) throw createHttpError(response, payload);
      return parseVideoStatus(payload);
    } catch (error) {
      if (!Number.isFinite(error?.status)) error.status = response.status;
      throw error;
    }
  }

  async function poll(upstreamTaskId, onStageOrOptions = {}) {
    const onStage = typeof onStageOrOptions === 'function' ? onStageOrOptions : onStageOrOptions.onStage;
    const signal = typeof onStageOrOptions === 'function' ? undefined : onStageOrOptions.signal;
    const startedAt = now();
    let retryCount = 0;
    while (true) {
      if (now() - startedAt >= timeoutMs) throw new Error('Video generation timed out');
      try {
        const result = await getStatus(upstreamTaskId, signal);
        retryCount = 0;
        onStage?.(result.status);
        if (result.status === 'completed') return result.video_url;
        if (result.status === 'failed') {
          const error = new Error(result.error || 'Video generation failed');
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

  return {
    submit,
    submitVideo: submit,
    getStatus,
    getVideoStatus: getStatus,
    poll,
    pollVideo: poll,
  };
}
