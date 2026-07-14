import type { APIConfig, MessageFile, Session, VideoGenerationInputs } from '@/types';
import { createHttpError, readJsonResult } from './http';

export type ImageGenerationProvider = 'gpt' | 'grok';

export interface ServerAiTask {
  id: string;
  userId: string;
  sessionId: string;
  messageId: string;
  type: 'chat' | 'image' | 'video';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  content?: string;
  images?: string[];
  files?: MessageFile[];
  audioUrl?: string;
  audioMimeType?: string;
  duration?: number;
  progressPercent?: number;
  queuePosition?: number;
  imageStage?: 'submitting' | 'generating' | 'receiving' | 'persisting';
  imageFileName?: string;
  imageFileSize?: number;
  imageMimeType?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageProvider?: ImageGenerationProvider;
  videoUrl?: string;
  videoMimeType?: string;
  videoFileName?: string;
  videoFileSize?: number;
  videoDuration?: number;
  videoWidth?: number;
  videoHeight?: number;
  videoStage?: 'submitting' | 'queued' | 'processing' | 'downloading' | 'validating';
  createdAt: number;
  updatedAt: number;
}

export type AiTaskOwner =
  | { userId: string; guestId?: never }
  | { userId?: never; guestId: string };

type NormalizedAiTaskOwner =
  | { ownerType: 'user'; id: string; body: { userId: string; guestId?: never } }
  | { ownerType: 'guest'; id: string; body: { userId?: never; guestId: string } };

const INVALID_AI_TASK_OWNER_ERROR =
  'Invalid AI task owner: provide exactly one non-empty userId or guestId';
const INVALID_MEDIA_REQUEST_ID_ERROR =
  'Invalid media requestId: provide a non-empty value with at most 128 characters';
const CLIENT_REQUEST_ID_ERROR = '无法生成安全请求标识，请刷新页面后重试';

export function createClientRequestId(): string {
  try {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }
    if (typeof cryptoApi?.getRandomValues !== 'function') {
      throw new Error(CLIENT_REQUEST_ID_ERROR);
    }

    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    throw new Error(CLIENT_REQUEST_ID_ERROR);
  }
}

function normalizeMediaRequestId(requestId: string): string {
  const normalized = typeof requestId === 'string' ? requestId.trim() : '';
  if (!normalized || normalized.length > 128) {
    throw new Error(INVALID_MEDIA_REQUEST_ID_ERROR);
  }
  return normalized;
}

function normalizeOrCreateMediaRequestId(requestId: string | undefined): string {
  return requestId === undefined
    ? createClientRequestId()
    : normalizeMediaRequestId(requestId);
}

function isNetworkFetchError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  const message = error instanceof Error ? error.message : '';
  return /fetch failed|failed to fetch|networkerror/i.test(message);
}

async function fetchWithLocalizedNetworkError(
  path: string,
  init: RequestInit | undefined,
  fallbackMessage: string,
): Promise<Response> {
  try {
    return init === undefined ? await fetch(path) : await fetch(path, init);
  } catch {
    throw new Error(fallbackMessage);
  }
}

async function fetchPaidMediaTask(
  path: string,
  init: RequestInit,
  fallbackMessage: string,
): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch (firstError) {
    if (!isNetworkFetchError(firstError)) {
      throw firstError;
    }
  }

  try {
    return await fetch(path, init);
  } catch (secondError) {
    if (isNetworkFetchError(secondError)) {
      throw new Error(fallbackMessage);
    }
    throw secondError;
  }
}

function normalizeAiTaskOwner(owner: string | AiTaskOwner): NormalizedAiTaskOwner {
  const candidate: { userId?: unknown; guestId?: unknown } =
    typeof owner === 'string' ? { userId: owner } : owner;
  const rawUserId = candidate?.userId;
  const rawGuestId = candidate?.guestId;
  const userId = typeof rawUserId === 'string' ? rawUserId.trim() : '';
  const guestId = typeof rawGuestId === 'string' ? rawGuestId.trim() : '';
  const hasUserId = rawUserId !== undefined;
  const hasGuestId = rawGuestId !== undefined;

  if (hasUserId === hasGuestId || (hasUserId && !userId) || (hasGuestId && !guestId)) {
    throw new Error(INVALID_AI_TASK_OWNER_ERROR);
  }

  if (hasUserId) {
    return { ownerType: 'user', id: userId, body: { userId } };
  }

  return { ownerType: 'guest', id: guestId, body: { guestId } };
}

