import { describe, expect, it, vi } from 'vitest';
import {
  MAX_AI_FILE_NAME_LENGTH,
  MAX_AI_FILES_PER_MESSAGE,
  MAX_AI_IMAGES_PER_MESSAGE,
  MAX_AI_MEDIA_URL_LENGTH,
  MAX_AI_MESSAGE_CONTENT_LENGTH,
  MAX_AI_MESSAGES_PER_SESSION,
  MAX_AI_SESSIONS_PER_OWNER,
  MAX_GUEST_OWNER_BUCKETS,
  createAiSessionStore,
} from '../../server/aiSessions.js';

function createStoreHarness({ data = { aiSessions: {} }, saveData = vi.fn(), getAiTask = () => null } = {}) {
  let entityId = 0;
  const store = createAiSessionStore({
    data,
    saveData,
    normalizeUserId: value => String(value || '').trim(),
    normalizeGuestId: value => String(value || '').trim(),
    generateEntityId: prefix => `${prefix}-${++entityId}`,
    getAiTask,
  });

  return { data, saveData, store };
}

describe('AI session persistence container validation', () => {
  it('initializes aiSessions only when the property is missing', () => {
    const data = {};
    const { store, saveData } = createStoreHarness({ data });

    expect(data.aiSessions).toEqual({});
    expect(store.getAiSessions({ userId: 'owner-1' })).toEqual([]);
    expect(saveData).not.toHaveBeenCalled();
  });

  it.each([
    ['an array', []],
    ['null', null],
    ['a string', 'corrupt'],
    ['a number', 42],
  ])('rejects %s without replacing the persisted aiSessions value', (_label, invalidValue) => {
    const data = { aiSessions: invalidValue };
    const saveData = vi.fn();

    expect(() => createStoreHarness({ data, saveData }))
      .toThrow('Persisted aiSessions must be an object');
    expect(data.aiSessions).toBe(invalidValue);
    expect(saveData).not.toHaveBeenCalled();
  });
});

describe('legacy raw AI session owner migration', () => {
  function createLegacySession(ownerId, id = 'legacy-session') {
    return {
      id,
      title: 'Legacy history',
      messages: [{
        id: 'legacy-message',
        role: 'user',
        content: 'keep this history',
        timestamp: 1,
        status: 'sent',
      }],
      createdAt: 1,
      updatedAt: 2,
      ownerId,
      ownerType: 'user',
    };
  }

  it('moves a legacy raw bucket into the matching guest namespace', () => {
    const legacyBucket = [createLegacySession('legacy-owner')];
    const data = {
      aiSessions: { 'legacy-owner': legacyBucket },
      authUsers: {},
    };
    const { store, saveData } = createStoreHarness({ data });

    expect(store.getAiSessions({ guestId: 'legacy-owner' })).toEqual([
      expect.objectContaining({
        id: 'legacy-session',
        ownerId: 'legacy-owner',
        ownerType: 'guest',
      }),
    ]);
    expect(data.aiSessions['legacy-owner']).toBeUndefined();
    expect(data.aiSessions['guest:legacy-owner']).toEqual([
      expect.objectContaining({ ownerId: 'legacy-owner', ownerType: 'guest' }),
    ]);
    expect(saveData).toHaveBeenCalledTimes(1);
  });

  it('does not expose a raw bucket whose id belongs to an authenticated account', () => {
    const protectedBucket = [createLegacySession('real-account', 'private-session')];
    const data = {
      aiSessions: { 'real-account': protectedBucket },
      authUsers: {
        'storage-key': { id: 'real-account', phone: '13800138000' },
      },
    };
    const { store, saveData } = createStoreHarness({ data });

    expect(store.getAiSessions({ guestId: 'real-account' })).toEqual([]);
    expect(data.aiSessions['real-account']).toBe(protectedBucket);
    expect(data.aiSessions['guest:real-account']).toBeUndefined();
    expect(saveData).not.toHaveBeenCalled();
  });

  it('restores both bucket keys in place when migration persistence fails', () => {
    const legacyBucket = [createLegacySession('legacy-owner')];
    const data = {
      aiSessions: { 'legacy-owner': legacyBucket },
      authUsers: {},
    };
    const saveError = new Error('disk full');
    const { store } = createStoreHarness({
      data,
      saveData: vi.fn(() => {
        throw saveError;
      }),
    });

    expect(() => store.getAiSessions({ guestId: 'legacy-owner' })).toThrow(saveError);
    expect(data.aiSessions['legacy-owner']).toBe(legacyBucket);
    expect(data.aiSessions['guest:legacy-owner']).toBeUndefined();
  });
});

