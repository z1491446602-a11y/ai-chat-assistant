import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock3,
  DatabaseZap,
  Home,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { HomePage } from '@/components/HomePage';
import { ShortVideoTool } from '@/components/ShortVideoTool';
import { useChatStore } from '@/store';
import {
  clearServerAiSessions,
  createServerAiSession,
  deleteServerAiSession,
  fetchServerAiSessions,
} from '@/services/api';
import type { Session } from '@/types';
import { getAiOwner } from '@/utils/aiOwner';
import {
  adminResetPassword,
  fetchCurrentUser,
  login as loginAccount,
  logout as logoutAccount,
  register as registerAccount,
  type AuthStatus,
  type AuthUser,
  type AdminResetPasswordInput,
  type LoginInput,
  type RegisterInput,
} from '@/services/authApi';
import { notifySessionExpired, subscribeToSessionExpired } from '@/services/http';

const AiChat = lazy(() =>
  import('@/components/AiChat/AiChat').then((module) => ({ default: module.AiChat })),
);
const AccountDialog = lazy(() =>
  import('@/components/Auth/AccountDialog').then((module) => ({ default: module.AccountDialog })),
);

function AiSurfaceLoading() {
  return (
    <div
      data-testid="ai-surface-loading"
      className="flex h-full items-center justify-center text-sm text-slate-400"
    >
      加载中…
    </div>
  );
}

function SidebarToggleButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  const openLeft = 'min(calc(88vw - 28px), 322px)';

  return (
    <button
      onClick={onClick}
      style={{ left: open ? openLeft : '12px' }}
      className={`tech-hover-float fixed top-2.5 z-[70] flex h-8 w-8 items-center justify-center rounded-xl border bg-white/80 shadow-sm backdrop-blur-md transition-all duration-200 hover:bg-white active:scale-95 ${
        open
          ? 'border-sky-200 text-sky-600 shadow-md shadow-sky-100/50'
          : 'border-slate-200 text-slate-500 hover:text-slate-800'
      }`}
      aria-label={open ? '关闭侧边栏' : '打开侧边栏'}
    >
      {open ? (
        <svg className='h-3.5 w-3.5' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'><line x1='18' y1='6' x2='6' y2='18'></line><line x1='6' y1='6' x2='18' y2='18'></line></svg>
      ) : (
        <svg className='h-3.5 w-3.5' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'><line x1='3' y1='12' x2='21' y2='12'></line><line x1='3' y1='6' x2='21' y2='6'></line><line x1='3' y1='18' x2='21' y2='18'></line></svg>
      )}</button>
  );
}