function getAiOwnerQuery(owner: NormalizedAiTaskOwner): string {
  return owner.ownerType === 'guest' ? '?ownerType=guest' : '';
}

function getAiOwnerPath(owner: NormalizedAiTaskOwner): string {
  return encodeURIComponent(owner.id);
}

function getAiTaskOwnerQuery(owner: NormalizedAiTaskOwner): string {
  const query = new URLSearchParams();
  query.set(`${owner.ownerType}Id`, owner.id);
  return `?${query.toString()}`;
}

export async function fetchServerAiSessions(owner: string | AiTaskOwner): Promise<Session[]> {
  const normalizedOwner = normalizeAiTaskOwner(owner);
  const response = await fetchWithLocalizedNetworkError(
    `/api/ai-sessions/${getAiOwnerPath(normalizedOwner)}${getAiOwnerQuery(normalizedOwner)}`,
    undefined,
    '加载 AI 历史失败，请检查网络后重试',
  );
  const result = await readJsonResult(response);

  if (!response.ok) {
    throw createHttpError(response, result.error || '加载 AI 历史失败');
  }

  return Array.isArray(result?.sessions) ? result.sessions as Session[] : [];
}

export async function createServerAiSession(owner: string | AiTaskOwner, model?: string): Promise<Session> {
  const normalizedOwner = normalizeAiTaskOwner(owner);
  const response = await fetchWithLocalizedNetworkError('/api/ai-sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...normalizedOwner.body, model }),
  }, '创建 AI 会话失败，请检查网络后重试');

  const result = await readJsonResult(response);
  if (!response.ok || !result?.session) {
    throw createHttpError(response, result.error || '创建 AI 会话失败');
  }

  return result.session as Session;
}

export async function deleteServerAiSession(
  owner: string | AiTaskOwner,
  sessionId: string,
): Promise<void> {
  const normalizedOwner = normalizeAiTaskOwner(owner);
  const response = await fetchWithLocalizedNetworkError(
    `/api/ai-sessions/${getAiOwnerPath(normalizedOwner)}/${encodeURIComponent(sessionId)}${getAiOwnerQuery(normalizedOwner)}`,
    { method: 'DELETE' },
    '删除聊天记录失败，请检查网络后重试',
  );

  const result = await readJsonResult(response);
  if (!response.ok) {
    throw createHttpError(response, result.error || '删除聊天记录失败');
  }
}

export async function clearServerAiSessions(owner: string | AiTaskOwner): Promise<number> {
  const normalizedOwner = normalizeAiTaskOwner(owner);
  const response = await fetchWithLocalizedNetworkError(
    `/api/ai-sessions/${getAiOwnerPath(normalizedOwner)}${getAiOwnerQuery(normalizedOwner)}`,
    { method: 'DELETE' },
    '清空聊天记录失败，请检查网络后重试',
  );

  const result = await readJsonResult(response);
  if (!response.ok) {
    throw createHttpError(response, result.error || '清空聊天记录失败');
  }

  return Number(result.deletedCount) || 0;
}

export async function createServerAiChatTask(
  owner: string | AiTaskOwner,
  sessionId: string | null | undefined,
  content: string,
  images: string[],
  files: MessageFile[],
  config: APIConfig,
): Promise<{ task: ServerAiTask; sessionId: string; messageId: string }> {
  const normalizedOwner = normalizeAiTaskOwner(owner);
  const response = await fetchWithLocalizedNetworkError('/api/ai-task/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...normalizedOwner.body,
      sessionId,
      content,
      images,
      files,
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      topP: config.topP,
    }),
  }, '聊天请求失败，请检查网络后重试');

  const result = await readJsonResult(response);
  if (!response.ok || !result?.task) {
    throw createHttpError(response, result.error || '提交 AI 任务失败');
  }

  return result as { task: ServerAiTask; sessionId: string; messageId: string };
}

