export function createAiSessionStore({
  data,
  saveData,
  normalizeUserId,
  normalizeGuestId,
  generateEntityId,
  getAiTask,
}) {
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

  function ensureAiSessionBucket(ownerRef) {
    const owner = resolveAiOwner(ownerRef);
    const ownerKey = owner?.ownerKey || 'guest';
    if (!data.aiSessions[ownerKey]) {
      data.aiSessions[ownerKey] = [];
    }
    return data.aiSessions[ownerKey];
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
    return {
      id: String(message.id || ''),
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content || ''),
      images: Array.isArray(message.images) ? message.images.filter(item => typeof item === 'string' && item.trim()) : undefined,
      audioUrl: typeof message.audioUrl === 'string' && message.audioUrl.trim() ? message.audioUrl.trim() : undefined,
      duration: Number(message.duration) > 0 ? Number(message.duration) : undefined,
      audioMimeType: typeof message.audioMimeType === 'string' && message.audioMimeType.trim() ? message.audioMimeType.trim() : undefined,
      progressPercent: Number.isFinite(Number(message.progressPercent)) ? Number(message.progressPercent) : undefined,
      imageFileName: typeof message.imageFileName === 'string' && message.imageFileName.trim() ? message.imageFileName.trim() : undefined,
      imageFileSize: Number(message.imageFileSize) > 0 ? Number(message.imageFileSize) : undefined,
      imageMimeType: typeof message.imageMimeType === 'string' && message.imageMimeType.trim() ? message.imageMimeType.trim() : undefined,
      imageWidth: Number(message.imageWidth) > 0 ? Number(message.imageWidth) : undefined,
      imageHeight: Number(message.imageHeight) > 0 ? Number(message.imageHeight) : undefined,
      imageProvider: ['gpt', 'grok'].includes(message.imageProvider) ? message.imageProvider : undefined,
      imageGenerationStage: ['submitting', 'generating', 'receiving', 'persisting'].includes(message.imageGenerationStage)
        ? message.imageGenerationStage
        : undefined,
      videoUrl: typeof message.videoUrl === 'string' && message.videoUrl.trim() ? message.videoUrl.trim() : undefined,
      videoMimeType: typeof message.videoMimeType === 'string' && message.videoMimeType.trim() ? message.videoMimeType.trim() : undefined,
      videoFileName: typeof message.videoFileName === 'string' && message.videoFileName.trim() ? message.videoFileName.trim() : undefined,
      videoFileSize: Number(message.videoFileSize) > 0 ? Number(message.videoFileSize) : undefined,
      videoDuration: Number(message.videoDuration) > 0 ? Number(message.videoDuration) : undefined,
      videoWidth: Number(message.videoWidth) > 0 ? Number(message.videoWidth) : undefined,
      videoHeight: Number(message.videoHeight) > 0 ? Number(message.videoHeight) : undefined,
      videoGenerationStage: ['submitting', 'queued', 'processing', 'downloading', 'validating'].includes(message.videoGenerationStage)
        ? message.videoGenerationStage
        : undefined,
      files: Array.isArray(message.files) ? message.files
        .filter(file => file?.fileName && file?.fileUrl)
        .map(file => ({
          fileName: String(file.fileName),
          fileUrl: String(file.fileUrl),
          fileSize: file.fileSize ? Number(file.fileSize) : undefined,
          mimeType: file.mimeType ? String(file.mimeType) : undefined,
        })) : undefined,
      timestamp: Number(message.timestamp) || Date.now(),
      status: typeof message.status === 'string' ? message.status : 'sent',
    };
  }

  function sanitizeAiSession(session) {
    const ownerType = session.ownerType === 'guest' ? 'guest' : 'user';
    return {
      id: String(session.id || ''),
      title: String(session.title || '新对话'),
      messages: Array.isArray(session.messages) ? session.messages.map(sanitizeAiMessage) : [],
      createdAt: Number(session.createdAt) || Date.now(),
      updatedAt: Number(session.updatedAt) || Date.now(),
      ownerId: ownerType === 'guest'
        ? (normalizeGuestId(session.ownerId) || undefined)
        : (session.ownerId ? normalizeUserId(session.ownerId) : undefined),
      ownerType,
      model: session.model ? String(session.model) : undefined,
      pendingTaskId: session.pendingTaskId ? String(session.pendingTaskId) : undefined,
    };
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
    let changed = false;
    const sessions = ensureAiSessionBucket(ownerId)
      .map((session) => {
        if (session.pendingTaskId) {
          const task = getAiTask(session.pendingTaskId);
          if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
            delete session.pendingTaskId;
            markInterruptedStreamingMessages(session);
            session.updatedAt = Date.now();
            changed = true;
          }
        }

        return sanitizeAiSession(session);
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);

    if (changed) {
      saveData(data);
    }

    return sessions;
  }

  function createAiSession(ownerId, overrides = {}) {
    const bucket = ensureAiSessionBucket(ownerId);
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
    bucket.unshift(session);
    saveData(data);
    return session;
  }

  function findAiSession(ownerId, sessionId) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      return null;
    }

    const bucket = ensureAiSessionBucket(ownerId);
    return bucket.find(session => String(session.id) === normalizedSessionId) || null;
  }

  function upsertAiSession(ownerId, nextSession) {
    const bucket = ensureAiSessionBucket(ownerId);
    const index = bucket.findIndex(session => String(session.id) === String(nextSession.id));
    const sanitized = sanitizeAiSession(nextSession);
    if (index === -1) {
      bucket.unshift(sanitized);
    } else {
      bucket[index] = sanitized;
    }
    saveData(data);
    return sanitized;
  }

  function appendAiMessage(ownerId, sessionId, messagePatch) {
    let session = findAiSession(ownerId, sessionId);
    if (!session) {
      session = createAiSession(ownerId, { id: sessionId || generateEntityId('ai_session') });
    }

    const message = sanitizeAiMessage({
      id: generateEntityId('ai_msg'),
      timestamp: Date.now(),
      ...messagePatch,
    });

    session.messages = [...(session.messages || []), message];
    session.updatedAt = Date.now();

    if (message.role === 'user' && (!session.title || session.title === '新对话') && session.messages.length === 1) {
      const preview = buildAiMessagePreview(message);
      session.title = preview.length > 30 ? `${preview.slice(0, 30)}...` : preview;
    }

    upsertAiSession(ownerId, session);
    return message;
  }

  function patchAiMessage(ownerId, sessionId, messageId, patch) {
    const session = findAiSession(ownerId, sessionId);
    if (!session) {
      return null;
    }

    session.messages = (session.messages || []).map((message) => (
      String(message.id) === String(messageId)
        ? sanitizeAiMessage({ ...message, ...patch })
        : sanitizeAiMessage(message)
    ));
    session.updatedAt = Date.now();
    upsertAiSession(ownerId, session);
    return session.messages.find(message => String(message.id) === String(messageId)) || null;
  }

  function clearAiSessionTask(ownerId, sessionId) {
    const session = findAiSession(ownerId, sessionId);
    if (!session) {
      return;
    }

    delete session.pendingTaskId;
    session.updatedAt = Date.now();
    upsertAiSession(ownerId, session);
  }

  function removeAiSession(ownerId, sessionId) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      return false;
    }

    const bucket = ensureAiSessionBucket(ownerId);
    const nextSessions = bucket.filter(session => String(session.id) !== normalizedSessionId);
    const owner = resolveAiOwner(ownerId);
    const ownerKey = owner?.ownerKey || 'guest';

    if (nextSessions.length === bucket.length) {
      return false;
    }

    data.aiSessions[ownerKey] = nextSessions;
    saveData(data);
    return true;
  }

  function removeAllAiSessions(ownerId) {
    const owner = resolveAiOwner(ownerId);
    const ownerKey = owner?.ownerKey || 'guest';
    const existingSessions = Array.isArray(data.aiSessions[ownerKey])
      ? data.aiSessions[ownerKey]
      : [];

    if (existingSessions.length === 0) {
      return 0;
    }

    data.aiSessions[ownerKey] = [];
    saveData(data);
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
