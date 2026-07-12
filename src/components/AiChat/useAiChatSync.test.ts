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

function makeSession(pendingTaskId: string | undefined, status: MessageStatus): Session {
  return {
    id: 'session-1',
    title: 'Session',
    messages: [{
      id: 'message-1',
      role: 'assistant',
      content: 'Done',
      timestamp: 1,
      status,
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
): ServerAiTask {
  return {
    id,
    userId: 'guest-test',
    sessionId: 'session-1',
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
