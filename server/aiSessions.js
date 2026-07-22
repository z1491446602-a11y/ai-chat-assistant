export const MAX_AI_SESSIONS_PER_OWNER = 100;
export const MAX_AI_MESSAGES_PER_SESSION = 200;
export const MAX_AI_MESSAGE_CONTENT_LENGTH = 100_000;
export const MAX_AI_IMAGES_PER_MESSAGE = 9;
export const MAX_AI_FILES_PER_MESSAGE = 10;
export const MAX_AI_MEDIA_URL_LENGTH = 2_048;
export const MAX_AI_FILE_NAME_LENGTH = 255;
export const MAX_GUEST_OWNER_BUCKETS = 500;

const MAX_AI_METADATA_LENGTH = 255;

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function sanitizeBoundedString(value, maxLength, { trim = true } = {}) {
  const source = typeof value === 'string'
    ? value
    : (value == null ? '' : String(value));
  const normalized = trim ? source.trim() : source;
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function sanitizeMediaReference(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const reference = value.trim();
  if (!reference || reference.length > MAX_AI_MEDIA_URL_LENGTH || hasControlCharacters(reference)) {
    return undefined;
  }

  if (reference.startsWith('/') && !reference.startsWith('//')) {
    try {
      const parsed = new URL(reference, 'https://local.invalid');
      if (parsed.origin === 'https://local.invalid') {
        return reference;
      }
    } catch {
      return undefined;
    }
  }

  try {
    const parsed = new URL(reference);
    if (
      ['http:', 'https:'].includes(parsed.protocol)
      && parsed.hostname
      && !parsed.username
      && !parsed.password
    ) {
      return reference;
    }
  } catch {
    // Invalid and non-absolute references are not safe persistence targets.
  }

  return undefined;
}

function sanitizePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function arePersistedValuesEqual(left, right) {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => arePersistedValuesEqual(value, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }

  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] === undefined && right[key] === undefined) {
      continue;
    }
    if (!arePersistedValuesEqual(left[key], right[key])) {
      return false;
    }
  }
  return true;
}

function clonePersistedValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function createAiSessionStore({
  data,
  saveData,
  normalizeUserId,
  normalizeGuestId,
  generateEntityId,
  getAiTask,
}) {
  if (!Object.hasOwn(data, 'aiSessions')) {
    data.aiSessions = {};
  } else if (!data.aiSessions || typeof data.aiSessions !== 'object' || Array.isArray(data.aiSessions)) {
    throw new TypeError('Persisted aiSessions must be an object');
  }

  function resolveAiOwner(ownerRef) {
    if (ownerRef && typeof ownerRef === 'object') {
      const normalizedUserId = normalizeUserId(ownerRef.userId);
      if (normalizedUserId) {
        return {
          ownerKey: normalizedUserId,
          ownerId: normalizedUserId,
          ownerType: 'user',
        };
      }

      const normalizedGuestId = normalizeGuestId(ownerRef.guestId);
      if (normalizedGuestId) {
        return {
          ownerKey: `guest:${normalizedGuestId}`,
          ownerId: normalizedGuestId,
          ownerType: 'guest',
        };
      }
    }

    const normalizedUserId = normalizeUserId(ownerRef);
    if (normalizedUserId) {
      return {
        ownerKey: normalizedUserId,
        ownerId: normalizedUserId,
        ownerType: 'user',
      };
    }

    return null;
  }

  function isAuthenticatedUserId(ownerId) {
    const users = data.authUsers;
    if (users === undefined) {
      return false;
    }
    if (!users || typeof users !== 'object' || Array.isArray(users)) {
      return true;
    }
    if (Object.hasOwn(users, ownerId)) {
      return true;
    }
    return Object.values(users).some(user => (
      String(user?.id || '').trim() === ownerId
    ));
  }

  function migrateLegacyGuestBucket(owner) {
    if (!owner || owner.ownerType !== 'guest' || isAuthenticatedUserId(owner.ownerId)) {
      return false;
    }

    const legacyOwnerKey = owner.ownerId;
    const guestOwnerKey = owner.ownerKey;
    const legacyBucket = data.aiSessions[legacyOwnerKey];
    if (!Array.isArray(legacyBucket)) {
      return false;
    }

    const hadGuestBucket = Object.hasOwn(data.aiSessions, guestOwnerKey);
    const previousGuestBucket = data.aiSessions[guestOwnerKey];
    if (hadGuestBucket && !Array.isArray(previousGuestBucket)) {
      return false;
    }

    const sessionsById = new Map();
    for (const session of [...legacyBucket, ...(previousGuestBucket || [])]) {
      const migratedSession = sanitizeAiSession({
        ...session,
        ownerId: owner.ownerId,
        ownerType: 'guest',
      });
      const previousSession = sessionsById.get(migratedSession.id);
      if (
        !previousSession
        || Number(migratedSession.updatedAt) >= Number(previousSession.updatedAt)
      ) {
        sessionsById.set(migratedSession.id, migratedSession);
      }
    }

    data.aiSessions[guestOwnerKey] = boundAiSessionBucket([...sessionsById.values()]);
    delete data.aiSessions[legacyOwnerKey];
    try {
      saveData(data);
    } catch (error) {
      data.aiSessions[legacyOwnerKey] = legacyBucket;
      if (hadGuestBucket) data.aiSessions[guestOwnerKey] = previousGuestBucket;
      else delete data.aiSessions[guestOwnerKey];
      throw error;
    }
    return true;
  }

  function ensureAiSessionBucket(ownerRef) {
    const ownerKey = getAiOwnerKey(ownerRef);
    if (!Array.isArray(data.aiSessions[ownerKey])) {
      data.aiSessions[ownerKey] = [];
    }
    return data.aiSessions[ownerKey];
  }

  function readAiSessionBucket(ownerRef) {
    const bucket = data.aiSessions[getAiOwnerKey(ownerRef)];
    return Array.isArray(bucket) ? bucket : null;
  }

  function getAiOwnerKey(ownerRef) {
    const owner = resolveAiOwner(ownerRef);
    migrateLegacyGuestBucket(owner);
    return owner?.ownerKey || 'guest';
  }

  function pruneGuestOwnerBuckets(currentOwnerKey) {
    const guestEntries = Object.entries(data.aiSessions)
      .filter(([ownerKey, bucket]) => ownerKey.startsWith('guest:') && Array.isArray(bucket));
    const excess = guestEntries.length - MAX_GUEST_OWNER_BUCKETS;
    if (excess <= 0) {
      return;
    }

    guestEntries
      .filter(([ownerKey]) => ownerKey !== currentOwnerKey)
      .sort(([leftKey, leftBucket], [rightKey, rightBucket]) => {
        const leftEmpty = leftBucket.length === 0;
        const rightEmpty = rightBucket.length === 0;
        if (leftEmpty !== rightEmpty) return leftEmpty ? -1 : 1;
        const leftUpdatedAt = Math.max(0, ...leftBucket.map(session => Number(session?.updatedAt) || 0));
        const rightUpdatedAt = Math.max(0, ...rightBucket.map(session => Number(session?.updatedAt) || 0));
        return (leftUpdatedAt - rightUpdatedAt) || leftKey.localeCompare(rightKey);
      })
      .slice(0, excess)
      .forEach(([ownerKey]) => {
        delete data.aiSessions[ownerKey];
      });
  }

  function persistAiSessionBucket(ownerRef, nextBucket) {
    const ownerKey = getAiOwnerKey(ownerRef);
    const previousBuckets = { ...data.aiSessions };
    data.aiSessions[ownerKey] = nextBucket;
    if (ownerKey.startsWith('guest:')) {
      pruneGuestOwnerBuckets(ownerKey);
    }
    try {
      saveData(data);
    } catch (error) {
      data.aiSessions = previousBuckets;
      throw error;
    }
    return nextBucket;
  }

  function buildAiMessagePreview(message) {
    const text = String(message?.content || '').trim();
    if (text) {
      return text;
    }

    if (Array.isArray(message?.images) && message.images.length) {
      return '[图片]';
    }

    if (Array.isArray(message?.files) && message.files.length) {
      return `[文件] ${message.files[0].fileName || '附件'}`;
    }

    return '新对话';
  }

  function sanitizeAiMessage(message) {
    const images = Array.isArray(message.images)
      ? message.images
        .map(sanitizeMediaReference)
        .filter(Boolean)
        .slice(0, MAX_AI_IMAGES_PER_MESSAGE)
      : [];
    const files = Array.isArray(message.files)
      ? message.files
        .map((file) => {
          const fileName = sanitizeBoundedString(file?.fileName, MAX_AI_FILE_NAME_LENGTH);
          const fileUrl = sanitizeMediaReference(file?.fileUrl);
          if (!fileName || !fileUrl) {
            return null;
          }
          return {
            fileName,
            fileUrl,
            fileSize: sanitizePositiveNumber(file.fileSize),
            mimeType: sanitizeBoundedString(file.mimeType, MAX_AI_METADATA_LENGTH) || undefined,
          };
        })
        .filter(Boolean)
        .slice(0, MAX_AI_FILES_PER_MESSAGE)
      : [];

    return {
      id: sanitizeBoundedString(message.id, MAX_AI_METADATA_LENGTH),
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: sanitizeBoundedString(message.content, MAX_AI_MESSAGE_CONTENT_LENGTH, { trim: false }),
      images: images.length ? images : undefined,
      audioUrl: sanitizeMediaReference(message.audioUrl),
      duration: sanitizePositiveNumber(message.duration),
      audioMimeType: sanitizeBoundedString(message.audioMimeType, MAX_AI_METADATA_LENGTH) || undefined,
      progressPercent: Number.isFinite(Number(message.progressPercent)) ? Number(message.progressPercent) : undefined,
      imageFileName: sanitizeBoundedString(message.imageFileName, MAX_AI_FILE_NAME_LENGTH) || undefined,
      imageFileSize: sanitizePositiveNumber(message.imageFileSize),
      imageMimeType: sanitizeBoundedString(message.imageMimeType, MAX_AI_METADATA_LENGTH) || undefined,
      imageWidth: sanitizePositiveNumber(message.imageWidth),
      imageHeight: sanitizePositiveNumber(message.imageHeight),
      imageProvider: ['gpt', 'grok'].includes(message.imageProvider) ? message.imageProvider : undefined,
      imageGenerationStage: ['submitting', 'generating', 'receiving', 'persisting'].includes(message.imageGenerationStage)
        ? message.imageGenerationStage
        : undefined,
      videoUrl: sanitizeMediaReference(message.videoUrl),
      videoMimeType: sanitizeBoundedString(message.videoMimeType, MAX_AI_METADATA_LENGTH) || undefined,
      videoFileName: sanitizeBoundedString(message.videoFileName, MAX_AI_FILE_NAME_LENGTH) || undefined,
      videoFileSize: sanitizePositiveNumber(message.videoFileSize),
      videoDuration: sanitizePositiveNumber(message.videoDuration),
      videoWidth: sanitizePositiveNumber(message.videoWidth),
      videoHeight: sanitizePositiveNumber(message.videoHeight),
      videoGenerationStage: ['submitting', 'queued', 'processing', 'downloading', 'validating'].includes(message.videoGenerationStage)
        ? message.videoGenerationStage
        : undefined,
      files: files.length ? files : undefined,
      timestamp: Number(message.timestamp) || Date.now(),
      status: sanitizeBoundedString(message.status, 32) || 'sent',
    };
  }

  function sanitizeAiSession(session) {
    const ownerType = session.ownerType === 'guest' ? 'guest' : 'user';
    return {
      id: sanitizeBoundedString(session.id, MAX_AI_METADATA_LENGTH),
      title: sanitizeBoundedString(session.title || '新对话', MAX_AI_METADATA_LENGTH),
      messages: Array.isArray(session.messages)
        ? session.messages.slice(-MAX_AI_MESSAGES_PER_SESSION).map(sanitizeAiMessage)
        : [],
      createdAt: Number(session.createdAt) || Date.now(),
      updatedAt: Number(session.updatedAt) || Date.now(),
      ownerId: ownerType === 'guest'
        ? (normalizeGuestId(session.ownerId) || undefined)
        : (session.ownerId ? normalizeUserId(session.ownerId) : undefined),
      ownerType,
      model: sanitizeBoundedString(session.model, MAX_AI_METADATA_LENGTH) || undefined,
      pendingTaskId: sanitizeBoundedString(session.pendingTaskId, MAX_AI_METADATA_LENGTH) || undefined,
    };
  }

  function boundAiSessionBucket(sessions, currentSessionId) {
    const sanitized = sessions.map(sanitizeAiSession);
    const normalizedCurrentId = String(currentSessionId || '');
    const currentIndex = normalizedCurrentId
      ? sanitized.findIndex(session => session.id === normalizedCurrentId)
      : -1;
    const current = currentIndex >= 0 ? sanitized[currentIndex] : null;
    const remaining = sanitized
      .filter((_session, index) => index !== currentIndex)
      .sort((left, right) => (
        (right.updatedAt - left.updatedAt)
        || (right.createdAt - left.createdAt)
        || right.id.localeCompare(left.id)
      ));

    return current
      ? [current, ...remaining.slice(0, MAX_AI_SESSIONS_PER_OWNER - 1)]
      : remaining.slice(0, MAX_AI_SESSIONS_PER_OWNER);
  }

  function isImageProgressMessage(message, sessionModel) {
    const content = String(message?.content || '');
    return (
      sessionModel === 'gpt-image-2'
      || sessionModel === 'grok-imagine-image-quality'
      || Boolean(message?.imageGenerationStage)
      || Number.isFinite(Number(message?.progressPercent))
      || /生成图片|生图|图生图/.test(content)
    );
  }

  function markInterruptedStreamingMessages(session) {
    session.messages = (session.messages || []).map((message) => {
      const sanitized = sanitizeAiMessage(message);
      if (sanitized.role !== 'assistant' || sanitized.status !== 'streaming') {
        return sanitized;
      }

      const isImageMessage = isImageProgressMessage(sanitized, session.model);
      const isVideoMessage = Boolean(sanitized.videoGenerationStage);
      return {
        ...sanitized,
        content: isVideoMessage
          ? '视频任务状态丢失，请联系管理员核查。'
          : (isImageMessage ? '图片生成已中断，请重新发送。' : '回复已中断，请重新发送。'),
        progressPercent: undefined,
        imageGenerationStage: undefined,
        videoGenerationStage: undefined,
        status: 'error',
      };
    });
  }

  function getAiSessions(ownerId) {
    const bucket = readAiSessionBucket(ownerId);
    if (!bucket) {
      return [];
    }
    const recoveredSessions = bucket
      .map((session) => {
        const recoveredSession = {
          ...session,
          messages: Array.isArray(session.messages) ? session.messages : [],
        };
        if (session.pendingTaskId) {
          const task = getAiTask(session.pendingTaskId);
          if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
            delete recoveredSession.pendingTaskId;
            markInterruptedStreamingMessages(recoveredSession);
            recoveredSession.updatedAt = Date.now();
          }
        }

        return recoveredSession;
      });
    const sessions = boundAiSessionBucket(recoveredSessions);

    if (!arePersistedValuesEqual(bucket, sessions)) {
      persistAiSessionBucket(ownerId, sessions);
    }

    return clonePersistedValue(sessions);
  }

  function createAiSession(ownerId, overrides = {}) {
    const owner = resolveAiOwner(ownerId);
    const now = Date.now();
    const session = sanitizeAiSession({
      id: generateEntityId('ai_session'),
      title: '新对话',
      messages: [],
      createdAt: now,
      updatedAt: now,
      ownerId: owner?.ownerId || undefined,
      ownerType: owner?.ownerType || 'user',
      ...overrides,
    });
    return upsertAiSession(ownerId, session);
  }

  function findAiSession(ownerId, sessionId) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      return null;
    }

    const bucket = readAiSessionBucket(ownerId);
    if (!bucket) {
      return null;
    }
    const session = bucket.find(item => String(item.id) === normalizedSessionId) || null;
    return clonePersistedValue(session);
  }

  function upsertAiSession(ownerId, nextSession) {
    const bucket = readAiSessionBucket(ownerId) || [];
    const sanitized = sanitizeAiSession(nextSession);
    const nextBucket = boundAiSessionBucket([
      sanitized,
      ...bucket.filter(session => String(session.id) !== sanitized.id),
    ], sanitized.id);
    const persistedBucket = persistAiSessionBucket(ownerId, nextBucket);
    return clonePersistedValue(
      persistedBucket.find(session => session.id === sanitized.id) || sanitized,
    );
  }

  function appendAiMessage(ownerId, sessionId, messagePatch) {
    const owner = resolveAiOwner(ownerId);
    const now = Date.now();
    const existingSession = findAiSession(ownerId, sessionId);
    const session = existingSession || sanitizeAiSession({
      id: sessionId || generateEntityId('ai_session'),
      title: '新对话',
      messages: [],
      createdAt: now,
      updatedAt: now,
      ownerId: owner?.ownerId || undefined,
      ownerType: owner?.ownerType || 'user',
    });

    const message = sanitizeAiMessage({
      id: generateEntityId('ai_msg'),
      timestamp: now,
      ...messagePatch,
    });

    const nextSession = {
      ...session,
      messages: [...(session.messages || []), message],
      updatedAt: now,
    };

    if (message.role === 'user' && (!nextSession.title || nextSession.title === '新对话') && nextSession.messages.length === 1) {
      const preview = buildAiMessagePreview(message);
      nextSession.title = preview.length > 30 ? `${preview.slice(0, 30)}...` : preview;
    }

    const persistedSession = upsertAiSession(ownerId, nextSession);
    return persistedSession.messages.find(item => item.id === message.id) || message;
  }

  function patchAiMessage(ownerId, sessionId, messageId, patch) {
    const session = findAiSession(ownerId, sessionId);
    if (!session) {
      return null;
    }

    const nextMessages = (session.messages || []).map((message) => (
      String(message.id) === String(messageId)
        ? sanitizeAiMessage({ ...message, ...patch })
        : sanitizeAiMessage(message)
    ));
    const persistedSession = upsertAiSession(ownerId, {
      ...session,
      messages: nextMessages,
      updatedAt: Date.now(),
    });
    return persistedSession.messages.find(message => String(message.id) === String(messageId)) || null;
  }

  function clearAiSessionTask(ownerId, sessionId, expectedTaskId) {
    const session = findAiSession(ownerId, sessionId);
    const normalizedExpectedTaskId = String(expectedTaskId || '').trim();
    if (!session || !normalizedExpectedTaskId || session.pendingTaskId !== normalizedExpectedTaskId) {
      return false;
    }

    const nextSession = { ...session, updatedAt: Date.now() };
    delete nextSession.pendingTaskId;
    upsertAiSession(ownerId, nextSession);
    return true;
  }

  function removeAiSession(ownerId, sessionId) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      return false;
    }

    const bucket = readAiSessionBucket(ownerId);
    if (!bucket) {
      return false;
    }
    const nextSessions = bucket.filter(session => String(session.id) !== normalizedSessionId);
    if (nextSessions.length === bucket.length) {
      return false;
    }

    persistAiSessionBucket(ownerId, nextSessions);
    return true;
  }

  function removeAllAiSessions(ownerId) {
    const ownerKey = getAiOwnerKey(ownerId);
    const existingSessions = Array.isArray(data.aiSessions[ownerKey])
      ? data.aiSessions[ownerKey]
      : [];

    if (existingSessions.length === 0) {
      return 0;
    }
    persistAiSessionBucket(ownerId, []);
    return existingSessions.length;
  }

  return {
    resolveAiOwner,
    ensureAiSessionBucket,
    buildAiMessagePreview,
    sanitizeAiMessage,
    sanitizeAiSession,
    getAiSessions,
    createAiSession,
    findAiSession,
    upsertAiSession,
    appendAiMessage,
    patchAiMessage,
    clearAiSessionTask,
    removeAiSession,
    removeAllAiSessions,
  };
}
