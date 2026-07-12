import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Session, Message } from '@/types';
import { createDeduplicatingStateStorage, toPersistedChatState } from './chatPersistence';

const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

function getMessageSummary(message: Omit<Message, 'id' | 'timestamp'>): string {
  const text = message.content.trim();
  if (text) {
    return text;
  }

  if (message.images?.length) {
    return '[图片]';
  }

  if (message.files?.length) {
    return `[文件] ${message.files[0].fileName}`;
  }

  return '新对话';
}

const createDefaultSession = (ownerId?: string): Session => ({
  id: generateId(),
  title: '新对话',
  messages: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ownerId,
});

interface ChatState {
  sessions: Session[];
  currentSessionId: string | null;
  isStreaming: boolean;
  abortController: AbortController | null;
  streamingMessageId: string | undefined;

  getCurrentSession: () => Session | null;
  setSessions: (sessions: Session[], currentSessionId?: string | null) => void;
  resetSessions: () => void;
  createSession: (ownerId?: string) => void;
  deleteSession: (id: string) => void;
  selectSession: (id: string) => void;
  updateSessionTitle: (id: string, title: string) => void;
  addMessage: (sessionId: string, message: Omit<Message, 'id' | 'timestamp'>) => Message;
  updateMessage: (sessionId: string, messageId: string, content: string, status?: Message['status']) => void;
  patchMessage: (sessionId: string, messageId: string, patch: Partial<Message>) => void;
  clearMessages: (sessionId: string) => void;
  setStreaming: (streaming: boolean, controller?: AbortController | null) => void;
  setStreamingMessageId: (id: string | undefined) => void;
  abortStream: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,
      isStreaming: false,
      abortController: null,
      streamingMessageId: undefined,

      getCurrentSession: () => {
        const { sessions, currentSessionId } = get();
        return sessions.find(session => session.id === currentSessionId) || null;
      },

      setSessions: (sessions, nextCurrentSessionId) => {
        const normalizedSessions = Array.isArray(sessions) ? sessions : [];
        const resolvedCurrentSessionId = nextCurrentSessionId !== undefined
          ? nextCurrentSessionId
          : (normalizedSessions[0]?.id || null);

        set({
          sessions: normalizedSessions,
          currentSessionId: resolvedCurrentSessionId,
        });
      },

      resetSessions: () => {
        set({
          sessions: [],
          currentSessionId: null,
          isStreaming: false,
          abortController: null,
          streamingMessageId: undefined,
        });
      },

      createSession: (ownerId) => {
        const newSession = createDefaultSession(ownerId);
        set(state => ({
          sessions: [newSession, ...state.sessions],
          currentSessionId: newSession.id,
        }));
      },

      deleteSession: (id) => {
        set(state => {
          const newSessions = state.sessions.filter(session => session.id !== id);
          const newCurrentId = state.currentSessionId === id
            ? (newSessions[0]?.id || null)
            : state.currentSessionId;

          return {
            sessions: newSessions,
            currentSessionId: newCurrentId,
          };
        });
      },

      selectSession: (id) => {
        set({ currentSessionId: id });
      },

      updateSessionTitle: (id, title) => {
        set(state => ({
          sessions: state.sessions.map(session =>
            session.id === id ? { ...session, title, updatedAt: Date.now() } : session,
          ),
        }));
      },

      addMessage: (sessionId, message) => {
        const newMessage: Message = {
          ...message,
          id: generateId(),
          timestamp: Date.now(),
        };

        set(state => ({
          sessions: state.sessions.map(session =>
            session.id === sessionId
              ? {
                  ...session,
                  messages: [...session.messages, newMessage],
                  updatedAt: Date.now(),
                  title: session.messages.length === 0 && message.role === 'user'
                    ? (() => {
                        const summary = getMessageSummary(message);
                        return summary.slice(0, 30) + (summary.length > 30 ? '...' : '');
                      })()
                    : session.title,
                }
              : session,
          ),
        }));

        return newMessage;
      },

      updateMessage: (sessionId, messageId, content, status) => {
        set(state => ({
          sessions: state.sessions.map(session =>
            session.id === sessionId
              ? {
                  ...session,
                  messages: session.messages.map(message =>
                    message.id === messageId
                      ? { ...message, content, ...(status && { status }) }
                      : message,
                  ),
                  updatedAt: Date.now(),
                }
              : session,
          ),
        }));
      },

      patchMessage: (sessionId, messageId, patch) => {
        set(state => ({
          sessions: state.sessions.map(session =>
            session.id === sessionId
              ? {
                  ...session,
                  messages: session.messages.map(message =>
                    message.id === messageId
                      ? { ...message, ...patch }
                      : message,
                  ),
                  updatedAt: Date.now(),
                }
              : session,
          ),
        }));
      },

      clearMessages: (sessionId) => {
        set(state => ({
          sessions: state.sessions.map(session =>
            session.id === sessionId
              ? { ...session, messages: [], updatedAt: Date.now(), title: '新对话' }
              : session,
          ),
        }));
      },

      setStreaming: (streaming, controller) => {
        set({ isStreaming: streaming, abortController: controller || null });
      },

      setStreamingMessageId: (id) => {
        set({ streamingMessageId: id });
      },

      abortStream: () => {
        const { abortController } = get();
        abortController?.abort();
        set({ isStreaming: false, abortController: null, streamingMessageId: undefined });
      },
    }),
    {
      name: 'chat-sessions-v3',
      storage: createJSONStorage(() => createDeduplicatingStateStorage(localStorage)),
      partialize: state => toPersistedChatState(state),
    },
  ),
);
