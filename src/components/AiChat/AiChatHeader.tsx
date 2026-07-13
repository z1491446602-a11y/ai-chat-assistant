import { LoaderCircle, LogIn, WalletCards } from 'lucide-react';
import type { AuthStatus, AuthUser } from '@/services/authApi';

interface AiChatHeaderProps {
  user: AuthUser | null;
  authStatus?: AuthStatus;
  sidebarOpen?: boolean;
  onAccountClick: () => void;
}

function formatPoints(points: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(points);
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
        ? `账户，当前可用 ${formatPoints(user.availablePoints)} 积分`
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
        className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.35rem)] inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
      >
        {authStatus === 'loading' ? (
          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : user ? (
          <>
            <WalletCards aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap tabular-nums">{formatPoints(user.availablePoints)} 积分</span>
          </>
        ) : (
          <>
            <LogIn aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="hidden whitespace-nowrap sm:inline">登录</span>
          </>
        )}
      </button>}
    </header>
  );
}
