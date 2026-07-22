import { randomUUID } from 'crypto';

const PERSISTED_FIELDS = [
  'id', 'ownerId', 'ownerType', 'sessionId', 'messageId', 'userMessageId', 'prompt',
  'videoModel', 'upstreamTaskId', 'videoAssetIds', 'status', 'stage', 'error', 'createdAt', 'updatedAt',
];
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'canceled']);
export const MAX_VIDEO_JOBS = 1_000;
export const MAX_VIDEO_PROMPT_LENGTH = 10_000;

function pickPersistedFields(value) {
  const record = {};
  for (const field of PERSISTED_FIELDS) {
    if (value[field] !== undefined) record[field] = value[field];
  }
  return record;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function pruneVideoJobs(videoJobs) {
  const entries = Object.entries(videoJobs);
  const excess = entries.length - MAX_VIDEO_JOBS;
  if (excess <= 0) return;

  entries
    .sort(([, left], [, right]) => {
      const leftTerminal = TERMINAL_STATUSES.has(String(left?.status || '').toLowerCase());
      const rightTerminal = TERMINAL_STATUSES.has(String(right?.status || '').toLowerCase());
      if (leftTerminal !== rightTerminal) return leftTerminal ? -1 : 1;
      return (Number(left?.updatedAt) || Number(left?.createdAt) || 0)
        - (Number(right?.updatedAt) || Number(right?.createdAt) || 0);
    })
    .slice(0, excess)
    .forEach(([id]) => {
      delete videoJobs[id];
    });
}

export function createVideoJobStore({ data: sharedData, loadData, saveData, now = Date.now, generateId = randomUUID } = {}) {
  function readData() {
    const data = loadData ? (loadData() || {}) : (sharedData || {});
    if (!Object.hasOwn(data, 'videoJobs')) {
      data.videoJobs = {};
    } else if (!data.videoJobs || typeof data.videoJobs !== 'object' || Array.isArray(data.videoJobs)) {
      throw new TypeError('Persisted videoJobs must be an object');
    }
    return data;
  }

  function create(input = {}) {
    const timestamp = now();
    const job = pickPersistedFields({
      id: String(input.id || generateId()),
      ownerId: String(input.ownerId || ''),
      ownerType: String(input.ownerType || 'user'),
      sessionId: String(input.sessionId || ''),
      messageId: String(input.messageId || ''),
      userMessageId: String(input.userMessageId || ''),
      prompt: String(input.prompt || '').slice(0, MAX_VIDEO_PROMPT_LENGTH),
      videoModel: input.videoModel ? String(input.videoModel) : undefined,
      upstreamTaskId: String(input.upstreamTaskId || ''),
      videoAssetIds: Array.isArray(input.videoAssetIds) ? input.videoAssetIds.map(String) : [],
      status: String(input.status || 'pending'),
      stage: String(input.stage || input.videoStage || 'created'),
      error: String(input.error || ''),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const data = readData();
    const previousJobs = { ...data.videoJobs };
    data.videoJobs[job.id] = job;
    pruneVideoJobs(data.videoJobs);
    try {
      saveData(data);
    } catch (error) {
      data.videoJobs = previousJobs;
      throw error;
    }
    return clone(job);
  }

  function get(id) {
    const job = readData().videoJobs[String(id || '')];
    return job ? clone(pickPersistedFields(job)) : null;
  }

  function patch(id, changes = {}) {
    const data = readData();
    const key = String(id || '');
    const existing = data.videoJobs[key];
    if (!existing) return null;
    const allowedChanges = pickPersistedFields(changes);
    delete allowedChanges.id;
    delete allowedChanges.createdAt;
    if (allowedChanges.prompt !== undefined) {
      allowedChanges.prompt = String(allowedChanges.prompt).slice(0, MAX_VIDEO_PROMPT_LENGTH);
    }
    const updated = pickPersistedFields({ ...existing, ...allowedChanges, id: key, updatedAt: now() });
    data.videoJobs[key] = updated;
    try {
      saveData(data);
    } catch (error) {
      data.videoJobs[key] = existing;
      throw error;
    }
    return clone(updated);
  }

  function remove(id) {
    const data = readData();
    const key = String(id || '');
    if (!Object.prototype.hasOwnProperty.call(data.videoJobs, key)) {
      return false;
    }
    const previousJob = data.videoJobs[key];
    delete data.videoJobs[key];
    try {
      saveData(data);
    } catch (error) {
      data.videoJobs[key] = previousJob;
      throw error;
    }
    return true;
  }

  function getRecoveryPlan() {
    const recoverable = [];
    const unknownSubmission = [];
    const staleAssets = [];
    for (const job of Object.values(readData().videoJobs)) {
      if (!job) continue;
      if (TERMINAL_STATUSES.has(String(job.status || '').toLowerCase())) {
        if (Array.isArray(job.videoAssetIds) && job.videoAssetIds.some(Boolean)) {
          staleAssets.push(clone(pickPersistedFields(job)));
        }
        continue;
      }
      const target = String(job.upstreamTaskId || '').trim() ? recoverable : unknownSubmission;
      target.push(clone(pickPersistedFields(job)));
    }
    return { recoverable, unknownSubmission, staleAssets };
  }

  return {
    create,
    createVideoJob: create,
    get,
    getVideoJob: get,
    patch,
    patchVideoJob: patch,
    remove,
    removeVideoJob: remove,
    getRecoveryPlan,
  };
}

export const createVideoJobs = createVideoJobStore;
