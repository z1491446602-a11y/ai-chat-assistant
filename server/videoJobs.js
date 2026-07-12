import { randomUUID } from 'crypto';

const PERSISTED_FIELDS = [
  'id', 'ownerId', 'ownerType', 'sessionId', 'messageId', 'userMessageId', 'prompt',
  'upstreamTaskId', 'status', 'stage', 'error', 'createdAt', 'updatedAt',
];
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'canceled']);

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

export function createVideoJobStore({ data: sharedData, loadData, saveData, now = Date.now, generateId = randomUUID } = {}) {
  function readData() {
    const data = loadData ? (loadData() || {}) : (sharedData || {});
    if (!data.videoJobs || typeof data.videoJobs !== 'object' || Array.isArray(data.videoJobs)) {
      data.videoJobs = {};
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
      prompt: String(input.prompt || ''),
      upstreamTaskId: String(input.upstreamTaskId || ''),
      status: String(input.status || 'pending'),
      stage: String(input.stage || input.videoStage || 'created'),
      error: String(input.error || ''),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const data = readData();
    data.videoJobs[job.id] = job;
    saveData(data);
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
    const updated = pickPersistedFields({ ...existing, ...allowedChanges, id: key, updatedAt: now() });
    data.videoJobs[key] = updated;
    saveData(data);
    return clone(updated);
  }

  function getRecoveryPlan() {
    const recoverable = [];
    const unknownSubmission = [];
    for (const job of Object.values(readData().videoJobs)) {
      if (!job || TERMINAL_STATUSES.has(String(job.status || '').toLowerCase())) continue;
      const target = String(job.upstreamTaskId || '').trim() ? recoverable : unknownSubmission;
      target.push(clone(pickPersistedFields(job)));
    }
    return { recoverable, unknownSubmission };
  }

  return {
    create,
    createVideoJob: create,
    get,
    getVideoJob: get,
    patch,
    patchVideoJob: patch,
    getRecoveryPlan,
  };
}

export const createVideoJobs = createVideoJobStore;