export async function createServerAiImageTask(
  owner: string | AiTaskOwner,
  sessionId: string | null | undefined,
  prompt: string,
  images: string[],
  imageProvider: ImageGenerationProvider,
  requestId?: string,
): Promise<{ task: ServerAiTask; sessionId: string; messageId: string }> {
  const normalizedOwner = normalizeAiTaskOwner(owner);
  const normalizedRequestId = normalizeOrCreateMediaRequestId(requestId);
  const response = await fetchPaidMediaTask('/api/ai-task/image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...normalizedOwner.body,
      sessionId,
      prompt,
      images,
      imageProvider,
      requestId: normalizedRequestId,
    }),
  }, '图片请求失败，请稍后重试');

  const result = await readJsonResult(response);
  if (!response.ok || !result?.task) {
    throw createHttpError(response, result.error || '提交图片生成任务失败');
  }

  return result as { task: ServerAiTask; sessionId: string; messageId: string };
}

export async function createServerAiVideoTask(
  owner: string | AiTaskOwner,
  sessionId: string | null | undefined,
  prompt: string,
  inputs: VideoGenerationInputs,
  requestId?: string,
): Promise<{ task: ServerAiTask; sessionId: string; messageId: string }> {
  const normalizedOwner = normalizeAiTaskOwner(owner);
  const normalizedRequestId = normalizeOrCreateMediaRequestId(requestId);
  const response = await fetchPaidMediaTask('/api/ai-task/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...normalizedOwner.body,
      sessionId,
      prompt,
      image: inputs.image,
      lastFrame: inputs.lastFrame,
      referenceImages: inputs.referenceImages,
      requestId: normalizedRequestId,
    }),
  }, '视频请求失败，请稍后重试');

  const result = await readJsonResult(response);
  if (!response.ok || !result?.task) {
    throw createHttpError(response, result.error || '提交视频生成任务失败');
  }

  return result as { task: ServerAiTask; sessionId: string; messageId: string };
}

export async function fetchServerAiTask(taskId: string, owner: string | AiTaskOwner): Promise<ServerAiTask> {
  const normalizedOwner = normalizeAiTaskOwner(owner);
  const response = await fetchWithLocalizedNetworkError(
    `/api/ai-task/${encodeURIComponent(taskId)}${getAiTaskOwnerQuery(normalizedOwner)}`,
    undefined,
    '加载任务状态失败，请检查网络后重试',
  );
  const result = await readJsonResult(response);

  if (!response.ok || !result?.task) {
    throw createHttpError(response, result.error || '加载任务状态失败');
  }

  return result.task as ServerAiTask;
}

export async function cancelServerAiTask(taskId: string, owner: string | AiTaskOwner): Promise<ServerAiTask> {
  const normalizedOwner = normalizeAiTaskOwner(owner);
  const response = await fetchWithLocalizedNetworkError(
    `/api/ai-task/${encodeURIComponent(taskId)}/cancel${getAiTaskOwnerQuery(normalizedOwner)}`,
    { method: 'POST' },
    '停止任务失败，请检查网络后重试',
  );
  const result = await readJsonResult(response);

  if (!response.ok || !result?.task) {
    throw createHttpError(response, result.error || '停止任务失败');
  }

  return result.task as ServerAiTask;
}

export async function transcribeAiCallAudio(
  audioData: string,
  mimeType = 'audio/wav',
): Promise<string> {
  const response = await fetchWithLocalizedNetworkError('/api/voice/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audioData,
      mimeType,
    }),
  }, '语音转文字失败，请检查网络后重试');

  const result = await readJsonResult(response);
  if (!response.ok || typeof result?.text !== 'string') {
    throw createHttpError(response, result?.error || '语音转文字失败');
  }

  return String(result.text || '').trim();
}
