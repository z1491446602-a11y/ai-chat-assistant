import {
  ChevronDown,
  CircleUserRound,
  KeyRound,
  LogIn,
  LogOut,
  ShieldCheck,
  Sparkles,
  TicketCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import type {
  AdminResetPasswordInput,
  AuthUser,
  GeneratedRedeemCode,
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
  onRedeem: (code: string) => ActionResult;
  onGenerateCode: (points: number) => GeneratedRedeemCode | Promise<GeneratedRedeemCode>;
  onResetPassword: (input: AdminResetPasswordInput) => ActionResult;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : '操作失败，请稍后重试';
}

export function AccountDialog({
  open,
  user,
  busy,
  onClose,
  onLogin,
  onRegister,
  onLogout,
  onRedeem,
  onGenerateCode,
  onResetPassword,
}: AccountDialogProps) {
  const titleId = useId();
  const loginPanelId = useId();
  const registerPanelId = useId();
  const loginTabId = useId();
  const registerTabId = useId();
  const resetPasswordPanelId = useId();
  const resetPasswordWarningId = useId();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [realName, setRealName] = useState('');
  const [redeemValue, setRedeemValue] = useState('');
  const [pointsValue, setPointsValue] = useState('10');
  const [generatedCode, setGeneratedCode] = useState<GeneratedRedeemCode | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [resetPhone, setResetPhone] = useState('');
  const [resetRealName, setResetRealName] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState('');
  const [resetPasswordStatus, setResetPasswordStatus] = useState('');
  const [actionError, setActionError] = useState('');
  const [pointsError, setPointsError] = useState('');
  const dialogLocked = isGeneratingCode || isResettingPassword;
  const controlsBusy = busy || dialogLocked;

  useEffect(() => {
    if (!open) {
      setGeneratedCode(null);
      setActionError('');
      setPointsError('');
      setResetPasswordOpen(false);
      setResetPhone('');
      setResetRealName('');
      setResetNewPassword('');
      setResetPasswordError('');
      setResetPasswordStatus('');
      return;
    }

    const focusTimer = window.setTimeout(() => firstInputRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !dialogLocked) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dialogLocked, onClose, open, user]);

  if (!open) return null;

  const runAction = async (action: () => ActionResult) => {
    setActionError('');
    try {
      await action();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !dialogLocked) onClose();
  };

  const handleAuthSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedPhone = phone.trim();
    if (authMode === 'login') {
      void runAction(() => onLogin({ phone: normalizedPhone, password }));
      return;
    }

    void runAction(() => onRegister({
      phone: normalizedPhone,
      password,
      realName: realName.trim(),
    }));
  };

  const handleRedeemSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = redeemValue.trim();
    if (!code) return;
    void runAction(() => onRedeem(code));
  };

  const handleGenerateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const points = Number(pointsValue);
    if (!Number.isFinite(points) || points <= 0) {
      setPointsError('请输入大于 0 的积分额度');
      return;
    }

    setPointsError('');
    setActionError('');
    setGeneratedCode(null);
    setIsGeneratingCode(true);
    try {
      setGeneratedCode(await onGenerateCode(points));
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setIsGeneratingCode(false);
    }
  };

  const handleResetPasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || isResettingPassword) return;

    const input = {
      phone: resetPhone.trim(),
      realName: resetRealName.trim(),
      newPassword: resetNewPassword,
    };
    if (!input.phone || !input.realName || !input.newPassword) return;

    setActionError('');
    setResetPasswordError('');
    setResetPasswordStatus('');
    setIsResettingPassword(true);
    try {
      await onResetPassword(input);
      setResetPhone('');
      setResetRealName('');
      setResetNewPassword('');
      setResetPasswordStatus('密码已重置，该用户已从所有设备退出');
    } catch (error) {
      setResetPasswordError(errorMessage(error));
    } finally {
      setIsResettingPassword(false);
    }
  };

  const inputClass = 'h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';
  const primaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4"
      onMouseDown={handleBackdropMouseDown}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-[calc(100%-2rem)] max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white text-slate-900 shadow-2xl"
        role="dialog"
      >
        <header className="flex min-h-16 items-center justify-between border-b border-slate-200 px-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <CircleUserRound aria-hidden="true" className="h-5 w-5 shrink-0 text-sky-600" />
            <h2 className="truncate text-base font-semibold" id={titleId}>账户</h2>
          </div>
          <button
            aria-label="关闭账户窗口"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:text-slate-300"
            disabled={dialogLocked}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </header>

        {user ? (
          <div>
            <div className="px-4 py-5 sm:px-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-slate-900">{user.realName}</p>
                  <p className="mt-1 truncate text-sm text-slate-600">{user.phone}</p>
                </div>
                {user.role === 'admin' && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
                    <ShieldCheck aria-hidden="true" className="h-4 w-4" />
                    管理员
                  </span>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-2 border-y border-slate-200 bg-slate-50">
              <div aria-label="总积分" className="px-4 py-3 sm:px-5">
                <dt className="text-xs text-slate-600">总积分</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                  {user.points.toLocaleString('zh-CN')}
                </dd>
              </div>
              <div aria-label="可用积分" className="border-l border-slate-200 px-4 py-3 sm:px-5">
                <dt className="text-xs text-slate-600">可用积分</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                  {user.availablePoints.toLocaleString('zh-CN')}
                </dd>
              </div>
            </dl>

            <div className="px-4 py-5 sm:px-5">
              <form className="space-y-3" onSubmit={handleRedeemSubmit}>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="account-redeem-code">
                    兑换码
                  </label>
                  <input
                    autoComplete="off"
                    className={inputClass}
                    disabled={controlsBusy}
                    id="account-redeem-code"
                    onChange={(event) => setRedeemValue(event.target.value)}
                    placeholder="输入兑换码"
                    ref={firstInputRef}
                    required
                    value={redeemValue}
                  />
                </div>
                <button aria-label="兑换积分" className={primaryButtonClass} disabled={controlsBusy || !redeemValue.trim()} type="submit">
                  <TicketCheck aria-hidden="true" className="h-4 w-4" />
                  {controlsBusy ? '处理中' : '兑换积分'}
                </button>
              </form>
            </div>

            {user.role === 'admin' && (
              <div className="border-t border-slate-200 px-4 py-5 sm:px-5">
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles aria-hidden="true" className="h-4 w-4 text-sky-600" />
                  <h3 className="text-sm font-semibold text-slate-900">生成兑换码</h3>
                </div>
                <form className="space-y-3" onSubmit={handleGenerateSubmit}>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="account-code-points">
                      兑换积分额度
                    </label>
                    <input
                      className={inputClass}
                      disabled={controlsBusy}
                      id="account-code-points"
                      inputMode="decimal"
                      min="0.1"
                      onChange={(event) => setPointsValue(event.target.value)}
                      step="0.1"
                      type="number"
                      value={pointsValue}
                    />
                    {pointsError && <p className="mt-1.5 text-sm text-red-700" role="alert">{pointsError}</p>}
                  </div>
                  <button aria-label="生成兑换码" className={primaryButtonClass} disabled={controlsBusy} type="submit">
                    <Sparkles aria-hidden="true" className="h-4 w-4" />
                    {controlsBusy ? '生成中' : '生成兑换码'}
                  </button>
                </form>

                {generatedCode && (
                  <div aria-live="polite" className="mt-4 border-l-2 border-sky-500 bg-sky-50 px-3 py-2">
                    <p className="text-xs font-medium text-sky-800">本次生成的兑换码</p>
                    <output className="mt-1 block break-all font-mono text-base font-semibold text-slate-900">
                      {generatedCode.code}
                    </output>
                    <p className="mt-1 text-xs text-slate-600">{generatedCode.points} 积分</p>
                  </div>
                )}

                <div className="mt-5 border-t border-slate-200 pt-4">
                  <button
                    aria-controls={resetPasswordPanelId}
                    aria-expanded={resetPasswordOpen}
                    className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-sky-500 disabled:text-slate-400"
                    disabled={controlsBusy}
                    onClick={() => {
                      setResetPasswordOpen(value => !value);
                      setResetPasswordError('');
                      setResetPasswordStatus('');
                    }}
                    type="button"
                  >
                    <KeyRound aria-hidden="true" className="h-4 w-4 text-sky-600" />
                    <span className="flex-1">重置用户密码</span>
                    <ChevronDown
                      aria-hidden="true"
                      className={`h-4 w-4 transition-transform ${resetPasswordOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {resetPasswordOpen && (
                    <form
                      aria-describedby={resetPasswordWarningId}
                      aria-label="重置用户密码"
                      className="mt-3 space-y-3"
                      id={resetPasswordPanelId}
                      onSubmit={handleResetPasswordSubmit}
                    >
                      <p className="text-xs leading-5 text-amber-800" id={resetPasswordWarningId}>
                        重置后，该用户会从所有设备退出登录
                      </p>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="account-reset-phone">
                          用户手机号
                        </label>
                        <input
                          autoComplete="tel"
                          className={inputClass}
                          disabled={controlsBusy}
                          id="account-reset-phone"
                          inputMode="numeric"
                          maxLength={11}
                          onChange={(event) => setResetPhone(event.target.value)}
                          pattern="[0-9]{11}"
                          required
                          type="tel"
                          value={resetPhone}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="account-reset-real-name">
                          用户真实姓名
                        </label>
                        <input
                          autoComplete="off"
                          className={inputClass}
                          disabled={controlsBusy}
                          id="account-reset-real-name"
                          onChange={(event) => setResetRealName(event.target.value)}
                          required
                          value={resetRealName}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="account-reset-new-password">
                          用户新密码
                        </label>
                        <input
                          autoComplete="new-password"
                          className={inputClass}
                          disabled={controlsBusy}
                          id="account-reset-new-password"
                          minLength={8}
                          onChange={(event) => setResetNewPassword(event.target.value)}
                          required
                          type="password"
                          value={resetNewPassword}
                        />
                      </div>
                      {resetPasswordError && (
                        <p className="text-sm text-red-700" role="alert">{resetPasswordError}</p>
                      )}
                      {resetPasswordStatus && (
                        <p className="text-sm text-emerald-700" role="status">{resetPasswordStatus}</p>
                      )}
                      <button
                        className={primaryButtonClass}
                        disabled={controlsBusy || !resetPhone.trim() || !resetRealName.trim() || !resetNewPassword}
                        type="submit"
                      >
                        <KeyRound aria-hidden="true" className="h-4 w-4" />
                        {isResettingPassword ? '正在重置' : '确认重置密码'}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            )}

            {actionError && <p className="px-4 pb-4 text-sm text-red-700 sm:px-5" role="alert">{actionError}</p>}

            <div className="border-t border-slate-200 px-4 py-4 sm:px-5">
              <button
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:text-slate-400"
                disabled={controlsBusy}
                onClick={() => void runAction(onLogout)}
                type="button"
              >
                <LogOut aria-hidden="true" className="h-4 w-4" />
                退出登录
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div aria-label="账户操作" className="grid grid-cols-2 border-b border-slate-200" role="tablist">
              {(['login', 'register'] as const).map((mode) => {
                const selected = authMode === mode;
                const label = mode === 'login' ? '登录' : '注册';
                return (
                  <button
                    aria-controls={mode === 'login' ? loginPanelId : registerPanelId}
                    aria-selected={selected}
                    className={`min-h-11 border-b-2 px-4 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sky-500 ${selected ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                    disabled={controlsBusy}
                    id={mode === 'login' ? loginTabId : registerTabId}
                    key={mode}
                    onClick={() => {
                      setAuthMode(mode);
                      setActionError('');
                    }}
                    role="tab"
                    type="button"
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <form
              aria-labelledby={authMode === 'login' ? loginTabId : registerTabId}
              className="space-y-4 px-4 py-5 sm:px-5"
              id={authMode === 'login' ? loginPanelId : registerPanelId}
              onSubmit={handleAuthSubmit}
              role="tabpanel"
            >
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="account-phone">手机号</label>
                <input
                  autoComplete="tel"
                  className={inputClass}
                  disabled={controlsBusy}
                  id="account-phone"
                  inputMode={authMode === 'register' ? 'numeric' : 'tel'}
                  maxLength={authMode === 'register' ? 11 : undefined}
                  onChange={(event) => setPhone(event.target.value)}
                  pattern={authMode === 'register' ? '[0-9]{11}' : undefined}
                  placeholder="请输入手机号"
                  ref={firstInputRef}
                  required
                  type="tel"
                  value={phone}
                />
              </div>

              {authMode === 'register' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="account-real-name">真实姓名</label>
                  <input
                    autoComplete="name"
                    className={inputClass}
                    disabled={controlsBusy}
                    id="account-real-name"
                    onChange={(event) => setRealName(event.target.value)}
                    placeholder="请输入真实姓名"
                    required
                    value={realName}
                  />
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="account-password">密码</label>
                <input
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  className={inputClass}
                  disabled={controlsBusy}
                  id="account-password"
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="至少 8 位密码"
                  required
                  type="password"
                  value={password}
                />
              </div>

              {authMode === 'login' && (
                <p className="text-xs text-slate-500">忘记密码请联系管理员</p>
              )}

              {resetPasswordStatus && (
                <p className="text-sm text-emerald-700" role="status">{resetPasswordStatus}</p>
              )}

              {actionError && <p className="text-sm text-red-700" role="alert">{actionError}</p>}

              <button className={primaryButtonClass} disabled={controlsBusy} type="submit">
                {authMode === 'login'
                  ? <LogIn aria-hidden="true" className="h-4 w-4" />
                  : <UserPlus aria-hidden="true" className="h-4 w-4" />}
                {controlsBusy
                  ? '处理中'
                  : authMode === 'login' ? '登录账户' : '创建账户'}
              </button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
