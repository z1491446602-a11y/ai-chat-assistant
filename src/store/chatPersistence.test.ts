import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@/types';
import {
  createDeduplicatingStateStorage,
  toPersistedChatState,
} from './chatPersistence';

describe('toPersistedChatState', () => {
  it('removes transient task state and serializes identical data as streaming content changes', () => {
    const first = toPersistedChatState({
      sessions: [createSession({
        updatedAt: 900,
        pendingTaskId: 'task-1',
        messages: [
          { id: 'user-1', role: 'user', content: 'Hello', timestamp: 110, status: 'sent' },
          { id: 'assistant-1', role: 'assistant', content: 'Par', timestamp: 120, status: 'streaming' },
        ],
      })],
      currentSessionId: 'session-1',
    });
    const second = toPersistedChatState({
      sessions: [createSession({
        updatedAt: 1_200,
        pendingTaskId: 'task-1',
        messages: [
          { id: 'user-1', role: 'user', content: 'Hello', timestamp: 110, status: 'sent' },
          { id: 'assistant-1', role: 'assistant', content: 'Partial response changed', timestamp: 120, status: 'streaming' },
        ],
      })],
      currentSessionId: 'session-1',
    });

    expect(first.sessions[0].messages).toHaveLength(1);
    expect(first.sessions[0].messages[0].id).toBe('user-1');
    expect(first.sessions[0].updatedAt).toBe(110);
    expect(first.sessions[0]).not.toHaveProperty('pendingTaskId');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('persists a final assistant message once streaming completes', () => {
    const persisted = toPersistedChatState({
      sessions: [createSession({
        updatedAt: 130,
        pendingTaskId: 'stale-task',
        messages: [
          { id: 'user-1', role: 'user', content: 'Hello', timestamp: 110, status: 'sent' },
          { id: 'assistant-1', role: 'assistant', content: 'Final response', timestamp: 120, status: 'sent' },
        ],
      })],
      currentSessionId: 'session-1',
    });

    expect(persisted.sessions[0].messages).toHaveLength(2);
    expect(persisted.sessions[0].messages[1].content).toBe('Final response');
    expect(persisted.sessions[0]).not.toHaveProperty('pendingTaskId');
  });

  it('bounds cached history and removes embedded media payloads', () => {
    const sessions = Array.from({ length: 25 }, (_, sessionIndex) => createSession({
      id: `session-${sessionIndex}`,
      messages: Array.from({ length: 60 }, (_, messageIndex) => ({
        id: `message-${sessionIndex}-${messageIndex}`,
        role: 'assistant' as const,
        content: 'cached',
        timestamp: messageIndex,
        status: 'sent' as const,
        images: [
          'data:image/png;base64,large-payload',
          '/uploads/generated.png',
        ],
        audioUrl: 'data:audio/wav;base64,large-audio',
        videoUrl: 'data:video/mp4;base64,large-video',
        files: [
          { fileName: 'embedded.txt', fileUrl: 'data:text/plain;base64,large-file' },
          { fileName: 'server.txt', fileUrl: '/uploads/server.txt' },
        ],
      })),
    }));

    const persisted = toPersistedChatState({ sessions, currentSessionId: 'session-0' });

    expect(persisted.sessions).toHaveLength(20);
    expect(persisted.sessions[0].messages).toHaveLength(50);
    expect(persisted.sessions[0].messages[0].id).toBe('message-0-10');
    expect(persisted.sessions[0].messages[0].images).toEqual(['/uploads/generated.png']);
    expect(persisted.sessions[0].messages[0].audioUrl).toBeUndefined();
    expect(persisted.sessions[0].messages[0].videoUrl).toBeUndefined();
    expect(persisted.sessions[0].messages[0].files).toEqual([
      { fileName: 'server.txt', fileUrl: '/uploads/server.txt' },
    ]);
  });

  it('retains the selected session when it falls outside the bounded history window', () => {
    const sessions = Array.from({ length: 25 }, (_, index) => createSession({
      id: `session-${index}`,
      updatedAt: 100 - index,
    }));

    const persisted = toPersistedChatState({
      sessions,
      currentSessionId: 'session-24',
    });

    expect(persisted.sessions).toHaveLength(20);
    expect(persisted.sessions.map(session => session.id)).toContain('session-24');
    expect(persisted.currentSessionId).toBe('session-24');
  });
});

describe('createDeduplicatingStateStorage', () => {
  it('skips repeated serialized writes while forwarding changed values and removals', () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    const storage = createDeduplicatingStateStorage({
      getItem: vi.fn(() => null),
      setItem,
      removeItem,
    });

    storage.setItem('chat', '{"version":1}');
    storage.setItem('chat', '{"version":1}');
    storage.setItem('chat', '{"version":2}');
    storage.removeItem('chat');
    storage.setItem('chat', '{"version":2}');

    expect(setItem.mock.calls).toEqual([
      ['chat', '{"version":1}'],
      ['chat', '{"version":2}'],
      ['chat', '{"version":2}'],
    ]);
    expect(removeItem).toHaveBeenCalledWith('chat');
  });

  it('drops an overflowing local cache without breaking chat state updates', () => {
    const quotaError = new DOMException('Storage full', 'QuotaExceededError');
    const removeItem = vi.fn();
    const storage = createDeduplicatingStateStorage({
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw quotaError; }),
      removeItem,
    });

    expect(() => storage.setItem('chat', 'large-value')).not.toThrow();
    expect(removeItem).toHaveBeenCalledWith('chat');
  });
});

describe('chatStore persistence integration', () => {
  it('uses explicit JSON storage and the stable persisted-state projection', async () => {
    const { useChatStore } = await import('./chatStore');
    const options = useChatStore.persist.getOptions();
    const state = {
      ...useChatStore.getState(),
      sessions: [createSession({
        updatedAt: 500,
        pendingTaskId: 'task-1',
        messages: [
          { id: 'assistant-1', role: 'assistant' as const, content: 'partial', timestamp: 120, status: 'streaming' as const },
        ],
      })],
      currentSessionId: 'session-1',
    };

    expect(options.storage).toBeTruthy();
    const persisted = options.partialize?.(state) as ReturnType<typeof toPersistedChatState>;
    expect(persisted.sessions[0].messages).toHaveLength(0);
    expect(persisted.sessions[0]).not.toHaveProperty('pendingTaskId');
  });
});

function createSession(patch: Partial<Session>): Session {
  return {
    id: 'session-1',
    title: 'Session',
    messages: [],
    createdAt: 100,
    updatedAt: 100,
    ...patch,
  };
}
// @vitest-environment jsdom
