export const MEDIA_REQUEST_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const MEDIA_REQUEST_CLAIM_LEASE_MS = 2 * 60 * 1_000;
export const MAX_MEDIA_REQUEST_RECORDS = 2_000;

const MEDIA_TYPES = new Set(['image', 'video']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const PERSISTED_STATUSES = new Set(['claimed', 'accepted', 'aborted', ...TERMINAL_STATUSES]);
const MAX_LINK_ID_LENGTH = 256;
const MAX_FINGERPRINT_LENGTH = 512;

function createServiceError(message, code, status) {
  return Object.assign(new Error(message), { code, status, statusCode: status });
}

function invalidRequest(message) {
  throw createServiceError(message, 'INVALID_MEDIA_REQUEST', 400);
}

function normalizeRequiredString(value, label, maxLength) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > maxLength) {
    invalidRequest(`${label} is invalid`);
  }
  return normalized;
}

function normalizeIdentity(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalidRequest('Media request identity is required');
  }

  const userId = normalizeRequiredString(input.userId, 'userId', MAX_LINK_ID_LENGTH);
  const mediaType = String(input.mediaType ?? '').trim().toLowerCase();
  if (!MEDIA_TYPES.has(mediaType)) {
    invalidRequest('mediaType must be image or video');
  }
  const requestId = normalizeRequiredString(input.requestId, 'requestId', 128);

  return { userId, mediaType, requestId };
}

function buildKey(identity) {
  return JSON.stringify([identity.userId, identity.mediaType, identity.requestId]);
}

function normalizeFingerprint(value) {
  return normalizeRequiredString(value, 'payloadFingerprint', MAX_FINGERPRINT_LENGTH);
}

function normalizeLink(link) {
  if (!link || typeof link !== 'object' || Array.isArray(link)) {
    invalidRequest('Media task link is required');
  }
  return {
    taskId: normalizeRequiredString(link.taskId, 'taskId', MAX_LINK_ID_LENGTH),
    sessionId: normalizeRequiredString(link.sessionId, 'sessionId', MAX_LINK_ID_LENGTH),
    messageId: normalizeRequiredString(link.messageId, 'messageId', MAX_LINK_ID_LENGTH),
  };
}

function isTerminal(record) {
  return TERMINAL_STATUSES.has(String(record?.status || '').toLowerCase());
}

function isExpiredTerminal(record, timestamp) {
  const terminalAt = Number(record?.terminalAt);
  return isTerminal(record)
    && Number.isFinite(terminalAt)
    && timestamp - terminalAt >= MEDIA_REQUEST_RETENTION_MS;
}

function isExpiredClaim(record, timestamp) {
  const updatedAt = Number(record?.updatedAt);
  return record?.status === 'claimed'
    && Number.isFinite(updatedAt)
    && timestamp - updatedAt >= MEDIA_REQUEST_CLAIM_LEASE_MS;
}

function sameLink(record, link) {
  return record.taskId === link.taskId
    && record.sessionId === link.sessionId
    && record.messageId === link.messageId;
}

function invalidPersistedRecord(message) {
  throw createServiceError(
    `Invalid persisted media request registry: ${message}`,
    'INVALID_PERSISTED_MEDIA_REQUESTS',
    500,
  );
}

function requireTimestamp(record, field) {
  const value = Number(record?.[field]);
  if (!Number.isFinite(value) || value < 0) {
    invalidPersistedRecord(`${field} is invalid`);
  }
  return value;
}

