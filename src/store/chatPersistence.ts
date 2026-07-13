import type { StateStorage } from 'zustand/middleware';
import type { Message, Session } from '@/types';

const MAX_CACHED_SESSIONS = 20;
const MAX_CACHED_MESSAGES_PER_SESSION = 50;

function isEmbeddedData(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:');
}

function toCacheSafeMessage(message: Message): Message {
  const cachedMessage = { ...message };
  if (Array.isArray(message.images)) {
    const images = message.images.filter(image => !isEmbeddedData(image));
    cachedMessage.images = images.length ? images : undefined;
  }
  if (isEmbeddedData(message.audioUrl)) {
    cachedMessage.audioUrl = undefined;
  }
  if (isEmbeddedData(message.videoUrl)) {
    cachedMessage.videoUrl = undefined;
  }
  if (Array.isArray(message.files)) {
    const files = message.files.filter(file => !isEmbeddedData(file.fileUrl));
    cachedMessage.files = files.length ? files : undefined;
  }
  return cachedMessage;
}

interface ChatPersistenceSource {
  sessions: Session[];
  currentSessionId: string | null;
}

export interface PersistedChatState {
  sessions: Session[];
  currentSessionId: string | null;
}

export function toPersistedChatState(state: ChatPersistenceSource): PersistedChatState {
  const boundedSessions = state.sessions.slice(0, MAX_CACHED_SESSIONS);
  if (
    state.currentSessionId
    && !boundedSessions.some(session => session.id === state.currentSessionId)
  ) {
    const currentSession = state.sessions.find(session => session.id === state.currentSessionId);
    if (currentSession && boundedSessions.length === MAX_CACHED_SESSIONS) {
      boundedSessions[boundedSessions.length - 1] = currentSession;
    }
  }

  return {
    sessions: boundedSessions.map(session => {
      const persistedSession = { ...session };
      delete persistedSession.pendingTaskId;

      const stableMessages = session.messages.filter(message => message.status !== 'streaming');
      persistedSession.messages = stableMessages
        .slice(-MAX_CACHED_MESSAGES_PER_SESSION)
        .map(toCacheSafeMessage);
      if (stableMessages.length !== session.messages.length) {
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
        const errorName = error && typeof error === 'object' && 'name' in error
          ? String(error.name)
          : '';
        if (errorName === 'QuotaExceededError' || errorName === 'NS_ERROR_DOM_QUOTA_REACHED') {
          try {
            storage.removeItem(name);
          } catch {
            // The server remains authoritative when browser storage is unavailable.
          }
          return;
        }
        throw error;
      }
    },
    removeItem: name => {
      lastWrittenValues.delete(name);
      return storage.removeItem(name);
    },
  };
}
