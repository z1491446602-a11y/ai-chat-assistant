import type { StateStorage } from 'zustand/middleware';
import type { Session } from '@/types';

interface ChatPersistenceSource {
  sessions: Session[];
  currentSessionId: string | null;
}

export interface PersistedChatState {
  sessions: Session[];
  currentSessionId: string | null;
}

export function toPersistedChatState(state: ChatPersistenceSource): PersistedChatState {
  return {
    sessions: state.sessions.map(session => {
      const persistedSession = { ...session };
      delete persistedSession.pendingTaskId;

      const stableMessages = session.messages.filter(message => message.status !== 'streaming');
      if (stableMessages.length !== session.messages.length) {
        persistedSession.messages = stableMessages;
        persistedSession.updatedAt = stableMessages.reduce(
          (latest, message) => Math.max(latest, message.timestamp),
          session.createdAt,
        );
      }

      return persistedSession;
    }),
    currentSessionId: state.currentSessionId,
  };
}

export function createDeduplicatingStateStorage(storage: StateStorage): StateStorage {
  const lastWrittenValues = new Map<string, string>();

  return {
    getItem: name => storage.getItem(name),
    setItem: (name, value) => {
      if (lastWrittenValues.get(name) === value) {
        return;
      }

      lastWrittenValues.set(name, value);
      try {
        return storage.setItem(name, value);
      } catch (error) {
        lastWrittenValues.delete(name);
        throw error;
      }
    },
    removeItem: name => {
      lastWrittenValues.delete(name);
      return storage.removeItem(name);
    },
  };
}
