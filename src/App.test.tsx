// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTaskOwner } from '@/services/api';
import type { Session } from '@/types';
import { App } from './App';

const mocks = vi.hoisted(() => {
  const chatState: {
    sessions: Session[];
    currentSessionId: string | null;
    isStreaming: boolean;
    selectSession: ReturnType<typeof vi.fn>;
    setSessions: ReturnType<typeof vi.fn>;
    resetSessions: ReturnType<typeof vi.fn>;
  } = {
    sessions: [],
    currentSessionId: null,
    isStreaming: false,
    selectSession: vi.fn(),
    setSessions: vi.fn(),
    resetSessions: vi.fn(),
  };

  return {
    chatState,
    useChatStore: Object.assign(
      vi.fn((selector?: (state: typeof chatState) => unknown) =>
        selector ? selector(chatState) : chatState,
      ),
      { getState: () => chatState },
    ),
    getAiOwner: vi.fn<() => AiTaskOwner>(() => ({ userId: 'owner-test' })),
    aiChatProps: vi.fn(),
    fetchServerAiSessions: vi.fn(),
    createServerAiSession: vi.fn(),
    deleteServerAiSession: vi.fn(),
    clearServerAiSessions: vi.fn(),
  };
});

vi.mock('@/store', () => ({ useChatStore: mocks.useChatStore }));
vi.mock('@/utils/aiOwner', () => ({ getAiOwner: mocks.getAiOwner }));
vi.mock('@/services/api', () => ({
  fetchServerAiSessions: mocks.fetchServerAiSessions,
  createServerAiSession: mocks.createServerAiSession,
  deleteServerAiSession: mocks.deleteServerAiSession,
  clearServerAiSessions: mocks.clearServerAiSessions,
}));
vi.mock('@/components/AiChat/AiChat', () => ({
  AiChat: (props: unknown) => {
    mocks.aiChatProps(props);
    return <div data-testid="ai-chat" />;
  },
}));

let visibilityState: DocumentVisibilityState;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  visibilityState = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState);
  mocks.chatState.sessions = [];
  mocks.chatState.currentSessionId = null;
  mocks.chatState.isStreaming = false;
  mocks.getAiOwner.mockReturnValue({ userId: 'owner-test' });
  mocks.fetchServerAiSessions.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advanceTime(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    await Promise.resolve();
  });
}

