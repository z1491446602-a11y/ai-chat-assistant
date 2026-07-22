import {
  CircleUserRound,
  Image,
  KeyRound,
  LogIn,
  LogOut,
  ShieldCheck,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import type {
  AdminResetPasswordInput,
  AuthUser,
  LoginInput,
  RegisterInput,
} from '@/services/authApi';

type ActionResult = void | Promise<void>;

export interface AccountDialogProps {
  open: boolean;
  user: AuthUser | null;
  busy: boolean;
  onClose: () => void;
  onLogin: (input: LoginInput) => ActionResult;
  onRegister: (input: RegisterInput) => ActionResult;
  onLogout: () => ActionResult;
  onResetPassword: (input: AdminResetPasswordInput) => ActionResult;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : '操作失败，请稍后重试';
}

const inputClass = 'min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50';
const primaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export function AccountDialog({
  open,
  user,
  busy,
  onClose,
  onLogin,
  onRegister,
  onLogout,
  onResetPassword,
}: AccountDialogProps) {
  const titleId = useId();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [realName, setRealName] = useState('');
  const [actionError, setActionError] = useState('');
  const [resetPhone, setResetPhone] = useState('');
  const [resetRealName, setResetRealName] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const controlsBusy = busy || resettingPassword;

  useEffect(() => {
    if (!open) {
      setActionError('');
      setResetPhone('');
      setResetRealName('');
      setResetNewPassword('');
      return;
    }
    const timer = window.setTimeout(() => firstInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !controlsBusy) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [controlsBusy, onClose, open]);

  if (!open) return null;

  const runAction = async (action: () => ActionResult) => {
    setActionError('');
    try {
      await action();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const handleAuthSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedPhone = phone.trim();
    void runAction(() => authMode === 'login'
      ? onLogin({ phone: normalizedPhone, password })
      : onRegister({ phone: normalizedPhone, password, realName: realName.trim() }));
  };

  const handleResetPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResettingPassword(true);
    void runAction(() => onResetPassword({
      phone: resetPhone.trim(),
      realName: resetRealName.trim(),
      newPassword: resetNewPassword,
    })).finally(() => setResettingPassword(false));
  };

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !controlsBusy) onClose();
  };

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
      onMouseDown={handleBackdropMouseDown}
      role="dialog"
    >
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/70 bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              {user?.role === 'admin' ? <ShieldCheck className="h-5 w-5" /> : <CircleUserRound className="h-5 w-5" />}
            </span>
            <div>
              <h2 className="font-semibold text-slate-950" id={titleId}>{user ? '账号中心' : '登录人工智障'}</h2>
              {user && <p className="text-xs text-slate-500">{user.realName} · {user.phone}</p>}
            </div>
          </div>
          <button aria-label="关闭" className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" disabled={controlsBusy} onClick={onClose} type="button">
            <X className="h-5 w-5" />
          </button>
        </header>

        {user ? (
          <div className="space-y-5 p-5">
            <section aria-label="功能权限">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">功能权限</h3>
                {user.role === 'admin' && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">管理员</span>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-3">
                  <Image className="mb-2 h-4 w-4 text-slate-600" />
                  <p className="text-sm font-medium text-slate-900">图片生成</p>
                  <p className="mt-1 text-xs text-slate-500">公开可用</p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-3">
                  <Video className="mb-2 h-4 w-4 text-slate-600" />
                  <p className="text-sm font-medium text-slate-900">视频生成</p>
                  <p className="mt-1 text-xs text-slate-500">公开可用</p>
                </div>
              </div>
            </section>

            {user.role === 'admin' && (
              <>
                <section className="border-t border-slate-200 pt-5">
                  <h3 className="text-sm font-semibold text-slate-900">重置用户密码</h3>
                  <form className="mt-3 space-y-3" onSubmit={handleResetPassword}>
                    <input aria-label="用户手机号" className={inputClass} disabled={controlsBusy} onChange={event => setResetPhone(event.target.value)} placeholder="用户手机号" required value={resetPhone} />
                    <input aria-label="用户真实姓名" className={inputClass} disabled={controlsBusy} onChange={event => setResetRealName(event.target.value)} placeholder="用户真实姓名" required value={resetRealName} />
                    <input aria-label="用户新密码" className={inputClass} disabled={controlsBusy} minLength={8} onChange={event => setResetNewPassword(event.target.value)} placeholder="用户新密码" required type="password" value={resetNewPassword} />
                    <button className={primaryButtonClass} disabled={controlsBusy} type="submit"><KeyRound className="h-4 w-4" />{resettingPassword ? '正在重置' : '确认重置密码'}</button>
                  </form>
                </section>
              </>
            )}

            {actionError && <p className="text-sm text-red-700" role="alert">{actionError}</p>}
            <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50" disabled={controlsBusy} onClick={() => void runAction(onLogout)} type="button">
              <LogOut className="h-4 w-4" />退出登录
            </button>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-2 border-b border-slate-200" role="tablist" aria-label="账号操作">
              {(['login', 'register'] as const).map(mode => (
                <button aria-selected={authMode === mode} className={`min-h-11 border-b-2 text-sm font-semibold ${authMode === mode ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:bg-slate-50'}`} disabled={controlsBusy} key={mode} onClick={() => { setAuthMode(mode); setActionError(''); }} role="tab" type="button">
                  {mode === 'login' ? '登录' : '注册'}
                </button>
              ))}
            </div>
            <form className="space-y-4 p-5" onSubmit={handleAuthSubmit}>
              <input aria-label="手机号" autoComplete="tel" className={inputClass} disabled={controlsBusy} maxLength={11} onChange={event => setPhone(event.target.value)} placeholder="手机号" ref={firstInputRef} required type="tel" value={phone} />
              {authMode === 'register' && <input aria-label="真实姓名" autoComplete="name" className={inputClass} disabled={controlsBusy} onChange={event => setRealName(event.target.value)} placeholder="真实姓名" required value={realName} />}
              <input aria-label="密码" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} className={inputClass} disabled={controlsBusy} minLength={8} onChange={event => setPassword(event.target.value)} placeholder="密码" required type="password" value={password} />
              {actionError && <p className="text-sm text-red-700" role="alert">{actionError}</p>}
              <button className={primaryButtonClass} disabled={controlsBusy} type="submit">
                {authMode === 'login' ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {busy ? '处理中' : authMode === 'login' ? '登录' : '注册账号'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
