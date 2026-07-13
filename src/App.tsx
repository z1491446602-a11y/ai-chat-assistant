import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock3,
  DatabaseZap,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useChatStore } from '@/store';
import {
  clearServerAiSessions,
  createServerAiSession,
  deleteServerAiSession,
  fetchServerAiSessions,
} from '@/services/api';
import type { Session } from '@/types';
import { getAiOwner } from '@/utils/aiOwner';

const AiChat = lazy(() =>
  import('@/components/AiChat/AiChat').then((module) => ({ default: module.AiChat })),
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

function LegalRecordLinks() {
  return (
    <div className="mt-3 rounded-2xl border border-sky-100/80 bg-white/78 px-3 py-3 text-center text-[11px] leading-5 text-slate-500 shadow-[0_10px_24px_rgba(37,99,235,0.06)]">
      <div className="mb-1 text-[11px] font-medium text-slate-400">
        {'\u5907\u6848\u4fe1\u606f'}
      </div>
      <a
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noreferrer"
        className="block truncate transition-colors hover:text-sky-700"
      >
        {'\u8c6bICP\u59072026027242\u53f7'}
      </a>
      <a
        href="https://beian.mps.gov.cn/#/query/webSearch?code=41010502007797"
        target="_blank"
        rel="noreferrer"
        className="mt-0.5 block truncate transition-colors hover:text-sky-700"
      >
        {'\u8c6b\u516c\u7f51\u5b89\u590741010502007797\u53f7'}
      </a>
    </div>
  );
}

function SidebarToggleButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  const openLeft = 'min(calc(88vw - 28px), 322px)';

  return (
    <button
      onClick={onClick}
      style={{ left: open ? openLeft : '16px' }}
      className={`tech-hover-float fixed top-4 z-[70] flex h-11 min-w-[54px] items-center justify-center rounded-full border px-3 shadow-sm backdrop-blur transition-all duration-300 ${
        open
          ? 'border-sky-200/90 bg-[linear-gradient(180deg,rgba(248,252,255,0.96)_0%,rgba(233,244,255,0.98)_100%)] text-sky-700 shadow-[0_14px_32px_rgba(37,99,235,0.14)]'
          : 'border-sky-100/90 bg-white/90 text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.08)] hover:bg-white'
      }`}
      aria-label={open ? '关闭侧边栏' : '打开侧边栏'}
    >
      <div className="relative h-5 w-6">
        <span
          className={`absolute left-0 top-0.5 h-[3px] rounded-full transition-all ${
            open ? 'w-4 translate-x-1 rotate-45 bg-sky-600' : 'w-4 bg-slate-700'
          }`}
        />
        <span
          className={`absolute left-0 top-[9px] h-[3px] rounded-full transition-all ${
            open ? 'w-4 -translate-x-0.5 -rotate-45 bg-sky-600' : 'w-6 bg-slate-400'
          }`}
        />
        {!open && <span className="absolute left-0 top-[17px] h-[3px] w-4 rounded-full bg-slate-700" />}
      </div>
    </button>
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
  aiSessions,
  currentAiSessionId,
  onClose,
  onCreateAiSession,
  onSelectAiSession,
  onDeleteAiSession,
  onClearAiSessions,
  onClearLocalCache,
}: {
  open: boolean;
  aiSessions: Session[];
  currentAiSessionId: string | null;
  onClose: () => void;
  onCreateAiSession: () => void;
  onSelectAiSession: (sessionId: string) => void;
  onDeleteAiSession: (sessionId: string) => void;
  onClearAiSessions: () => void;
  onClearLocalCache: () => void;
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
              className="tech-hover-float mt-4 flex w-full items-center justify-between rounded-2xl border border-sky-100/80 bg-[linear-gradient(180deg,#fbfdff_0%,#edf6ff_100%)] px-4 py-3 text-left transition-colors hover:bg-[#e6f2ff]"
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
                    className="rounded-full px-2 py-1 text-[11px] text-red-500 transition-colors hover:bg-red-50"
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
                        className="flex w-10 shrink-0 items-center justify-center rounded-2xl border border-transparent text-slate-300 transition-colors hover:border-red-100 hover:bg-red-50 hover:text-red-500"
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
            onClick={onClearLocalCache}
            className="tech-hover-float flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-slate-500 transition-colors hover:bg-sky-50 hover:text-sky-700"
          >
            <DatabaseZap className="h-5 w-5" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">清除本地缓存</span>
              <span className="block text-xs text-slate-400">不删除云端聊天记录</span>
            </span>
          </button>
          <LegalRecordLinks />
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

export function App() {
  const sessions = useChatStore((state) => state.sessions);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const selectSession = useChatStore((state) => state.selectSession);
  const setSessions = useChatStore((state) => state.setSessions);
  const resetSessions = useChatStore((state) => state.resetSessions);

  const [showMenu, setShowMenu] = useState(false);
  const aiOwner = useMemo(() => getAiOwner(), []);
  const requestGenerationRef = useRef(0);

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
  }, [refreshAiSessions]);

  const handleCreateAiSession = () => {
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
    if (aiSessions.length === 0) {
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
    <div className="flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.16),transparent_32%),radial-gradient(circle_at_20%_18%,rgba(56,189,248,0.14),transparent_22%),linear-gradient(180deg,#f4f9ff_0%,#eaf3ff_48%,#edf5ff_100%)]">
      <SidebarToggleButton open={showMenu} onClick={() => setShowMenu((value) => !value)} />

      <AppSidebar
        open={showMenu}
        aiSessions={aiSessions}
        currentAiSessionId={currentSessionId}
        onClose={() => setShowMenu(false)}
        onCreateAiSession={handleCreateAiSession}
        onSelectAiSession={handleSelectAiSession}
        onDeleteAiSession={handleDeleteAiSession}
        onClearAiSessions={handleClearAiSessions}
        onClearLocalCache={handleClearLocalCache}
      />

      <div className="min-h-0 flex-1">
        <Suspense fallback={<AiSurfaceLoading />}>
          <AiChat
            aiOwner={aiOwner}
            sidebarOpen={showMenu}
            refreshAiSessions={refreshAiSessions}
          />
        </Suspense>
      </div>
    </div>
  );
}
