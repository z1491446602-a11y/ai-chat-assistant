const PUBLIC_STATUSES = new Set(['queued', 'processing', 'completed', 'failed']);

function normalizeImages(images) {
  if (images == null) return [];
  if (!Array.isArray(images)) throw new Error('Video images must be an array');
  return images.map(image => String(image || '').trim()).filter(Boolean);
}

export function buildVideoRequestBody({ model, prompt, images = [] }) {
  const normalizedPrompt = String(prompt || '').trim();
  const normalizedImages = normalizeImages(images);
  if (!normalizedPrompt) throw new Error('Video prompt is required');
  if (normalizedImages.length > 2) throw new Error('Video generation supports at most 2 images');

  const body = { model: String(model || '').trim(), prompt: normalizedPrompt };
  if (normalizedImages.length === 1) {
    body.image = { image_url: normalizedImages[0] };
  } else if (normalizedImages.length === 2) {
    body.images = normalizedImages.map(image_url => ({ image_url }));
  }
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
    const videoUrl = data.video_url || data.videoUrl || data.output?.video_url || data.output?.url;
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
    throw new Error('Video provider returned invalid JSON');
  }
}

function createHttpError(response, payload) {
  const error = new Error(readError(payload) || `Video provider request failed (${response.status})`);
  error.status = response.status;
  return error;
}

export function createVideoProvider({
  apiUrl,
  apiKey,
  model = 'veo_3_1_fast',
  pollIntervalMs = 10_000,
  timeoutMs = 600_000,
  fetchImpl = globalThis.fetch,
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
  now = Date.now,
} = {}) {
  const baseUrl = String(apiUrl || '').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', 'x-api-key': String(apiKey || '') };

  async function submit({ prompt, images = [], signal } = {}) {
    const response = await fetchImpl(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildVideoRequestBody({ model, prompt, images })),
      signal,
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
  }

  async function getStatus(upstreamTaskId, signal) {
    const response = await fetchImpl(`${baseUrl}/${encodeURIComponent(String(upstreamTaskId))}`, {
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