function validatePersistedRequests(requests) {
  const entries = Object.entries(requests);
  if (entries.length > MAX_MEDIA_REQUEST_RECORDS) {
    invalidPersistedRecord('record count exceeds the hard limit');
  }

  const linkedTaskIds = new Set();
  for (const [storageKey, record] of entries) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      invalidPersistedRecord('record must be an object');
    }

    let identity;
    let fingerprint;
    try {
      identity = normalizeIdentity(record);
      fingerprint = normalizeFingerprint(record.payloadFingerprint);
    } catch {
      invalidPersistedRecord('identity or fingerprint is invalid');
    }
    const expectedKey = buildKey(identity);
    if (storageKey !== expectedKey || record.key !== expectedKey) {
      invalidPersistedRecord('record key does not match its identity');
    }
    if (
      record.userId !== identity.userId
      || record.mediaType !== identity.mediaType
      || record.requestId !== identity.requestId
      || record.payloadFingerprint !== fingerprint
    ) {
      invalidPersistedRecord('record fields are not normalized');
    }

    const status = String(record.status || '').trim().toLowerCase();
    if (!PERSISTED_STATUSES.has(status) || record.status !== status) {
      invalidPersistedRecord('status is invalid');
    }
    const createdAt = requireTimestamp(record, 'createdAt');
    const updatedAt = requireTimestamp(record, 'updatedAt');
    if (updatedAt < createdAt) {
      invalidPersistedRecord('updatedAt precedes createdAt');
    }

    if (status === 'claimed' || status === 'aborted') {
      if (record.taskId || record.sessionId || record.messageId) {
        invalidPersistedRecord(`${status} record must not contain task links`);
      }
      if (status === 'aborted') {
        const abortedAt = requireTimestamp(record, 'abortedAt');
        if (abortedAt < createdAt || abortedAt > updatedAt) {
          invalidPersistedRecord('abortedAt is out of range');
        }
      }
      continue;
    }

    let link;
    try {
      link = normalizeLink(record);
    } catch {
      invalidPersistedRecord('accepted or terminal record has invalid task links');
    }
    const acceptedAt = requireTimestamp(record, 'acceptedAt');
    if (acceptedAt < createdAt || acceptedAt > updatedAt) {
      invalidPersistedRecord('acceptedAt is out of range');
    }
    if (linkedTaskIds.has(link.taskId)) {
      invalidPersistedRecord('multiple requests link to the same task');
    }
    linkedTaskIds.add(link.taskId);

    if (TERMINAL_STATUSES.has(status)) {
      const terminalAt = requireTimestamp(record, 'terminalAt');
      if (terminalAt < acceptedAt || terminalAt > updatedAt) {
        invalidPersistedRecord('terminalAt is out of range');
      }
    }
  }
}

