// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTaskOwner } from '@/services/api';
import type { Session } from '@/types';
import type { AuthUser } from '@/services/authApi';
import { notifySessionExpired } from '@/services/http';
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
    fetchCurrentUser: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    redeemCode: vi.fn(),
    generateRedeemCode: vi.fn(),
    adminResetPassword: vi.fn(),
    accountDialogProps: vi.fn(),
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
vi.mock('@/services/authApi', () => ({
  fetchCurrentUser: mocks.fetchCurrentUser,
  login: mocks.login,
  register: mocks.register,
  logout: mocks.logout,
  redeemCode: mocks.redeemCode,
  generateRedeemCode: mocks.generateRedeemCode,
  adminResetPassword: mocks.adminResetPassword,
}));
vi.mock('@/components/Auth/AccountDialog', () => ({
  AccountDialog: (props: unknown) => {
    mocks.accountDialogProps(props);
    return <div data-testid="account-dialog" />;
  },
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
  mocks.fetchCurrentUser.mockResolvedValue({
    id: 'owner-test',
    phone: '13800138000',
    realName: '测试用户',
    role: 'user',
    points: 2,
    availablePoints: 1.2,
  } satisfies AuthUser);
  mocks.login.mockResolvedValue({
    id: 'logged-in-user',
    phone: '13900139000',
    realName: '登录用户',
    role: 'user',
    points: 0,
    availablePoints: 0,
  } satisfies AuthUser);
  mocks.adminResetPassword.mockResolvedValue({
    ok: true,
    user: {
      id: 'owner-test',
      phone: '13800138000',
      realName: '测试用户',
      role: 'admin',
    },
  });
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
  it('loads the AI surface through a lazy boundary and uses the authenticated account owner', async () => {
    vi.useRealTimers();
    const view = render(<App />);

    expect(view.getByTestId('ai-surface-loading')).toBeTruthy();
    expect(await view.findByTestId('ai-chat', {}, { timeout: 3_000 })).toBeTruthy();
    expect(mocks.aiChatProps).toHaveBeenCalledWith(
      expect.objectContaining({
        aiOwner: { userId: 'owner-test' },
        user: expect.objectContaining({ availablePoints: 1.2 }),
      }),
    );
    expect(mocks.aiChatProps).toHaveBeenCalledWith(
      expect.objectContaining({ onAccountClick: expect.any(Function) }),
    );
  });

  it('keeps cached chat state intact and blocks interaction while authentication is loading', async () => {
    vi.useRealTimers();
    mocks.fetchCurrentUser.mockImplementation(() => new Promise(() => {}));
    const view = render(<App />);

    await view.findByTestId('ai-chat', {}, { timeout: 3_000 });

    expect(mocks.aiChatProps).toHaveBeenLastCalledWith(expect.objectContaining({
      authStatus: 'loading',
      interactionEnabled: false,
    }));
    expect(mocks.chatState.resetSessions).not.toHaveBeenCalled();
    expect(mocks.fetchServerAiSessions).not.toHaveBeenCalled();
  });

  it('keeps authentication errors distinct from guest state without clearing cached chat', async () => {
    vi.useRealTimers();
    mocks.fetchCurrentUser.mockRejectedValue(new Error('network unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(<App />);

    await view.findByTestId('ai-chat', {}, { timeout: 3_000 });
    await waitFor(() => expect(mocks.aiChatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ authStatus: 'error', interactionEnabled: false }),
    ));

    expect(mocks.chatState.resetSessions).not.toHaveBeenCalled();
    expect(mocks.fetchServerAiSessions).not.toHaveBeenCalled();
  });

  it.each(['loading', 'error'] as const)(
    'disables sidebar mutation and sync controls while authentication is %s',
    async (authState) => {
      vi.useRealTimers();
      mocks.chatState.sessions = [{
        id: 'cached-session',
        title: 'Cached session',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
        ownerId: 'owner-test',
        ownerType: 'user',
      }];
      if (authState === 'loading') {
        mocks.fetchCurrentUser.mockImplementation(() => new Promise(() => {}));
      } else {
        mocks.fetchCurrentUser.mockRejectedValue(new Error('network unavailable'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
      }
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const view = render(<App />);
      await view.findByTestId('ai-chat', {}, { timeout: 3_000 });
      if (authState === 'error') {
        await waitFor(() => expect(mocks.aiChatProps).toHaveBeenLastCalledWith(
          expect.objectContaining({ authStatus: 'error' }),
        ));
      }

      fireEvent.click(view.getByRole('button', { name: '打开侧边栏' }));
      const controls = [
        view.getByText('新对话').closest('button'),
        view.getByRole('button', { name: '删除这条聊天记录' }),
        view.getByRole('button', { name: '清空' }),
        view.getByRole('button', { name: /清除本地缓存/ }),
      ] as HTMLButtonElement[];

      controls.forEach(control => {
        expect(control.disabled).toBe(true);
        fireEvent.click(control);
      });
      await waitFor(() => {
        expect(mocks.createServerAiSession).not.toHaveBeenCalled();
        expect(mocks.deleteServerAiSession).not.toHaveBeenCalled();
        expect(mocks.clearServerAiSessions).not.toHaveBeenCalled();
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
      expect(mocks.chatState.resetSessions).not.toHaveBeenCalled();
    },
  );

  it('handles a shared session-expiry notification by switching to guest and opening login', async () => {
    vi.useRealTimers();
    mocks.getAiOwner.mockReturnValue({ guestId: 'guest-test' });
    const view = render(<App />);
    await view.findByTestId('ai-chat', {}, { timeout: 3_000 });
    await waitFor(() => expect(mocks.aiChatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ authStatus: 'authenticated' }),
    ));
    mocks.chatState.resetSessions.mockClear();

    act(() => notifySessionExpired());

    await view.findByTestId('account-dialog');
    expect(mocks.chatState.resetSessions).toHaveBeenCalledTimes(1);
    expect(mocks.aiChatProps).toHaveBeenLastCalledWith(expect.objectContaining({
      aiOwner: { guestId: 'guest-test' },
      authStatus: 'guest',
      interactionEnabled: true,
      user: null,
    }));
  });

  it('switches from the stable guest owner to the account owner after login', async () => {
    vi.useRealTimers();
    mocks.getAiOwner.mockReturnValue({ guestId: 'guest-test' });
    mocks.fetchCurrentUser.mockResolvedValue(null);
    const view = render(<App />);

    await view.findByTestId('ai-chat', {}, { timeout: 3_000 });
    await waitFor(() => expect(mocks.aiChatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ aiOwner: { guestId: 'guest-test' }, user: null }),
    ));

    const guestProps = mocks.aiChatProps.mock.lastCall?.[0] as {
      onAccountClick: () => void;
    };
    act(() => guestProps.onAccountClick());
    await view.findByTestId('account-dialog');
    const props = mocks.accountDialogProps.mock.lastCall?.[0] as {
      onLogin: (input: { phone: string; password: string }) => Promise<void>;
    };
    await act(async () => {
      await props.onLogin({ phone: '13900139000', password: 'password1' });
    });

    expect(mocks.login).toHaveBeenCalledWith({ phone: '13900139000', password: 'password1' });
    expect(mocks.chatState.resetSessions).toHaveBeenCalled();
    expect(mocks.aiChatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        aiOwner: { userId: 'logged-in-user' },
        user: expect.objectContaining({ id: 'logged-in-user' }),
      }),
    );
  });

  it('does not let a late balance refresh restore an account after logout', async () => {
    vi.useRealTimers();
    mocks.getAiOwner.mockReturnValue({ guestId: 'guest-test' });
    const view = render(<App />);
    await view.findByTestId('ai-chat', {}, { timeout: 3_000 });
    await waitFor(() => expect(mocks.aiChatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 'owner-test' }) }),
    ));

    let resolveRefresh: (user: AuthUser | null) => void = () => {};
    mocks.fetchCurrentUser.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    const aiProps = mocks.aiChatProps.mock.lastCall?.[0] as {
      onAccountClick: () => void;
      onMediaTaskSettled: () => Promise<boolean> | void;
    };
    act(() => {
      void aiProps.onMediaTaskSettled();
      aiProps.onAccountClick();
    });
    await view.findByTestId('account-dialog');
    const dialogProps = mocks.accountDialogProps.mock.lastCall?.[0] as {
      onLogout: () => Promise<void>;
    };

    await act(async () => {
      await dialogProps.onLogout();
    });
    await act(async () => {
      resolveRefresh({
        id: 'owner-test',
        phone: '13800138000',
        realName: '测试用户',
        role: 'user',
        points: 2,
        availablePoints: 0.8,
      });
      await Promise.resolve();
    });

    expect(mocks.aiChatProps).toHaveBeenLastCalledWith(expect.objectContaining({
      aiOwner: { guestId: 'guest-test' },
      authStatus: 'guest',
      user: null,
    }));
  });

  it('does not let an old account refresh replace a newly logged-in account', async () => {
    vi.useRealTimers();
    const view = render(<App />);
    await view.findByTestId('ai-chat', {}, { timeout: 3_000 });
    await waitFor(() => expect(mocks.aiChatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 'owner-test' }) }),
    ));

    let resolveRefresh: (user: AuthUser | null) => void = () => {};
    mocks.fetchCurrentUser.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    const aiProps = mocks.aiChatProps.mock.lastCall?.[0] as {
      onAccountClick: () => void;
      onMediaTaskSettled: () => Promise<boolean> | void;
    };
    act(() => {
      void aiProps.onMediaTaskSettled();
      aiProps.onAccountClick();
    });
    await view.findByTestId('account-dialog');
    const dialogProps = mocks.accountDialogProps.mock.lastCall?.[0] as {
      onLogin: (input: { phone: string; password: string }) => Promise<void>;
    };

    await act(async () => {
      await dialogProps.onLogin({ phone: '13900139000', password: 'password1' });
    });
    await act(async () => {
      resolveRefresh({
        id: 'owner-test',
        phone: '13800138000',
        realName: '测试用户',
        role: 'user',
        points: 2,
        availablePoints: 0.8,
      });
      await Promise.resolve();
    });

    expect(mocks.aiChatProps).toHaveBeenLastCalledWith(expect.objectContaining({
      aiOwner: { userId: 'logged-in-user' },
      user: expect.objectContaining({ id: 'logged-in-user' }),
    }));
  });

  it('refreshes the account once when the account dialog opens repeatedly during one request', async () => {
    vi.useRealTimers();
    const view = render(<App />);
    await view.findByTestId('ai-chat', {}, { timeout: 3_000 });
    await waitFor(() => expect(mocks.aiChatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 'owner-test' }) }),
    ));
    mocks.fetchCurrentUser.mockClear();

    let resolveRefresh: (user: AuthUser | null) => void = () => {};
    mocks.fetchCurrentUser.mockImplementation(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    const aiProps = mocks.aiChatProps.mock.lastCall?.[0] as { onAccountClick: () => void };
    act(() => {
      aiProps.onAccountClick();
      aiProps.onAccountClick();
    });
    await view.findByTestId('account-dialog');

    expect(mocks.fetchCurrentUser).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRefresh({
        id: 'owner-test',
        phone: '13800138000',
        realName: '测试用户',
        role: 'user',
        points: 2,
        availablePoints: 0.6,
      });
      await Promise.resolve();
    });
    expect(mocks.aiChatProps).toHaveBeenLastCalledWith(expect.objectContaining({
      user: expect.objectContaining({ availablePoints: 0.6 }),
    }));
  });

  it('waits for a slow account refresh before forcing one independent media calibration request', async () => {
    vi.useRealTimers();
    const view = render(<App />);
    await view.findByTestId('ai-chat', {}, { timeout: 3_000 });
    await waitFor(() => expect(mocks.aiChatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 'owner-test' }) }),
    ));
    mocks.fetchCurrentUser.mockClear();

    let resolveFirstRefresh: (user: AuthUser | null) => void = () => {};
    mocks.fetchCurrentUser
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstRefresh = resolve;
      }))
      .mockResolvedValueOnce({
        id: 'owner-test',
        phone: '13800138000',
        realName: '测试用户',
        role: 'user',
        points: 2,
        availablePoints: 0.4,
      } satisfies AuthUser);
    const aiProps = mocks.aiChatProps.mock.lastCall?.[0] as {
      onMediaTaskSettled: (options?: { forceAfterCurrent?: boolean }) => Promise<boolean>;
    };

    let immediateRefresh: Promise<boolean> | undefined;
    let delayedRefresh: Promise<boolean> | undefined;
    act(() => {
      immediateRefresh = aiProps.onMediaTaskSettled();
      delayedRefresh = aiProps.onMediaTaskSettled({ forceAfterCurrent: true });
    });
    expect(mocks.fetchCurrentUser).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstRefresh({
        id: 'owner-test',
        phone: '13800138000',
        realName: '测试用户',
        role: 'user',
        points: 2,
        availablePoints: 0.8,
      });
      await immediateRefresh;
      await delayedRefresh;
    });

    expect(mocks.fetchCurrentUser).toHaveBeenCalledTimes(2);
    expect(mocks.aiChatProps).toHaveBeenLastCalledWith(expect.objectContaining({
      user: expect.objectContaining({ availablePoints: 0.4 }),
    }));
  });

  it('does not apply or chain an account refresh after App unmounts', async () => {
    vi.useRealTimers();
    const view = render(<App />);
    await view.findByTestId('ai-chat', {}, { timeout: 3_000 });
    await waitFor(() => expect(mocks.aiChatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 'owner-test' }) }),
    ));
    mocks.fetchCurrentUser.mockClear();
    mocks.chatState.resetSessions.mockClear();

    let resolveRefresh: (user: AuthUser | null) => void = () => {};
    mocks.fetchCurrentUser.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    const aiProps = mocks.aiChatProps.mock.lastCall?.[0] as {
      onMediaTaskSettled: (options?: { forceAfterCurrent?: boolean }) => Promise<boolean>;
    };
    let forcedRefresh: Promise<boolean> | undefined;
    act(() => {
      void aiProps.onMediaTaskSettled();
      forcedRefresh = aiProps.onMediaTaskSettled({ forceAfterCurrent: true });
    });
    expect(mocks.fetchCurrentUser).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async () => {
      resolveRefresh(null);
      await forcedRefresh;
    });

    expect(mocks.fetchCurrentUser).toHaveBeenCalledTimes(1);
    expect(mocks.chatState.resetSessions).not.toHaveBeenCalled();
  });

  it('uses the shared session-expiry flow when an admin resets their own password', async () => {
    vi.useRealTimers();
    mocks.getAiOwner.mockReturnValue({ guestId: 'guest-test' });
    mocks.fetchCurrentUser.mockResolvedValue({
      id: 'owner-test',
      phone: '13800138000',
      realName: '测试用户',
      role: 'admin',
      points: 2,
      availablePoints: 2,
    } satisfies AuthUser);
    const view = render(<App />);
    await view.findByTestId('ai-chat', {}, { timeout: 3_000 });
    await waitFor(() => expect(mocks.aiChatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ authStatus: 'authenticated' }),
    ));

    const aiProps = mocks.aiChatProps.mock.lastCall?.[0] as { onAccountClick: () => void };
    act(() => aiProps.onAccountClick());
    await view.findByTestId('account-dialog');
    const dialogProps = mocks.accountDialogProps.mock.lastCall?.[0] as {
      onResetPassword: (input: {
        phone: string;
        realName: string;
        newPassword: string;
      }) => Promise<void>;
    };
    await act(async () => {
      await dialogProps.onResetPassword({
        phone: '13800138000',
        realName: '测试用户',
        newPassword: 'replacement2',
      });
    });

    expect(mocks.adminResetPassword).toHaveBeenCalledWith(
      '13800138000',
      '测试用户',
      'replacement2',
    );
    expect(mocks.chatState.resetSessions).toHaveBeenCalled();
    expect(mocks.aiChatProps).toHaveBeenLastCalledWith(expect.objectContaining({
      aiOwner: { guestId: 'guest-test' },
      authStatus: 'guest',
      user: null,
    }));
    expect(mocks.accountDialogProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: null }),
    );
  });

  it('shares sidebar visibility with the AI surface', async () => {
    vi.useRealTimers();
    const view = render(<App />);

    await view.findByTestId('ai-chat', {}, { timeout: 3_000 });
    expect(mocks.aiChatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ sidebarOpen: false }),
    );

    await act(async () => {
      view.getByRole('button', { name: '打开侧边栏' }).click();
    });

    expect(mocks.aiChatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ sidebarOpen: true }),
    );
  });

  it('keeps sidebar clear and delete actions at least 44px in both dimensions', async () => {
    vi.useRealTimers();
    mocks.chatState.sessions = [{
      id: 'session-1',
      title: 'Session',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      ownerId: 'owner-test',
      ownerType: 'user',
    }];
    const view = render(<App />);
    await view.findByTestId('ai-chat', {}, { timeout: 3_000 });
    fireEvent.click(view.getByRole('button', { name: '打开侧边栏' }));

    const clearButton = view.getByRole('button', { name: '清空' });
    const deleteButton = view.getByRole('button', { name: '删除这条聊天记录' });
    [clearButton, deleteButton].forEach((button) => {
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('min-w-11');
    });
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