describe('App session synchronization', () => {
  it('loads the AI surface through a lazy boundary and passes the single owner', async () => {
    vi.useRealTimers();
    const view = render(<App />);

    expect(view.getByTestId('ai-surface-loading')).toBeTruthy();
    expect(await view.findByTestId('ai-chat', {}, { timeout: 3_000 })).toBeTruthy();
    expect(mocks.aiChatProps).toHaveBeenCalledWith(
      expect.objectContaining({ aiOwner: { userId: 'owner-test' } }),
    );
    expect(view.queryByText('\u767b\u5f55 / \u6ce8\u518c')).toBeNull();
    expect(view.queryByText('\u9000\u51fa\u767b\u5f55')).toBeNull();
    expect(view.queryByText('\u6211\u7684')).toBeNull();
  });

  it('syncs immediately and then every four seconds while active', async () => {
    render(<App />);
    await flushPromises();

    expect(mocks.fetchServerAiSessions).toHaveBeenCalledTimes(1);
    expect(mocks.fetchServerAiSessions).toHaveBeenLastCalledWith({ userId: 'owner-test' });
    await advanceTime(3_999);
    expect(mocks.fetchServerAiSessions).toHaveBeenCalledTimes(1);
    await advanceTime(1);
    expect(mocks.fetchServerAiSessions).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ userId: 'owner-test' } as AiTaskOwner, 'User owned', 'Guest owned'],
    [{ guestId: 'guest-test' } as AiTaskOwner, 'Guest owned', 'User owned'],
  ])('filters cached sessions for owner %o', (owner, visibleTitle, hiddenTitle) => {
    mocks.getAiOwner.mockReturnValue(owner);
    mocks.chatState.sessions = [
      {
        id: 'user-session',
        title: 'User owned',
        messages: [],
        createdAt: 1,
        updatedAt: 2,
        ownerId: 'owner-test',
        ownerType: 'user',
      },
      {
        id: 'guest-session',
        title: 'Guest owned',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
        ownerId: 'guest-test',
        ownerType: 'guest',
      },
    ];

    const view = render(<App />);

    expect(view.getByText(visibleTitle)).toBeTruthy();
    expect(view.queryByText(hiddenTitle)).toBeNull();
  });

  it('does not start a background sync while already streaming', async () => {
    mocks.chatState.isStreaming = true;

    render(<App />);
    await flushPromises();

    expect(mocks.fetchServerAiSessions).not.toHaveBeenCalled();
  });

  it('skips the four-second poll while a chat response is streaming', async () => {
    render(<App />);
    await flushPromises();
    mocks.chatState.isStreaming = true;

    await advanceTime(4_000);

    expect(mocks.fetchServerAiSessions).toHaveBeenCalledTimes(1);
  });

  it('ignores an in-flight background sync response after streaming starts', async () => {
    let resolveSessions: (sessions: Array<{ id: string }>) => void = () => {};
    mocks.fetchServerAiSessions.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSessions = resolve;
    }));

    render(<App />);
    await flushPromises();
    expect(mocks.fetchServerAiSessions).toHaveBeenCalledTimes(1);

    mocks.chatState.isStreaming = true;
    await act(async () => {
      resolveSessions([{ id: 'stale-session' }]);
      await Promise.resolve();
    });

    expect(mocks.chatState.setSessions).not.toHaveBeenCalled();
  });

  it('keeps the newest background sync when requests finish out of order', async () => {
    const resolvers: Array<(sessions: Array<{ id: string }>) => void> = [];
    mocks.fetchServerAiSessions.mockImplementation(() => new Promise((resolve) => {
      resolvers.push(resolve);
    }));

    render(<App />);
    await flushPromises();
    await advanceTime(4_000);
    expect(mocks.fetchServerAiSessions).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvers[1]([{ id: 'new-session' }]);
      await Promise.resolve();
    });
    await act(async () => {
      resolvers[0]([{ id: 'old-session' }]);
      await Promise.resolve();
    });

    expect(mocks.chatState.setSessions).toHaveBeenCalledTimes(1);
    expect(mocks.chatState.setSessions).toHaveBeenCalledWith(
      [{ id: 'new-session' }],
      'new-session',
    );
  });

  it('skips the four-second poll while the document is hidden', async () => {
    visibilityState = 'hidden';
    render(<App />);
    await flushPromises();

    await advanceTime(4_000);

    expect(mocks.fetchServerAiSessions).toHaveBeenCalledTimes(1);
  });

  it('refreshes once when the document becomes visible', async () => {
    visibilityState = 'hidden';
    render(<App />);
    await flushPromises();
    visibilityState = 'visible';

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(mocks.fetchServerAiSessions).toHaveBeenCalledTimes(2);
  });

  it('does not refresh on visibility change while streaming', async () => {
    visibilityState = 'hidden';
    render(<App />);
    await flushPromises();
    mocks.chatState.isStreaming = true;
    visibilityState = 'visible';

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(mocks.fetchServerAiSessions).toHaveBeenCalledTimes(1);
  });

  it('does not let a late background response overwrite a create refresh', async () => {
    const resolvers: Array<(sessions: Session[]) => void> = [];
    mocks.fetchServerAiSessions.mockImplementation(() => new Promise((resolve) => {
      resolvers.push(resolve);
    }));
    mocks.createServerAiSession.mockResolvedValue({ id: 'created-session' });
    const view = render(<App />);
    await flushPromises();

    await act(async () => {
      view.getByText('\u65b0\u5bf9\u8bdd').closest('button')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.fetchServerAiSessions).toHaveBeenCalledTimes(2);

    const createdSessions = [{
      id: 'created-session',
      title: 'Created',
      messages: [],
      createdAt: 2,
      updatedAt: 2,
      ownerId: 'owner-test',
      ownerType: 'user' as const,
    }];
    await act(async () => {
      resolvers[1](createdSessions);
      await Promise.resolve();
    });
    expect(mocks.chatState.setSessions).toHaveBeenLastCalledWith(
      createdSessions,
      'created-session',
    );
    mocks.chatState.setSessions.mockClear();

    await act(async () => {
      resolvers[0]([{
        id: 'stale-session',
        title: 'Stale',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
        ownerId: 'owner-test',
        ownerType: 'user',
      }]);
      await Promise.resolve();
    });

    expect(mocks.chatState.setSessions).not.toHaveBeenCalled();
  });

  it('does not restart immediate synchronization when only the selection changes', async () => {
    const view = render(<App />);
    await flushPromises();
    expect(mocks.fetchServerAiSessions).toHaveBeenCalledTimes(1);

    mocks.chatState.currentSessionId = 'selected-session';
    view.rerender(<App />);
    await flushPromises();

    expect(mocks.fetchServerAiSessions).toHaveBeenCalledTimes(1);
  });

  it('invalidates an injected task refresh when clear applies first', async () => {
    mocks.chatState.sessions = [{
      id: 'session-1',
      title: 'Session',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      ownerId: 'owner-test',
      ownerType: 'user',
    }];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    await flushPromises();
    await flushPromises();

    const props = mocks.aiChatProps.mock.lastCall?.[0] as {
      refreshAiSessions?: (preferredSessionId?: string | null) => Promise<Session[]>;
    };
    expect(typeof props.refreshAiSessions).toBe('function');

    let resolveTaskRefresh: (sessions: Session[]) => void = () => {};
    mocks.fetchServerAiSessions.mockImplementationOnce(() => new Promise((resolve) => {
      resolveTaskRefresh = resolve;
    }));
    let taskRefreshPromise: Promise<Session[]> | undefined;
    act(() => {
      taskRefreshPromise = props.refreshAiSessions?.('session-1');
    });

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button')?.focus();
      const clearButton = Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === '\u6e05\u7a7a');
      clearButton?.click();
      await Promise.resolve();
    });
    expect(mocks.chatState.setSessions).toHaveBeenLastCalledWith([], null);
    mocks.chatState.setSessions.mockClear();

    await act(async () => {
      resolveTaskRefresh([{
        id: 'stale-task-session',
        title: 'Stale task refresh',
        messages: [],
        createdAt: 1,
        updatedAt: 2,
        ownerId: 'owner-test',
        ownerType: 'user',
      }]);
      await taskRefreshPromise;
    });

    expect(mocks.chatState.setSessions).not.toHaveBeenCalled();
  });
});