function formatSessionTime(timestamp: number) {
  if (!timestamp) {
    return '';
  }

  const diffMinutes = Math.floor((Date.now() - timestamp) / 60000);

  if (diffMinutes < 1) {
    return '刚刚';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }

  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function AppSidebar({
  open,
  interactionEnabled,
  aiSessions,
  currentAiSessionId,
  onClose,
  onCreateAiSession,
  onSelectAiSession,
  onDeleteAiSession,
  onClearAiSessions,
  onClearLocalCache,
  onGoHome,
}: {
  open: boolean;
  interactionEnabled: boolean;
  aiSessions: Session[];
  currentAiSessionId: string | null;
  onClose: () => void;
  onCreateAiSession: () => void;
  onSelectAiSession: (sessionId: string) => void;
  onDeleteAiSession: (sessionId: string) => void;
  onClearAiSessions: () => void;
  onClearLocalCache: () => void;
  onGoHome: () => void;
}) {
  return (
    <>
      <aside
        className={`tech-panel fixed left-0 top-0 z-[60] flex h-full w-[340px] max-w-[88vw] flex-col rounded-r-[28px] border-r border-sky-100/80 transition-transform duration-300 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="relative border-b border-sky-100/80 bg-gradient-to-b from-[#fbfdff] via-[#f2f8ff] to-[#eaf4ff] px-5 pb-5 pt-6">
          <div className="mb-4 flex items-start gap-3 pr-10">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-600 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(14,165,233,0.24)]">
                A
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold text-slate-900">人工智障</div>
                <div className="truncate text-xs text-slate-500">AI 对话助手</div>
              </div>
            </div>
          </div>

          <div className="tech-surface rounded-[24px] border border-sky-100/90 bg-white/90 p-4 shadow-[0_18px_40px_rgba(37,99,235,0.1)] backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">人工智障</div>
                <div className="text-xs text-slate-500">开始新对话，或者继续历史上下文</div>
              </div>
            </div>

            <button
              onClick={onCreateAiSession}
              disabled={!interactionEnabled}
              className="tech-hover-float mt-4 flex w-full items-center justify-between rounded-2xl border border-sky-100/80 bg-[linear-gradient(180deg,#fbfdff_0%,#edf6ff_100%)] px-4 py-3 text-left transition-colors hover:bg-[#e6f2ff] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-100 bg-white shadow-sm">
                  <Plus className="h-4 w-4 text-slate-700" />
                </span>
                <span className="text-[15px] font-medium text-slate-900">新对话</span>
              </span>
              <span className="text-xs text-slate-400">Ctrl K</span>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-4">
            <section className="tech-surface rounded-[24px] bg-white/90 p-4 shadow-[0_18px_40px_rgba(37,99,235,0.1)] ring-1 ring-sky-100/80">
              <div className="mb-3 flex items-center justify-between gap-2 px-1 text-xs font-medium tracking-wide text-slate-400">
                <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4" />
                <span>历史对话</span>
                </div>
                {aiSessions.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearAiSessions}
                    disabled={!interactionEnabled}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 py-1 text-[11px] text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    清空
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {aiSessions.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-sky-100 bg-[#f7fbff] px-4 py-5 text-sm leading-6 text-slate-400">
                    还没有 AI 历史对话，点击上面的“新对话”就能开始。
                  </div>
                ) : (
                  aiSessions.map((session) => {
                    const isActive = session.id === currentAiSessionId;

                    return (
                      <div
                        key={session.id}
                        className="group flex items-stretch gap-2"
                      >
                      <button
                        onClick={() => onSelectAiSession(session.id)}
                        className={`tech-hover-float min-w-0 flex-1 rounded-2xl border px-3 py-3 text-left transition-colors ${
                          isActive
                            ? 'border-sky-200 bg-sky-50'
                            : 'border-transparent bg-[#f8fbff] hover:bg-[#edf6ff]'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                              isActive ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            <Sparkles className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-slate-800">
                              {session.title || '新对话'}
                            </div>
                            <div className="mt-1 text-xs text-slate-400">
                              {session.messages.length > 0
                                ? `${session.messages.length} 条消息 · ${formatSessionTime(session.updatedAt)}`
                                : '空对话'}
                            </div>
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteAiSession(session.id)}
                        disabled={!interactionEnabled}
                        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-2xl border border-transparent text-slate-300 transition-colors hover:border-red-100 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="删除这条聊天记录"
                        title="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="border-t border-sky-100/80 p-4">
          <button
            type="button"
            onClick={onGoHome}
            className="tech-hover-float mb-1 flex min-h-11 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-slate-500 transition-colors hover:bg-sky-50 hover:text-sky-700"
          >
            <Home className="h-5 w-5" />
            <span className="text-[15px] font-medium">返回首页</span>
          </button>
          <button
            type="button"
            onClick={onClearLocalCache}
            disabled={!interactionEnabled}
            className="tech-hover-float flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-slate-500 transition-colors hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <DatabaseZap className="h-5 w-5" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">清除本地缓存</span>
              <span className="block text-xs text-slate-400">不删除云端聊天记录</span>
            </span>
          </button>
        </div>
      </aside>

      {open && (
        <button
          onClick={onClose}
          className="fixed inset-0 z-[55] bg-slate-950/20 backdrop-blur-[1px]"
          aria-label="关闭侧边栏遮罩"
        />
      )}
    </>
  );
}

function ChatApp({ onGoHome }: { onGoHome: () => void }) {
  const sessions = useChatStore((state) => state.sessions);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const selectSession = useChatStore((state) => state.selectSession);
  const setSessions = useChatStore((state) => state.setSessions);
  const resetSessions = useChatStore((state) => state.resetSessions);

  const [showMenu, setShowMenu] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const guestOwner = useMemo(() => getAiOwner(), []);
  const aiOwner = useMemo(
    () => authUser ? { userId: authUser.id } as const : guestOwner,
    [authUser, guestOwner],
  );
  const requestGenerationRef = useRef(0);
  const accountGenerationRef = useRef(0);
  const authUserIdRef = useRef<string | null>(null);
  const accountRefreshRef = useRef<{
    generation: number;
    expectedUserId: string | null;
    promise: Promise<boolean>;
  } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      accountGenerationRef.current += 1;
      accountRefreshRef.current = null;
    };
  }, []);

  const switchAccount = useCallback((nextUser: AuthUser | null) => {
    if (!mountedRef.current) {
      return;
    }
    accountGenerationRef.current += 1;
    accountRefreshRef.current = null;
    authUserIdRef.current = nextUser?.id || null;
    requestGenerationRef.current += 1;
    resetSessions();
    setAuthUser(nextUser);
    setAuthStatus(nextUser ? 'authenticated' : 'guest');
  }, [resetSessions]);

  useEffect(() => subscribeToSessionExpired(() => {
    switchAccount(null);
    setAccountDialogOpen(true);
  }), [switchAccount]);

  useEffect(() => {
    let active = true;
    const accountGeneration = accountGenerationRef.current;
    void fetchCurrentUser()
      .then((user) => {
        if (active && accountGeneration === accountGenerationRef.current) {
          authUserIdRef.current = user?.id || null;
          setAuthUser(user);
          setAuthStatus(user ? 'authenticated' : 'guest');
        }
      })
      .catch((error) => {
        console.error('Failed to load current account', error);
        if (active && accountGeneration === accountGenerationRef.current) {
          authUserIdRef.current = null;
          setAuthUser(null);
          setAuthStatus('guest');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const interactionEnabled = authStatus === 'authenticated' || authStatus === 'guest';

  const aiSessions = useMemo(
    () =>
      sessions
        .filter((session) =>
          'guestId' in aiOwner
            ? session.ownerType === 'guest' && session.ownerId === aiOwner.guestId
            : session.ownerType !== 'guest' && session.ownerId === aiOwner.userId,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [aiOwner, sessions],
  );

  const refreshAiSessions = useCallback(async (
    preferredSessionId?: string | null,
    shouldApply: () => boolean = () => true,
  ) => {
    const requestGeneration = ++requestGenerationRef.current;
    const serverSessions = await fetchServerAiSessions(aiOwner);
    if (
      requestGeneration !== requestGenerationRef.current
      || !shouldApply()
    ) {
      return serverSessions;
    }

    const selectedSessionId = preferredSessionId !== undefined
      ? preferredSessionId
      : useChatStore.getState().currentSessionId;
    const nextSessionId = selectedSessionId
      && serverSessions.some((session) => session.id === selectedSessionId)
      ? selectedSessionId
      : (serverSessions[0]?.id || null);
    setSessions(serverSessions, nextSessionId);
    return serverSessions;
  }, [aiOwner, setSessions]);

  useEffect(() => {
    if (!interactionEnabled) {
      return undefined;
    }

    const syncAiSessions = async () => {
      if (useChatStore.getState().isStreaming) {
        return;
      }

      try {
        await refreshAiSessions(
          undefined,
          () => !useChatStore.getState().isStreaming,
        );
      } catch (error) {
        console.error('Failed to sync AI sessions', error);
      }
    };

    void syncAiSessions();
    const timer = window.setInterval(() => {
      if (useChatStore.getState().isStreaming || document.visibilityState === 'hidden') {
        return;
      }

      void syncAiSessions();
    }, 4000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !useChatStore.getState().isStreaming) {
        void syncAiSessions();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      requestGenerationRef.current += 1;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [interactionEnabled, refreshAiSessions]);

  const runAccountAction = useCallback(async <T,>(action: () => Promise<T>) => {
    setAccountBusy(true);
    try {
      return await action();
    } finally {
      setAccountBusy(false);
    }
  }, []);

  const handleLogin = useCallback(async (input: LoginInput) => {
    const user = await runAccountAction(() => loginAccount(input));
    switchAccount(user);
    setAccountDialogOpen(false);
  }, [runAccountAction, switchAccount]);

  const handleRegister = useCallback(async (input: RegisterInput) => {
    const user = await runAccountAction(() => registerAccount(input));
    switchAccount(user);
    setAccountDialogOpen(false);
  }, [runAccountAction, switchAccount]);

  const handleLogout = useCallback(async () => {
    await runAccountAction(logoutAccount);
    switchAccount(null);
    setAccountDialogOpen(false);
  }, [runAccountAction, switchAccount]);

  const handleAdminResetPassword = useCallback(async (input: AdminResetPasswordInput) => {
    const result = await runAccountAction(() => adminResetPassword(
      input.phone,
      input.realName,
      input.newPassword,
    ));
    if (result.user.id === authUser?.id) {
      notifySessionExpired();
    }
  }, [authUser?.id, runAccountAction]);

  const refreshAccount = useCallback((
    options: { forceAfterCurrent?: boolean } = {},
  ): Promise<boolean> => {
    const generation = accountGenerationRef.current;
    const expectedUserId = authUserIdRef.current;
    const isCurrentAccount = () => (
      mountedRef.current
      && generation === accountGenerationRef.current
      && expectedUserId === authUserIdRef.current
    );
    const beginRefresh = (): Promise<boolean> => {
      const promise = (async () => {
        try {
          const user = await fetchCurrentUser({ reportUnauthorized: true });
          if (!isCurrentAccount()) {
            return false;
          }

          if (user) {
            if (expectedUserId && user.id !== expectedUserId) {
              return false;
            }
            if (!expectedUserId) {
              switchAccount(user);
            } else {
              authUserIdRef.current = user.id;
              setAuthUser(user);
              setAuthStatus('authenticated');
            }
          } else if (expectedUserId) {
            switchAccount(null);
          } else {
            setAuthUser(null);
            setAuthStatus('guest');
          }
          return true;
        } catch (error) {
          if (mountedRef.current) {
            console.error('Failed to refresh account information', error);
          }
          return false;
        }
      })();
      const refresh = { generation, expectedUserId, promise };
      accountRefreshRef.current = refresh;
      void promise.finally(() => {
        if (accountRefreshRef.current === refresh) {
          accountRefreshRef.current = null;
        }
      });
      return promise;
    };

    if (!mountedRef.current) {
      return Promise.resolve(false);
    }

    const activeRefresh = accountRefreshRef.current;
    if (
      activeRefresh
      && activeRefresh.generation === generation
      && activeRefresh.expectedUserId === expectedUserId
    ) {
      if (!options.forceAfterCurrent) {
        return activeRefresh.promise;
      }

      return activeRefresh.promise.then(() => {
        if (!isCurrentAccount()) {
          return false;
        }
        const queuedRefresh = accountRefreshRef.current;
        if (
          queuedRefresh
          && queuedRefresh.generation === generation
          && queuedRefresh.expectedUserId === expectedUserId
        ) {
          return queuedRefresh.promise;
        }
        return beginRefresh();
      });
    }

    return beginRefresh();
  }, [switchAccount]);

  const handleOpenAccountDialog = useCallback(() => {
    setAccountDialogOpen(true);
    if (authStatus !== 'loading') {
      void refreshAccount();
    }
  }, [authStatus, refreshAccount]);

  const handleCreateAiSession = () => {
    if (!interactionEnabled) {
      return;
    }

    requestGenerationRef.current += 1;
    void (async () => {
      try {
        const session = await createServerAiSession(aiOwner);
        await refreshAiSessions(session.id);
      } catch (error) {
        console.error('Failed to create AI session', error);
      } finally {
        setShowMenu(false);
      }
    })();
  };

  const handleSelectAiSession = (sessionId: string) => {
    selectSession(sessionId);
    setShowMenu(false);
  };

  const handleDeleteAiSession = (sessionId: string) => {
    if (!interactionEnabled) {
      return;
    }

    if (!window.confirm('确定删除这条聊天记录吗？删除后云端也会移除。')) {
      return;
    }

    requestGenerationRef.current += 1;
    void (async () => {
      try {
        await deleteServerAiSession(aiOwner, sessionId);
        await refreshAiSessions(currentSessionId === sessionId ? null : currentSessionId);
      } catch (error) {
        console.error('Failed to delete AI session', error);
        alert(error instanceof Error ? error.message : '删除聊天记录失败');
      }
    })();
  };

  const handleClearAiSessions = () => {
    if (!interactionEnabled || aiSessions.length === 0) {
      return;
    }

    if (!window.confirm('确定清空全部聊天记录吗？该操作会删除云端历史，无法恢复。')) {
      return;
    }

    requestGenerationRef.current += 1;
    void (async () => {
      try {
        await clearServerAiSessions(aiOwner);
        requestGenerationRef.current += 1;
        setSessions([], null);
      } catch (error) {
        console.error('Failed to clear AI sessions', error);
        alert(error instanceof Error ? error.message : '清空聊天记录失败');
      }
    })();
  };

  const handleClearLocalCache = () => {
    if (!interactionEnabled) {
      return;
    }

    if (!window.confirm('确定清除本地缓存吗？云端聊天记录不会删除，刷新后会重新同步。')) {
      return;
    }

    try {
      [
        'chat-sessions-v3',
        'chat-sessions-v2',
        'chat-sessions',
        'chat-store',
      ].forEach((key) => window.localStorage.removeItem(key));
      resetSessions();
      void refreshAiSessions(null);
      alert('本地缓存已清除，云端聊天记录会自动重新同步。');
    } catch (error) {
      console.error('Failed to clear local cache', error);
      alert('清除本地缓存失败，请在浏览器设置中手动清理网站数据。');
    }
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.16),transparent_32%),radial-gradient(circle_at_20%_18%,rgba(56,189,248,0.14),transparent_22%),linear-gradient(180deg,#f4f9ff_0%,#eaf3ff_48%,#edf5ff_100%)]">
      <SidebarToggleButton open={showMenu} onClick={() => setShowMenu((value) => !value)} />

      <AppSidebar
        open={showMenu}
        interactionEnabled={interactionEnabled}
        aiSessions={aiSessions}
        currentAiSessionId={currentSessionId}
        onClose={() => setShowMenu(false)}
        onCreateAiSession={handleCreateAiSession}
        onSelectAiSession={handleSelectAiSession}
        onDeleteAiSession={handleDeleteAiSession}
        onClearAiSessions={handleClearAiSessions}
        onClearLocalCache={handleClearLocalCache}
        onGoHome={onGoHome}
      />

      <div className="min-h-0 flex-1">
        <Suspense fallback={<AiSurfaceLoading />}>
          <AiChat
            aiOwner={aiOwner}
            authStatus={authStatus}
            interactionEnabled={interactionEnabled}
            user={authUser}
            sidebarOpen={showMenu}
            refreshAiSessions={refreshAiSessions}
            onRequireLogin={handleOpenAccountDialog}
            onAccountClick={handleOpenAccountDialog}
          />
        </Suspense>
      </div>

      {accountDialogOpen && (
        <Suspense fallback={null}>
          <AccountDialog
            open
            user={authUser}
            busy={accountBusy}
            onClose={() => setAccountDialogOpen(false)}
            onLogin={handleLogin}
            onRegister={handleRegister}
            onLogout={handleLogout}
            onResetPassword={handleAdminResetPassword}
          />
        </Suspense>
      )}
    </div>
  );
}

function isChatPath(pathname: string) {
  return pathname === '/chat' || pathname.startsWith('/chat/');
}

type AppRoute = '/' | '/chat' | '/short-videos';

function getAppRoute(pathname: string): AppRoute {
  if (isChatPath(pathname)) return '/chat';
  if (pathname === '/short-videos') return '/short-videos';
  return '/';
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(() => getAppRoute(window.location.pathname));

  useEffect(() => {
    const handlePopState = () => setRoute(getAppRoute(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((path: AppRoute) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setRoute(path);
    window.scrollTo({ top: 0, left: 0 });
  }, []);

  return route === '/chat'
    ? <ChatApp onGoHome={() => navigate('/')} />
    : route === '/short-videos'
      ? <ShortVideoTool onGoHome={() => navigate('/')} onOpenChat={() => navigate('/chat')} />
      : <HomePage onOpenChat={() => navigate('/chat')} onOpenShortVideo={() => navigate('/short-videos')} />;
}