export function createMediaRequestService({
  data,
  saveData,
  now = Date.now,
} = {}) {
  if (!data || typeof data !== 'object' || typeof saveData !== 'function') {
    throw new TypeError('createMediaRequestService requires data and saveData');
  }
  if (typeof now !== 'function') {
    throw new TypeError('createMediaRequestService now must be a function');
  }
  if (!Object.hasOwn(data, 'mediaRequests')) {
    data.mediaRequests = {};
  } else if (
    !data.mediaRequests
    || typeof data.mediaRequests !== 'object'
    || Array.isArray(data.mediaRequests)
  ) {
    invalidPersistedRecord('registry must be an object');
  }

  const requests = data.mediaRequests;
  validatePersistedRequests(requests);

  function restoreRequests(snapshot) {
    for (const key of Object.keys(requests)) {
      delete requests[key];
    }
    Object.assign(requests, snapshot);
    data.mediaRequests = requests;
  }

  function persistMutation(mutate) {
    const snapshot = { ...requests };
    try {
      const result = mutate();
      saveData(data);
      return result;
    } catch (error) {
      restoreRequests(snapshot);
      throw error;
    }
  }

  function resolveKey(identityOrKey) {
    if (typeof identityOrKey === 'string') {
      return identityOrKey.trim();
    }
    return buildKey(normalizeIdentity(identityOrKey));
  }

  function find(identityOrKey) {
    const key = resolveKey(identityOrKey);
    return key ? requests[key] || null : null;
  }

  function pruneEligibleInPlace(timestamp) {
    const removed = [];
    for (const [key, record] of Object.entries(requests)) {
      if (
        record?.status === 'aborted'
        || isExpiredClaim(record, timestamp)
        || isExpiredTerminal(record, timestamp)
      ) {
        delete requests[key];
        removed.push(key);
      }
    }
    return removed;
  }

  function claim(input) {
    const identity = normalizeIdentity(input);
    const payloadFingerprint = normalizeFingerprint(input.payloadFingerprint);
    const key = buildKey(identity);
    const timestamp = Number(now());
    const existing = requests[key];
    const existingIsExpired = existing && (
      isExpiredClaim(existing, timestamp)
      || isExpiredTerminal(existing, timestamp)
    );

    if (
      existing
      && !existingIsExpired
      && existing.payloadFingerprint !== payloadFingerprint
    ) {
      throw createServiceError(
        'Request id was already used with a different payload',
        'MEDIA_REQUEST_FINGERPRINT_CONFLICT',
        409,
      );
    }

    if (
      existing
      && !isExpiredClaim(existing, timestamp)
      && !isExpiredTerminal(existing, timestamp)
    ) {
      if (existing.status !== 'aborted') {
        return { record: existing, created: false };
      }
    }

    return persistMutation(() => {
      if (existing && (
        existing.status === 'aborted'
        || existingIsExpired
      )) {
        delete requests[key];
      }

      if (Object.keys(requests).length >= MAX_MEDIA_REQUEST_RECORDS) {
        pruneEligibleInPlace(timestamp);
      }
      if (Object.keys(requests).length >= MAX_MEDIA_REQUEST_RECORDS) {
        throw createServiceError(
          'Media request registry is full',
          'MEDIA_REQUEST_CAPACITY_REACHED',
          503,
        );
      }

      const record = {
        key,
        ...identity,
        payloadFingerprint,
        taskId: '',
        sessionId: '',
        messageId: '',
        status: 'claimed',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      requests[key] = record;
      return { record, created: true };
    });
  }

  function accept(identityOrKey, taskLink) {
    const key = resolveKey(identityOrKey);
    const existing = requests[key];
    if (!existing) {
      throw createServiceError('Media request was not found', 'MEDIA_REQUEST_NOT_FOUND', 404);
    }
    const link = normalizeLink(taskLink);

    if (existing.status === 'accepted' || isTerminal(existing)) {
      if (sameLink(existing, link)) {
        return existing;
      }
      throw createServiceError(
        'Media request is already linked to another task',
        'MEDIA_REQUEST_STATE_CONFLICT',
        409,
      );
    }
    if (existing.status !== 'claimed') {
      throw createServiceError(
        'Media request cannot be accepted in its current state',
        'MEDIA_REQUEST_STATE_CONFLICT',
        409,
      );
    }

    const taskAlreadyLinked = Object.values(requests).some(record => (
      record !== existing && record?.taskId === link.taskId
    ));
    if (taskAlreadyLinked) {
      throw createServiceError(
        'Media task is already linked to another request',
        'MEDIA_REQUEST_STATE_CONFLICT',
        409,
      );
    }

    return persistMutation(() => {
      const timestamp = Number(now());
      const accepted = {
        ...existing,
        ...link,
        status: 'accepted',
        acceptedAt: timestamp,
        updatedAt: timestamp,
      };
      requests[key] = accepted;
      return accepted;
    });
  }

  function abort(identityOrKey) {
    const key = resolveKey(identityOrKey);
    const existing = requests[key];
    if (!existing) {
      throw createServiceError('Media request was not found', 'MEDIA_REQUEST_NOT_FOUND', 404);
    }
    if (existing.status === 'aborted') {
      return existing;
    }
    if (existing.status !== 'claimed') {
      throw createServiceError(
        'Accepted media requests cannot be aborted',
        'MEDIA_REQUEST_STATE_CONFLICT',
        409,
      );
    }

    return persistMutation(() => {
      const timestamp = Number(now());
      const aborted = {
        ...existing,
        taskId: '',
        sessionId: '',
        messageId: '',
        status: 'aborted',
        abortedAt: timestamp,
        updatedAt: timestamp,
      };
      requests[key] = aborted;
      return aborted;
    });
  }

  function terminal(identityOrKey, status) {
    const key = resolveKey(identityOrKey);
    const existing = requests[key];
    if (!existing) {
      throw createServiceError('Media request was not found', 'MEDIA_REQUEST_NOT_FOUND', 404);
    }
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (!TERMINAL_STATUSES.has(normalizedStatus)) {
      invalidRequest('Media request terminal status is invalid');
    }
    if (isTerminal(existing)) {
      return existing;
    }
    if (existing.status !== 'accepted') {
      throw createServiceError(
        'Only accepted media requests can become terminal',
        'MEDIA_REQUEST_STATE_CONFLICT',
        409,
      );
    }

    return persistMutation(() => {
      const timestamp = Number(now());
      const terminalRecord = {
        ...existing,
        status: normalizedStatus,
        terminalAt: timestamp,
        updatedAt: timestamp,
      };
      requests[key] = terminalRecord;
      return terminalRecord;
    });
  }

  function recoverAccepted(identityOrKey, outcome) {
    const key = resolveKey(identityOrKey);
    const existing = requests[key];
    if (!existing) {
      throw createServiceError('Media request was not found', 'MEDIA_REQUEST_NOT_FOUND', 404);
    }
    const normalizedOutcome = String(outcome || '').trim().toLowerCase();
    if (TERMINAL_STATUSES.has(normalizedOutcome)) {
      return terminal(key, normalizedOutcome);
    }
    if (normalizedOutcome !== 'aborted') {
      invalidRequest('Media request recovery outcome is invalid');
    }
    if (existing.status === 'aborted') {
      return existing;
    }
    if (existing.status !== 'accepted') {
      throw createServiceError(
        'Only accepted media requests can be recovered',
        'MEDIA_REQUEST_STATE_CONFLICT',
        409,
      );
    }

    return persistMutation(() => {
      const timestamp = Number(now());
      const recovered = {
        ...existing,
        taskId: '',
        sessionId: '',
        messageId: '',
        status: 'aborted',
        abortedAt: timestamp,
        updatedAt: timestamp,
      };
      requests[key] = recovered;
      return recovered;
    });
  }

  function prune() {
    const timestamp = Number(now());
    const candidates = Object.entries(requests)
      .filter(([, record]) => (
        record?.status === 'aborted'
        || isExpiredClaim(record, timestamp)
        || isExpiredTerminal(record, timestamp)
      ))
      .map(([key]) => key);
    if (!candidates.length) {
      return [];
    }

    return persistMutation(() => {
      for (const key of candidates) {
        delete requests[key];
      }
      return candidates;
    });
  }

  function getRecoveryPlan(activeTaskIds = []) {
    const activeIds = new Set(
      (Array.isArray(activeTaskIds) ? activeTaskIds : [])
        .map(value => String(value || '').trim())
        .filter(Boolean),
    );
    const claimed = [];
    const activeAccepted = [];
    const orphanAccepted = [];
    const terminalLinked = [];
    for (const record of Object.values(requests)) {
      if (record?.status === 'claimed') {
        claimed.push(record);
      } else if (record?.status === 'accepted') {
        (activeIds.has(record.taskId) ? activeAccepted : orphanAccepted).push(record);
      } else if (isTerminal(record)) {
        terminalLinked.push(record);
      }
    }
    return { claimed, activeAccepted, orphanAccepted, terminalLinked };
  }

  return {
    find,
    claim,
    accept,
    abort,
    terminal,
    recoverAccepted,
    prune,
    getRecoveryPlan,
  };
}
