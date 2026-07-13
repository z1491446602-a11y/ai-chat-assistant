// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerAiTask } from '@/services/api';
import type { MessageStatus, Session } from '@/types';
import { useAiChatSync } from './useAiChatSync';

const apiMocks = vi.hoisted(() => ({
  cancelServerAiTask: vi.fn(),
  fetchServerAiSessions: vi.fn(),
  fetchServerAiTask: vi.fn(),
}));
const refreshAiSessions = vi.fn();

vi.mock('@/services/api', () => apiMocks);

function makeSession(
  pendingTaskId: string | undefined,
  status: MessageStatus,
  mediaType?: 'image' | 'video',
  id = 'session-1',
): Session {
  return {
    id,
    title: 'Session',
    messages: [{
      id: 'message-1',
      role: 'assistant',
      content: 'Done',
      timestamp: 1,
      status,
      ...(mediaType === 'image' ? { imageGenerationStage: 'generating' as const } : {}),
      ...(mediaType === 'video' ? { videoGenerationStage: 'processing' as const } : {}),
    }],
    createdAt: 1,
    updatedAt: 1,
    pendingTaskId,
  };
}

function makeTask(
  id: string,
  status: ServerAiTask['status'] = 'completed',
  type: ServerAiTask['type'] = 'chat',
  sessionId = 'session-1',
): ServerAiTask {
  return {
    id,
    userId: 'guest-test',
    sessionId,
    messageId: 'message-1',
    type,
    status,
    content: 'Done',
    createdAt: 1,
    updatedAt: 2,
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useAiChatSync task lifecycle', () => {
  it('does not settle a media task when the user switches to a session without that task', async () => {
    apiMocks.fetchServerAiTask.mockImplementation(() => new Promise(() => {}));
    const onMediaTaskSettled = vi.fn();
    const callbacks = {
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
    };
    const initialProps = {
      aiOwner: { userId: 'user-test' } as const,
      interactionEnabled: true,
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-image', 'streaming', 'image', 'session-1'),
      refreshAiSessions,
      onMediaTaskSettled,
      ...callbacks,
    };
    const { result, rerender } = renderHook(
      props => useAiChatSync(props),
      { initialProps },
    );
    await flushPromises();

    rerender({
      ...initialProps,
      currentSessionId: 'session-2',
      currentAiSession: makeSession(undefined, 'sent', undefined, 'session-2'),
    });
    await flushPromises();

    expect(onMediaTaskSettled).not.toHaveBeenCalled();
    expect(result.current.currentAiTaskIdRef.current).toBe('task-image');
    expect(result.current.currentAiSessionIdRef.current).toBe('session-1');
  });

  it('uses a new poll generation when returning to the same task and ignores the old in-flight request', async () => {
    const taskResolvers: Array<(task: ServerAiTask) => void> = [];
    apiMocks.fetchServerAiTask.mockImplementation(() => new Promise((resolve) => {
      taskResolvers.push(resolve);
    }));
    refreshAiSessions.mockResolvedValue([
      makeSession(undefined, 'sent', 'image', 'session-1'),
    ]);
    const onMediaTaskSettled = vi.fn();
    const initialProps = {
      aiOwner: { userId: 'user-test' } as const,
      interactionEnabled: true,
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-image', 'streaming', 'image', 'session-1'),
      refreshAiSessions,
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
      onMediaTaskSettled,
    };
    const { rerender } = renderHook(
      props => useAiChatSync(props),
      { initialProps },
    );
    await flushPromises();
    expect(apiMocks.fetchServerAiTask).toHaveBeenCalledTimes(1);

    rerender({
      ...initialProps,
      currentSessionId: 'session-2',
      currentAiSession: makeSession(undefined, 'sent', undefined, 'session-2'),
    });
    rerender(initialProps);
    await flushPromises();
    expect(apiMocks.fetchServerAiTask).toHaveBeenCalledTimes(2);

    await act(async () => {
      taskResolvers[0]?.(makeTask('task-image', 'running', 'image'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(apiMocks.fetchServerAiTask).toHaveBeenCalledTimes(2);
    expect(onMediaTaskSettled).not.toHaveBeenCalled();

    await act(async () => {
      taskResolvers[1]?.(makeTask('task-image', 'completed', 'image'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushPromises();

    expect(onMediaTaskSettled).toHaveBeenCalledTimes(1);
    expect(refreshAiSessions).toHaveBeenCalledTimes(1);
  });

  it('does not start or resume polling while interaction is disabled', async () => {
    apiMocks.fetchServerAiTask.mockImplementation(() => new Promise(() => {}));
    const initialProps = {
      aiOwner: { userId: 'user-test' } as const,
      interactionEnabled: false,
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-image', 'streaming', 'image'),
      refreshAiSessions,
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
    };
    const { rerender } = renderHook(
      props => useAiChatSync(props),
      { initialProps },
    );
    await flushPromises();

    expect(apiMocks.fetchServerAiTask).not.toHaveBeenCalled();

    rerender({ ...initialProps, interactionEnabled: true });
    await flushPromises();
    expect(apiMocks.fetchServerAiTask).toHaveBeenCalledTimes(1);
  });

  it('does not resync with the expired owner after a poll returns 401', async () => {
    const unauthorizedError = Object.assign(new Error('登录已过期'), { status: 401 });
    apiMocks.fetchServerAiTask.mockRejectedValue(unauthorizedError);
    refreshAiSessions.mockResolvedValue([makeSession('task-image', 'streaming', 'image')]);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderHook(() => useAiChatSync({
      aiOwner: { userId: 'expired-user' },
      interactionEnabled: true,
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-image', 'streaming', 'image'),
      refreshAiSessions,
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
    }));
    await flushPromises();
    await flushPromises();

    expect(refreshAiSessions).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiMocks.fetchServerAiTask).toHaveBeenCalledTimes(1);
  });

  it('clears the expired task context when auth becomes disabled before its 401 rejects', async () => {
    let rejectPoll: (error: Error) => void = () => {};
    apiMocks.fetchServerAiTask.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectPoll = reject;
    }));
    const initialProps = {
      aiOwner: { userId: 'expired-user' } as const,
      interactionEnabled: true,
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-image', 'streaming', 'image'),
      refreshAiSessions,
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
    };
    const { result, rerender } = renderHook(
      props => useAiChatSync(props),
      { initialProps },
    );
    await flushPromises();

    rerender({ ...initialProps, interactionEnabled: false });
    await act(async () => {
      rejectPoll(Object.assign(new Error('登录已过期'), { status: 401 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.currentAiTaskIdRef.current).toBeNull();
    expect(result.current.currentAiSessionIdRef.current).toBeNull();
    expect(refreshAiSessions).not.toHaveBeenCalled();
  });

  it('refreshes points immediately and once more after cancelling an image task', async () => {
    apiMocks.fetchServerAiTask.mockImplementation(() => new Promise(() => {}));
    apiMocks.cancelServerAiTask.mockResolvedValue(makeTask('task-image', 'cancelled', 'image'));
    refreshAiSessions.mockResolvedValue([makeSession(undefined, 'sent')]);
    const onMediaTaskSettled = vi.fn();
    const { result } = renderHook(() => useAiChatSync({
      aiOwner: { userId: 'user-test' },
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-image', 'streaming', 'image'),
      refreshAiSessions,
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
      onMediaTaskSettled,
    }));
    await flushPromises();

    act(() => result.current.handleAbortAiResponse());
    await flushPromises();
    await flushPromises();

    expect(apiMocks.cancelServerAiTask).toHaveBeenCalledWith('task-image', { userId: 'user-test' });
    expect(onMediaTaskSettled).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(999);
      await Promise.resolve();
    });
    expect(onMediaTaskSettled).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(onMediaTaskSettled).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(onMediaTaskSettled).toHaveBeenCalledTimes(2);
  });

  it('refreshes points immediately and once more after a normally completed media task', async () => {
    apiMocks.fetchServerAiTask.mockResolvedValue(makeTask('task-image', 'completed', 'image'));
    refreshAiSessions.mockResolvedValue([makeSession(undefined, 'sent', 'image')]);
    const onMediaTaskSettled = vi.fn().mockResolvedValue(true);
    renderHook(() => useAiChatSync({
      aiOwner: { userId: 'user-test' },
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-image', 'streaming', 'image'),
      refreshAiSessions,
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
      onMediaTaskSettled,
    }));
    await flushPromises();

    expect(onMediaTaskSettled).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(999);
      await Promise.resolve();
    });
    expect(onMediaTaskSettled).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(onMediaTaskSettled).toHaveBeenCalledTimes(2);
    expect(onMediaTaskSettled).toHaveBeenNthCalledWith(1);
    expect(onMediaTaskSettled).toHaveBeenNthCalledWith(2, { forceAfterCurrent: true });
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(onMediaTaskSettled).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending delayed points calibration when the hook unmounts', async () => {
    apiMocks.fetchServerAiTask.mockResolvedValue(makeTask('task-image', 'completed', 'image'));
    refreshAiSessions.mockResolvedValue([makeSession(undefined, 'sent', 'image')]);
    const onMediaTaskSettled = vi.fn().mockResolvedValue(true);
    const { unmount } = renderHook(() => useAiChatSync({
      aiOwner: { userId: 'user-test' },
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-image', 'streaming', 'image'),
      refreshAiSessions,
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
      onMediaTaskSettled,
    }));
    await flushPromises();
    expect(onMediaTaskSettled).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });

    expect(onMediaTaskSettled).toHaveBeenCalledTimes(1);
  });

  it('still performs the delayed calibration when the immediate refresh reports failure', async () => {
    apiMocks.fetchServerAiTask.mockResolvedValue(makeTask('task-video', 'failed', 'video'));
    refreshAiSessions.mockResolvedValue([makeSession(undefined, 'sent', 'video')]);
    const onMediaTaskSettled = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    renderHook(() => useAiChatSync({
      aiOwner: { userId: 'user-test' },
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-video', 'streaming', 'video'),
      refreshAiSessions,
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
      onMediaTaskSettled,
    }));
    await flushPromises();

    expect(onMediaTaskSettled).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onMediaTaskSettled).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(onMediaTaskSettled).toHaveBeenCalledTimes(2);
  });

  it('refreshes points when recovery finds that an image task already settled', async () => {
    let rejectPoll: (error: Error) => void = () => {};
    apiMocks.fetchServerAiTask.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectPoll = reject;
    }));
    refreshAiSessions.mockResolvedValue([makeSession(undefined, 'sent')]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onMediaTaskSettled = vi.fn();
    renderHook(() => useAiChatSync({
      aiOwner: { userId: 'user-test' },
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-image', 'streaming', 'image'),
      refreshAiSessions,
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
      onMediaTaskSettled,
    }));
    await flushPromises();

    await act(async () => {
      rejectPoll(new Error('poll disconnected'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushPromises();

    expect(onMediaTaskSettled).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(onMediaTaskSettled).toHaveBeenCalledTimes(2);
  });

  it.each([
    { label: 'image', taskId: 'task-image', mediaType: 'image' as const, settledCalls: 1 },
    { label: 'chat', taskId: 'task-chat', mediaType: undefined, settledCalls: 0 },
  ])('stops a $label task when recovery finds that its tracked session disappeared', async ({
    taskId,
    mediaType,
    settledCalls,
  }) => {
    apiMocks.fetchServerAiTask.mockRejectedValue(
      Object.assign(new Error('task not found'), { status: 404 }),
    );
    refreshAiSessions.mockResolvedValue([
      makeSession(undefined, 'sent', undefined, 'session-2'),
    ]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onMediaTaskSettled = vi.fn();
    const { result } = renderHook(() => useAiChatSync({
      aiOwner: { userId: 'user-test' },
      currentSessionId: 'session-1',
      currentAiSession: makeSession(taskId, 'streaming', mediaType, 'session-1'),
      refreshAiSessions,
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
      onMediaTaskSettled,
    }));
    await flushPromises();
    await flushPromises();

    expect(refreshAiSessions).toHaveBeenCalledWith('session-1', expect.any(Function));
    expect(result.current.currentAiTaskIdRef.current).toBeNull();
    expect(result.current.currentAiSessionIdRef.current).toBeNull();
    expect(result.current.currentAiTaskTypeRef.current).toBeNull();
    expect(onMediaTaskSettled).toHaveBeenCalledTimes(settledCalls);

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiMocks.fetchServerAiTask).toHaveBeenCalledTimes(1);
  });

  it('does not restart a completed task while its session refresh is pending', async () => {
    let resolveSessions: (sessions: Session[]) => void = () => {};
    apiMocks.fetchServerAiTask.mockResolvedValue(makeTask('task-1'));
    refreshAiSessions.mockImplementation(() => new Promise((resolve) => {
      resolveSessions = resolve;
    }));

    const callbacks = {
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
    };
    const initialProps = {
      aiOwner: { guestId: 'guest-test' } as const,
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-1', 'streaming'),
      refreshAiSessions,
      ...callbacks,
    };
    const { rerender } = renderHook(
      props => useAiChatSync(props),
      { initialProps },
    );

    await flushPromises();
    expect(apiMocks.fetchServerAiTask).toHaveBeenCalledTimes(1);
    expect(apiMocks.fetchServerAiTask).toHaveBeenCalledWith(
      'task-1',
      { guestId: 'guest-test' },
    );
    expect(refreshAiSessions).toHaveBeenCalledTimes(1);
    expect(refreshAiSessions).toHaveBeenCalledWith(
      'session-1',
      expect.any(Function),
    );

    rerender({
      ...initialProps,
      currentAiSession: makeSession('task-1', 'sent'),
    });
    await flushPromises();

    expect(apiMocks.fetchServerAiTask).toHaveBeenCalledTimes(1);

    resolveSessions([makeSession(undefined, 'sent')]);
    await flushPromises();
  });

  it('does not poll a terminal task again when its session refresh fails', async () => {
    apiMocks.fetchServerAiTask.mockResolvedValue(makeTask('task-1'));
    refreshAiSessions.mockRejectedValue(new Error('session refresh failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useAiChatSync({
      aiOwner: { userId: 'user-test' },
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-1', 'streaming'),
      refreshAiSessions,
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
    }));
    await flushPromises();
    await flushPromises();

    expect(apiMocks.fetchServerAiTask).toHaveBeenCalledTimes(1);
    expect(apiMocks.fetchServerAiTask).toHaveBeenCalledWith(
      'task-1',
      { userId: 'user-test' },
    );
    expect(result.current.currentAiTaskIdRef.current).toBe('task-1');

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiMocks.fetchServerAiTask).toHaveBeenCalledTimes(1);
  });

  it('does not apply an old terminal session refresh after a new task starts', async () => {
    let resolveSessions: (sessions: Session[]) => void = () => {};
    const taskResolvers = new Map<string, (task: ServerAiTask) => void>();
    apiMocks.fetchServerAiTask.mockImplementation((taskId: string) => {
      if (taskId === 'task-old') {
        return Promise.resolve(makeTask('task-old'));
      }
      return new Promise((resolve) => {
        taskResolvers.set(taskId, resolve);
      });
    });
    refreshAiSessions.mockImplementation(() => new Promise((resolve) => {
      resolveSessions = resolve;
    }));
    const callbacks = {
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
    };
    const { result } = renderHook(() => useAiChatSync({
      aiOwner: { guestId: 'guest-test' },
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-old', 'streaming'),
      refreshAiSessions,
      ...callbacks,
    }));
    await flushPromises();
    expect(refreshAiSessions).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.startServerTaskPolling('task-new', 'session-1');
    });
    await flushPromises();
    await act(async () => {
      taskResolvers.get('task-new')?.(makeTask('task-new', 'running', 'video'));
      await Promise.resolve();
    });
    await act(async () => {
      resolveSessions([makeSession(undefined, 'sent')]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.currentAiTaskIdRef.current).toBe('task-new');
  });

  it('ignores a late terminal response from a superseded task', async () => {
    const taskResolvers = new Map<string, (task: ServerAiTask) => void>();
    apiMocks.fetchServerAiTask.mockImplementation((taskId: string) => new Promise((resolve) => {
      taskResolvers.set(taskId, resolve);
    }));
    refreshAiSessions.mockResolvedValue([makeSession(undefined, 'sent')]);

    const callbacks = {
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
    };
    const { result } = renderHook(() => useAiChatSync({
      aiOwner: { guestId: 'guest-test' },
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-old', 'streaming'),
      refreshAiSessions,
      ...callbacks,
    }));
    await flushPromises();

    act(() => {
      result.current.startServerTaskPolling('task-new', 'session-1');
    });
    await flushPromises();

    await act(async () => {
      taskResolvers.get('task-new')?.(makeTask('task-new', 'running', 'video'));
      await Promise.resolve();
    });
    callbacks.setStreaming.mockClear();
    callbacks.setStreamingMessageId.mockClear();
    refreshAiSessions.mockClear();

    await act(async () => {
      taskResolvers.get('task-old')?.(makeTask('task-old', 'cancelled', 'chat'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.currentAiTaskIdRef.current).toBe('task-new');
    expect(result.current.currentAiTaskTypeRef.current).toBe('video');
    expect(callbacks.setStreaming).not.toHaveBeenCalled();
    expect(callbacks.setStreamingMessageId).not.toHaveBeenCalled();
    expect(refreshAiSessions).not.toHaveBeenCalled();
  });

  it('ignores a late failure from a superseded task', async () => {
    const taskResolvers = new Map<string, (task: ServerAiTask) => void>();
    const taskRejectors = new Map<string, (error: Error) => void>();
    apiMocks.fetchServerAiTask.mockImplementation((taskId: string) => new Promise((resolve, reject) => {
      taskResolvers.set(taskId, resolve);
      taskRejectors.set(taskId, reject);
    }));
    refreshAiSessions.mockResolvedValue([makeSession(undefined, 'sent')]);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const callbacks = {
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
    };
    const { result } = renderHook(() => useAiChatSync({
      aiOwner: { guestId: 'guest-test' },
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-old', 'streaming'),
      refreshAiSessions,
      ...callbacks,
    }));
    await flushPromises();

    act(() => {
      result.current.startServerTaskPolling('task-new', 'session-1');
    });
    await flushPromises();
    await act(async () => {
      taskResolvers.get('task-new')?.(makeTask('task-new', 'running', 'video'));
      await Promise.resolve();
    });
    callbacks.setStreaming.mockClear();
    callbacks.setStreamingMessageId.mockClear();
    refreshAiSessions.mockClear();

    await act(async () => {
      taskRejectors.get('task-old')?.(new Error('old request failed'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.currentAiTaskIdRef.current).toBe('task-new');
    expect(result.current.currentAiTaskTypeRef.current).toBe('video');
    expect(callbacks.setStreaming).not.toHaveBeenCalled();
    expect(callbacks.setStreamingMessageId).not.toHaveBeenCalled();
    expect(refreshAiSessions).not.toHaveBeenCalled();
  });

  it('does not let a completed old cancellation clear a newer task', async () => {
    const taskResolvers = new Map<string, (task: ServerAiTask) => void>();
    apiMocks.fetchServerAiTask.mockImplementation((taskId: string) => new Promise((resolve) => {
      taskResolvers.set(taskId, resolve);
    }));
    let resolveCancel: () => void = () => {};
    apiMocks.cancelServerAiTask.mockImplementation(() => new Promise<void>((resolve) => {
      resolveCancel = resolve;
    }));
    refreshAiSessions.mockResolvedValue([makeSession(undefined, 'sent')]);

    const callbacks = {
      patchMessage: vi.fn(),
      setStreaming: vi.fn(),
      setStreamingMessageId: vi.fn(),
    };
    const { result } = renderHook(() => useAiChatSync({
      aiOwner: { guestId: 'guest-test' },
      currentSessionId: 'session-1',
      currentAiSession: makeSession('task-old', 'streaming'),
      refreshAiSessions,
      ...callbacks,
    }));
    await flushPromises();

    act(() => {
      result.current.handleAbortAiResponse();
      result.current.startServerTaskPolling('task-new', 'session-1');
    });
    await flushPromises();
    await act(async () => {
      taskResolvers.get('task-new')?.(makeTask('task-new', 'running', 'video'));
      await Promise.resolve();
    });
    callbacks.setStreaming.mockClear();
    callbacks.setStreamingMessageId.mockClear();
    refreshAiSessions.mockClear();

    await act(async () => {
      resolveCancel();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.currentAiTaskIdRef.current).toBe('task-new');
    expect(result.current.currentAiTaskTypeRef.current).toBe('video');
    expect(callbacks.setStreaming).not.toHaveBeenCalled();
    expect(callbacks.setStreamingMessageId).not.toHaveBeenCalled();
    expect(refreshAiSessions).not.toHaveBeenCalled();
  });
});