describe('AI session image metadata', () => {
  it('preserves generated image metadata and real generation stages', () => {
    const { store } = createStoreHarness();

    expect(store.sanitizeAiMessage({
      id: 'message-1',
      role: 'assistant',
      content: '正在保存图片结果...',
      images: ['/uploads/generated.png'],
      imageFileName: 'generated.png',
      imageFileSize: 2_048,
      imageMimeType: 'image/png',
      imageWidth: 1536,
      imageHeight: 1024,
      imageProvider: 'gpt',
      imageGenerationStage: 'persisting',
      timestamp: 10_000,
      status: 'streaming',
    })).toMatchObject({
      imageFileName: 'generated.png',
      imageFileSize: 2_048,
      imageMimeType: 'image/png',
      imageWidth: 1536,
      imageHeight: 1024,
      imageProvider: 'gpt',
      imageGenerationStage: 'persisting',
    });
  });

  it('keeps only bounded safe media references and never persists data URLs', () => {
    const { store } = createStoreHarness();
    const safeImages = Array.from({ length: MAX_AI_IMAGES_PER_MESSAGE + 2 }, (_, index) => (
      `/uploads/image-${index}.png`
    ));
    const safeFiles = Array.from({ length: MAX_AI_FILES_PER_MESSAGE + 2 }, (_, index) => ({
      fileName: index === 0 ? 'a'.repeat(MAX_AI_FILE_NAME_LENGTH + 20) : `file-${index}.txt`,
      fileUrl: `/uploads/file-${index}.txt`,
    }));

    const message = store.sanitizeAiMessage({
      id: 'message-1',
      images: [
        'data:image/png;base64,AA==',
        'https://cdn.example/image.png',
        '/uploads/generated.png',
        '//evil.example/tracker.png',
        '/\\evil.example/tracker.png',
        'ftp://example.com/image.png',
        `https://example.com/${'x'.repeat(MAX_AI_MEDIA_URL_LENGTH)}`,
        ...safeImages,
      ],
      audioUrl: 'data:audio/wav;base64,AA==',
      videoUrl: 'data:video/mp4;base64,AA==',
      files: [
        { fileName: 'secret.txt', fileUrl: 'data:text/plain;base64,AA==' },
        ...safeFiles,
      ],
    });

    expect(message.images).toEqual([
      'https://cdn.example/image.png',
      '/uploads/generated.png',
      ...safeImages.slice(0, MAX_AI_IMAGES_PER_MESSAGE - 2),
    ]);
    expect(message.images).toHaveLength(MAX_AI_IMAGES_PER_MESSAGE);
    expect(message.audioUrl).toBeUndefined();
    expect(message.videoUrl).toBeUndefined();
    expect(message.files).toHaveLength(MAX_AI_FILES_PER_MESSAGE);
    expect(message.files[0]).toMatchObject({
      fileName: 'a'.repeat(MAX_AI_FILE_NAME_LENGTH),
      fileUrl: '/uploads/file-0.txt',
    });
  });

  it('bounds persisted message content and keeps the newest messages', () => {
    const { data, store } = createStoreHarness();
    const messages = Array.from({ length: MAX_AI_MESSAGES_PER_SESSION + 5 }, (_, index) => ({
      id: `message-${index}`,
      role: 'user',
      content: index === MAX_AI_MESSAGES_PER_SESSION + 4
        ? 'x'.repeat(MAX_AI_MESSAGE_CONTENT_LENGTH + 50)
        : `message ${index}`,
      timestamp: index + 1,
    }));

    store.upsertAiSession({ userId: 'owner-1' }, {
      id: 'session-1',
      messages,
      createdAt: 1,
      updatedAt: 2,
      ownerId: 'owner-1',
      ownerType: 'user',
    });

    const persistedMessages = data.aiSessions['owner-1'][0].messages;
    expect(persistedMessages).toHaveLength(MAX_AI_MESSAGES_PER_SESSION);
    expect(persistedMessages[0].id).toBe('message-5');
    expect(persistedMessages.at(-1).content).toHaveLength(MAX_AI_MESSAGE_CONTENT_LENGTH);
  });

  it('keeps a newly created session while pruning an owner to the newest history', () => {
    const future = Date.now() + 60_000;
    const existingSessions = Array.from({ length: MAX_AI_SESSIONS_PER_OWNER }, (_, index) => ({
      id: `existing-${index}`,
      title: `Existing ${index}`,
      messages: [],
      createdAt: future + index,
      updatedAt: future + index,
      ownerId: 'owner-1',
      ownerType: 'user',
    }));
    const data = { aiSessions: { 'owner-1': existingSessions } };
    const { store } = createStoreHarness({ data });

    const created = store.createAiSession({ userId: 'owner-1' });

    expect(data.aiSessions['owner-1']).toHaveLength(MAX_AI_SESSIONS_PER_OWNER);
    expect(data.aiSessions['owner-1'].some(session => session.id === created.id)).toBe(true);
    expect(data.aiSessions['owner-1'].some(session => session.id === 'existing-99')).toBe(true);
    expect(data.aiSessions['owner-1'].some(session => session.id === 'existing-0')).toBe(false);
  });

  it('restores the original owner bucket when a full task-session save fails', () => {
    const originalSession = {
      id: 'session-1',
      title: 'Original',
      messages: [{ id: 'old-message', role: 'user', content: 'old', timestamp: 1, status: 'sent' }],
      createdAt: 1,
      updatedAt: 1,
      ownerId: 'owner-1',
      ownerType: 'user',
    };
    const originalBucket = [originalSession];
    const data = { aiSessions: { 'owner-1': originalBucket } };
    const saveError = new Error('disk full');
    const { store } = createStoreHarness({
      data,
      saveData: vi.fn(() => {
        throw saveError;
      }),
    });

    expect(() => store.upsertAiSession({ userId: 'owner-1' }, {
      ...originalSession,
      messages: [
        ...originalSession.messages,
        { id: 'user-message', role: 'user', content: 'new task', timestamp: 2, status: 'sent' },
        { id: 'assistant-message', role: 'assistant', content: 'pending', timestamp: 3, status: 'streaming' },
      ],
      pendingTaskId: 'task-1',
      updatedAt: 3,
    })).toThrow(saveError);

    expect(data.aiSessions['owner-1']).toBe(originalBucket);
    expect(data.aiSessions['owner-1']).toEqual([originalSession]);
  });

  it('marks an orphaned pending stream as failed when sessions are recovered', () => {
    const data = {
      aiSessions: {
        'owner-1': [{
          id: 'session-1',
          title: 'Video task',
          model: 'video-model',
          pendingTaskId: 'missing-task',
          messages: [{
            id: 'assistant-message',
            role: 'assistant',
            content: '正在提交视频任务...',
            videoGenerationStage: 'submitting',
            timestamp: 1,
            status: 'streaming',
          }],
          createdAt: 1,
          updatedAt: 1,
          ownerId: 'owner-1',
          ownerType: 'user',
        }],
      },
    };
    const saveData = vi.fn();
    const { store } = createStoreHarness({ data, saveData });

    const [recovered] = store.getAiSessions({ userId: 'owner-1' });

    expect(recovered.pendingTaskId).toBeUndefined();
    expect(recovered.messages[0]).toMatchObject({
      content: '视频任务状态丢失，请联系管理员核查。',
      status: 'error',
    });
    expect(recovered.messages[0].videoGenerationStage).toBeUndefined();
    expect(data.aiSessions['owner-1'][0]).toEqual(recovered);
    expect(saveData).toHaveBeenCalledTimes(1);
  });

  it('returns detached sessions so callers cannot mutate persisted state without saving', () => {
    const data = {
      aiSessions: {
        'owner-1': [{
          id: 'session-1',
          title: 'Original',
          messages: [{ id: 'message-1', role: 'user', content: 'original', timestamp: 1 }],
          createdAt: 1,
          updatedAt: 1,
          ownerId: 'owner-1',
          ownerType: 'user',
        }],
      },
    };
    const { store } = createStoreHarness({ data });

    const found = store.findAiSession({ userId: 'owner-1' }, 'session-1');
    found.title = 'Mutated';
    found.messages[0].content = 'mutated';

    expect(data.aiSessions['owner-1'][0]).toMatchObject({
      title: 'Original',
      messages: [expect.objectContaining({ content: 'original' })],
    });
  });

  it('clears a pending task only when the expected task id still owns the session', () => {
    const data = {
      aiSessions: {
        'owner-1': [{
          id: 'session-1',
          title: 'Pending',
          messages: [],
          pendingTaskId: 'new-task',
          createdAt: 1,
          updatedAt: 1,
          ownerId: 'owner-1',
          ownerType: 'user',
        }],
      },
    };
    const saveData = vi.fn();
    const { store } = createStoreHarness({ data, saveData });

    expect(store.clearAiSessionTask({ userId: 'owner-1' }, 'session-1', 'old-task')).toBe(false);
    expect(data.aiSessions['owner-1'][0].pendingTaskId).toBe('new-task');
    expect(saveData).not.toHaveBeenCalled();

    expect(store.clearAiSessionTask({ userId: 'owner-1' }, 'session-1', 'new-task')).toBe(true);
    expect(data.aiSessions['owner-1'][0].pendingTaskId).toBeUndefined();
    expect(saveData).toHaveBeenCalledTimes(1);
  });

  it('does not create storage buckets when an unknown guest only reads history', () => {
    const data = { aiSessions: {} };
    const { store, saveData } = createStoreHarness({ data });

    expect(store.getAiSessions({ guestId: 'unknown-guest' })).toEqual([]);
    expect(store.findAiSession({ guestId: 'unknown-guest' }, 'missing-session')).toBeNull();

    expect(data.aiSessions).toEqual({});
    expect(saveData).not.toHaveBeenCalled();
  });

  it('bounds rotating guest buckets without evicting authenticated history', () => {
    const authenticatedSession = {
      id: 'auth-session',
      title: 'Keep me',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      ownerId: 'auth-user',
      ownerType: 'user',
    };
    const data = { aiSessions: { 'auth-user': [authenticatedSession] } };
    const { store } = createStoreHarness({ data });

    for (let index = 0; index < MAX_GUEST_OWNER_BUCKETS + 5; index += 1) {
      store.createAiSession({ guestId: `rotating-${index}` });
    }

    const guestKeys = Object.keys(data.aiSessions).filter(key => key.startsWith('guest:'));
    expect(guestKeys).toHaveLength(MAX_GUEST_OWNER_BUCKETS);
    expect(data.aiSessions['auth-user']).toEqual([authenticatedSession]);
    expect(data.aiSessions['guest:rotating-0']).toBeUndefined();
    expect(data.aiSessions[`guest:rotating-${MAX_GUEST_OWNER_BUCKETS + 4}`]).toBeDefined();
  });
});
