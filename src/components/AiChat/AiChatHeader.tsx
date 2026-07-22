import { ChevronDown, LoaderCircle, LogIn } from 'lucide-react';
import userAvatarUrl from '@/assets/user-avatar.jpg';
import type { AuthStatus, AuthUser } from '@/services/authApi';

interface AiChatHeaderProps {
  user: AuthUser | null;
  authStatus?: AuthStatus;
  sidebarOpen?: boolean;
  onAccountClick: () => void;
}

export function AiChatHeader({
  user,
  authStatus = user ? 'authenticated' : 'guest',
  sidebarOpen = false,
  onAccountClick,
}: AiChatHeaderProps) {
  const accountLabel = authStatus === 'loading'
    ? '正在确认登录状态'
    : authStatus === 'error'
      ? '登录状态异常，打开账户'
      : user
        ? `账户，${user.realName}`
        : '登录或注册';

  return (
    <header className="relative flex min-h-16 shrink-0 items-center justify-center border-b border-slate-200 bg-white px-24 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-center sm:py-2">
      <div className="min-w-0">
        <h1
          className="truncate text-[15px] font-semibold leading-5 text-slate-900"
          style={{ fontFamily: '"Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", system-ui, sans-serif' }}
        >
          人工智障
        </h1>
        <p className="mt-0.5 truncate text-xs leading-4 text-slate-500">内容由 AI 生成</p>
      </div>
      {!sidebarOpen && <button
        type="button"
        aria-label={accountLabel}
        aria-busy={authStatus === 'loading'}
        title={accountLabel}
        disabled={authStatus === 'loading'}
        onClick={onAccountClick}
        className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.35rem)] inline-flex h-11 min-w-11 max-w-[11rem] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 shadow-[0_4px_14px_rgba(15,23,42,0.06)] transition-colors hover:border-sky-300 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-wait disabled:text-slate-400"
      >
        {authStatus === 'loading' ? (
          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : user ? (
          <>
            <img alt="" aria-hidden="true" className="h-7 w-7 shrink-0 rounded-full object-cover" src={userAvatarUrl} />
            <span className="min-w-0 text-left leading-tight">
              <span className="hidden truncate text-xs font-semibold text-slate-900 sm:block">{user.realName}</span>
              <span className="block whitespace-nowrap text-[11px] text-slate-600">{user.role === 'admin' ? '管理员' : '普通账号'}</span>
            </span>
            <ChevronDown aria-hidden="true" className="hidden h-3.5 w-3.5 shrink-0 text-slate-400 sm:block" />
          </>
        ) : (
          <>
            <LogIn aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap font-semibold">登录</span>
          </>
        )}
      </button>}
    </header>
  );
}
