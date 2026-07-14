// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTaskOwner } from '@/services/api';
import type { Session } from '@/types';
import { useAiChatActions } from './useAiChatActions';

const mocks = vi.hoisted(() => ({
  createClientRequestId: vi.fn(),
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
  createClientRequestId: mocks.createClientRequestId,
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
  enabled?: boolean;
  videoInputs?: { image: string; lastFrame: string; referenceImages: string[] };
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
    enabled: options.enabled ?? true,
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
    pendingAiVideoInputs: options.videoInputs || { image: '', lastFrame: '', referenceImages: [] },
    selectedImageProvider: 'gpt',
    effectiveImageGenerationMode: options.effectiveImageGenerationMode || false,
    isVideoGenerationMode: options.isVideoGenerationMode || false,
    setInput: vi.fn(),
    setPendingAiImages: vi.fn(),
    setPendingAiFiles: vi.fn(),
    setPendingAiVideoInputs: vi.fn(),
    setShowMoreActions: vi.fn(),
    setShowImageProviderMenu: vi.fn(),
    setIsImageGenerationMode: vi.fn(),
    setIsVideoGenerationMode: vi.fn(),
  }));
  return { ...hook, callbacks };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClientRequestId.mockReturnValue('request-default');
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
  it('does not create a session or task while authentication is unresolved', async () => {
    const { result } = renderActions({ guestId: 'guest-test' }, {
      currentSessionId: null,
      aiSessions: [],
      input: 'Do not send yet',
      enabled: false,
    });

    await act(async () => {
      await result.current.handleSendAiMessage();
      await result.current.handleQuickSuggestion('Do not send this either');
    });

    expect(mocks.createServerAiSession).not.toHaveBeenCalled();
    expect(mocks.createServerAiChatTask).not.toHaveBeenCalled();
    expect(mocks.createServerAiImageTask).not.toHaveBeenCalled();
    expect(mocks.createServerAiVideoTask).not.toHaveBeenCalled();
  });

  it('handles a fire-and-forget quick suggestion failure without an unhandled rejection', async () => {
    mocks.createServerAiChatTask.mockRejectedValueOnce(new Error('task creation failed'));
    const { result, callbacks } = renderActions({ guestId: 'guest-test' });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      await expect(result.current.handleQuickSuggestion('Hello')).resolves.toBeUndefined();
    });

    expect(alertSpy).toHaveBeenCalledWith('发送快捷问题失败，请稍后重试');
    expect(callbacks.setStreaming).toHaveBeenLastCalledWith(false, null);
    expect(callbacks.setStreamingMessageId).toHaveBeenLastCalledWith(undefined);
    expect(callbacks.syncServerAiSessions).toHaveBeenCalledWith(session.id);
  });

  it('keeps a quick-suggestion 401 on the shared session-expiry path', async () => {
    mocks.createServerAiChatTask.mockRejectedValueOnce(
      Object.assign(new Error('登录已过期'), { status: 401 }),
    );
    const { result, callbacks } = renderActions({ userId: 'expired-user' });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      await expect(result.current.handleQuickSuggestion('Hello')).resolves.toBeUndefined();
    });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(callbacks.setStreaming).toHaveBeenLastCalledWith(false, null);
    expect(callbacks.syncServerAiSessions).not.toHaveBeenCalled();
  });

  it('submits a typed ordinary chat message for a resolved guest', async () => {
    const { result } = renderActions({ guestId: 'guest-test' }, {
      input: 'Typed guest message',
    });

    await act(async () => {
      await result.current.handleSendAiMessage();
    });

    expect(mocks.createServerAiChatTask).toHaveBeenCalledWith(
      { guestId: 'guest-test' },
      session.id,
      'Typed guest message',
      [],
      [],
      expect.objectContaining({ model: 'deepseek-v4' }),
    );
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
        'request-default',
      );
    } else {
      expect(mocks.createServerAiVideoTask).toHaveBeenCalledWith(
        owner,
        session.id,
        'Generate media',
        { image: '', lastFrame: '', referenceImages: [] },
        'request-default',
      );
    }
  });

  it.each([
    ['image', true, false, mocks.createServerAiImageTask],
    ['video', false, true, mocks.createServerAiVideoTask],
  ] as const)('creates a new requestId for every ordinary $name action', async (
    _taskType,
    effectiveImageGenerationMode,
    isVideoGenerationMode,
    taskApi,
  ) => {
    mocks.createClientRequestId
      .mockReturnValueOnce('request-action-1')
      .mockReturnValueOnce('request-action-2');
    const { result } = renderActions({ userId: 'user-test' }, {
      input: 'Generate media',
      effectiveImageGenerationMode,
      isVideoGenerationMode,
    });

    await act(async () => {
      await result.current.handleSendAiMessage();
      await result.current.handleSendAiMessage();
    });

    expect(mocks.createClientRequestId).toHaveBeenCalledTimes(2);
    expect(taskApi).toHaveBeenCalledTimes(2);
    const firstCall = taskApi.mock.calls[0] || [];
    const secondCall = taskApi.mock.calls[1] || [];
    expect(firstCall[firstCall.length - 1]).toBe('request-action-1');
    expect(secondCall[secondCall.length - 1]).toBe('request-action-2');
  });

  it('does not allocate a paid-media requestId for ordinary chat', async () => {
    const { result } = renderActions({ guestId: 'guest-test' }, {
      input: 'Ordinary chat',
    });

    await act(async () => {
      await result.current.handleSendAiMessage();
    });

    expect(mocks.createClientRequestId).not.toHaveBeenCalled();
  });
});
