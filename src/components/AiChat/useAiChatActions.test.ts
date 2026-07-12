// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTaskOwner } from '@/services/api';
import type { Session } from '@/types';
import { useAiChatActions } from './useAiChatActions';

const mocks = vi.hoisted(() => ({
  createServerAiChatTask: vi.fn(),
  createServerAiImageTask: vi.fn(),
  createServerAiSession: vi.fn(),
  createServerAiVideoTask: vi.fn(),
  getSettingsState: vi.fn(() => ({
    apiConfig: {
      apiKey: '',
      model: 'unused',
      temperature: 0.7,
      maxTokens: 2048,
      topP: 1,
    },
  })),
}));

vi.mock('@/services/api', () => ({
  createServerAiChatTask: mocks.createServerAiChatTask,
  createServerAiImageTask: mocks.createServerAiImageTask,
  createServerAiSession: mocks.createServerAiSession,
  createServerAiVideoTask: mocks.createServerAiVideoTask,
}));
vi.mock('@/store', () => ({
  useSettingsStore: { getState: mocks.getSettingsState },
}));

const session: Session = {
  id: 'session-1',
  title: 'Session',
  messages: [],
  createdAt: 1,
  updatedAt: 1,
};

interface RenderActionsOptions {
  currentSessionId?: string | null;
  aiSessions?: Session[];
  input?: string;
  effectiveImageGenerationMode?: boolean;
  isVideoGenerationMode?: boolean;
}

function renderActions(aiOwner: AiTaskOwner, options: RenderActionsOptions = {}) {
  const currentAiTaskIdRef = { current: null as string | null };
  const currentAiSessionIdRef = { current: null as string | null };
  const currentAiTaskTypeRef = { current: null as 'chat' | 'image' | 'video' | null };

  const callbacks = {
    setStreaming: vi.fn(),
    setStreamingMessageId: vi.fn(),
    syncServerAiSessions: vi.fn(),
  };
  const hook = renderHook(() => useAiChatActions({
    aiOwner,
    currentSessionId: options.currentSessionId === undefined
      ? session.id
      : options.currentSessionId,
    aiSessions: options.aiSessions || [session],
    setStreaming: callbacks.setStreaming,
    setStreamingMessageId: callbacks.setStreamingMessageId,
    selectSession: vi.fn(),
    startServerTaskPolling: vi.fn(),
    syncServerAiSessions: callbacks.syncServerAiSessions,
    currentAiTaskIdRef,
    currentAiSessionIdRef,
    currentAiTaskTypeRef,
    input: options.input || '',
    pendingAiImages: [],
    pendingAiFiles: [],
    pendingAiVideoImages: [],
    selectedImageProvider: 'gpt',
    effectiveImageGenerationMode: options.effectiveImageGenerationMode || false,
    isVideoGenerationMode: options.isVideoGenerationMode || false,
    setInput: vi.fn(),
    setPendingAiImages: vi.fn(),
    setPendingAiFiles: vi.fn(),
    setPendingAiVideoImages: vi.fn(),
    setShowMoreActions: vi.fn(),
    setShowImageProviderMenu: vi.fn(),
    setIsImageGenerationMode: vi.fn(),
    setIsVideoGenerationMode: vi.fn(),
  }));
  return { ...hook, callbacks };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createServerAiChatTask.mockResolvedValue({
    task: { id: 'task-1', type: 'chat' },
    sessionId: session.id,
    messageId: 'message-1',
  });
  mocks.createServerAiImageTask.mockResolvedValue({
    task: { id: 'task-image', type: 'image' },
    sessionId: session.id,
    messageId: 'message-image',
  });
  mocks.createServerAiVideoTask.mockResolvedValue({
    task: { id: 'task-video', type: 'video' },
    sessionId: session.id,
    messageId: 'message-video',
  });
  mocks.createServerAiSession.mockResolvedValue(session);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useAiChatActions owner wire contract', () => {
  it('restores streaming state when a quick suggestion task creation fails', async () => {
    mocks.createServerAiChatTask.mockRejectedValueOnce(new Error('task creation failed'));
    const { result, callbacks } = renderActions({ guestId: 'guest-test' });

    await act(async () => {
      await expect(result.current.handleQuickSuggestion('Hello')).rejects.toThrow('task creation failed');
    });

    expect(callbacks.setStreaming).toHaveBeenLastCalledWith(false, null);
    expect(callbacks.setStreamingMessageId).toHaveBeenLastCalledWith(undefined);
    expect(callbacks.syncServerAiSessions).toHaveBeenCalledWith(session.id);
  });

  it.each([
    ['user', { userId: 'user-test' }],
    ['guest', { guestId: 'guest-test' }],
  ] as const)('passes the provided %s owner unchanged to AI task APIs', async (_kind, owner) => {
    const { result } = renderActions(owner);

    await act(async () => {
      await result.current.handleQuickSuggestion('Hello');
    });

    expect(mocks.createServerAiChatTask).toHaveBeenCalledWith(
      owner,
      session.id,
      'Hello',
      [],
      [],
      expect.objectContaining({ model: 'deepseek-v4' }),
    );
  });

  it.each([
    ['user', { userId: 'user-test' }],
    ['guest', { guestId: 'guest-test' }],
  ] as const)('uses the provided %s owner when creating a missing session', async (_kind, owner) => {
    const { result } = renderActions(owner, {
      currentSessionId: null,
      aiSessions: [],
    });

    await act(async () => {
      await result.current.handleQuickSuggestion('Hello');
    });

    expect(mocks.createServerAiSession).toHaveBeenCalledWith(owner, 'deepseek-v4');
    expect(mocks.createServerAiChatTask).toHaveBeenCalledWith(
      owner,
      session.id,
      'Hello',
      [],
      [],
      expect.any(Object),
    );
  });

  it.each([
    ['user image', { userId: 'user-test' }, 'image'],
    ['guest image', { guestId: 'guest-test' }, 'image'],
    ['user video', { userId: 'user-test' }, 'video'],
    ['guest video', { guestId: 'guest-test' }, 'video'],
  ] as const)('passes the same owner to the %s task API', async (_kind, owner, taskType) => {
    const { result } = renderActions(owner, {
      input: 'Generate media',
      effectiveImageGenerationMode: taskType === 'image',
      isVideoGenerationMode: taskType === 'video',
    });

    await act(async () => {
      await result.current.handleSendAiMessage();
    });

    if (taskType === 'image') {
      expect(mocks.createServerAiImageTask).toHaveBeenCalledWith(
        owner,
        session.id,
        'Generate media',
        [],
        'gpt',
      );
    } else {
      expect(mocks.createServerAiVideoTask).toHaveBeenCalledWith(
        owner,
        session.id,
        'Generate media',
        [],
      );
    }
  });
});
