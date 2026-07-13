// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AdminResetPasswordInput,
  AuthUser,
  GeneratedRedeemCode,
} from '@/services/authApi';
import { AccountDialog } from './AccountDialog';

const member: AuthUser = {
  id: 'user-1',
  phone: '13800138000',
  realName: '张三',
  role: 'user',
  points: 20,
  availablePoints: 18,
};

const admin: AuthUser = {
  ...member,
  id: 'admin-1',
  realName: '管理员',
  role: 'admin',
};

afterEach(() => {
  cleanup();
});

function renderDialog(patch: Partial<ComponentProps<typeof AccountDialog>> = {}) {
  const props: ComponentProps<typeof AccountDialog> = {
    open: true,
    user: null,
    busy: false,
    onClose: vi.fn(),
    onLogin: vi.fn(),
    onRegister: vi.fn(),
    onLogout: vi.fn(),
    onRedeem: vi.fn(),
    onGenerateCode: vi.fn<() => Promise<GeneratedRedeemCode>>(),
    onResetPassword: vi.fn(),
    ...patch,
  };

  return { ...render(<AccountDialog {...props} />), props };
}

describe('AccountDialog', () => {
  it('does not render when closed', () => {
    renderDialog({ open: false });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders an accessible login form and submits its credentials', async () => {
    const onLogin = vi.fn();
    renderDialog({ onLogin });
    const interaction = userEvent.setup();

    expect(screen.getByRole('dialog', { name: '账户' }).getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('tab', { name: '登录' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('手机号').getAttribute('autocomplete')).toBe('tel');
    expect(screen.getByLabelText('密码').getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByText('忘记密码请联系管理员')).toBeTruthy();
    expect(screen.queryByLabelText('真实姓名')).toBeNull();
    expect(screen.queryByRole('button', { name: '重置用户密码' })).toBeNull();

    await interaction.type(screen.getByLabelText('手机号'), '13800138000');
    await interaction.type(screen.getByLabelText('密码'), 'password1');
    await interaction.click(screen.getByRole('button', { name: '登录账户' }));

    expect(onLogin).toHaveBeenCalledWith({ phone: '13800138000', password: 'password1' });
  });

  it('switches to registration and submits phone, password and real name', async () => {
    const onRegister = vi.fn();
    renderDialog({ onRegister });
    const interaction = userEvent.setup();

    await interaction.click(screen.getByRole('tab', { name: '注册' }));
    const registrationPhone = screen.getByLabelText('手机号') as HTMLInputElement;
    expect(registrationPhone.inputMode).toBe('numeric');
    expect(registrationPhone.maxLength).toBe(11);
    expect(registrationPhone.pattern).toBe('[0-9]{11}');
    expect(screen.getByLabelText('真实姓名').getAttribute('autocomplete')).toBe('name');
    expect(screen.getByLabelText('密码').getAttribute('autocomplete')).toBe('new-password');

    await interaction.type(screen.getByLabelText('手机号'), '13800138000');
    await interaction.type(screen.getByLabelText('真实姓名'), ' 张三 ');
    await interaction.type(screen.getByLabelText('密码'), 'password1');
    await interaction.click(screen.getByRole('button', { name: '创建账户' }));

    expect(onRegister).toHaveBeenCalledWith({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    });
  });

  it('shows account balances and allows a member to redeem and log out', async () => {
    const onRedeem = vi.fn();
    const onLogout = vi.fn();
    renderDialog({ user: member, onRedeem, onLogout });
    const interaction = userEvent.setup();

    expect(screen.getByText('张三')).toBeTruthy();
    expect(screen.getByText('13800138000')).toBeTruthy();
    expect(screen.getByLabelText('总积分').textContent).toContain('20');
    expect(screen.getByLabelText('可用积分').textContent).toContain('18');
    expect(screen.queryByRole('heading', { name: '生成兑换码' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重置用户密码' })).toBeNull();

    await interaction.type(screen.getByLabelText('兑换码'), ' Ab12Cd34 ');
    await interaction.click(screen.getByRole('button', { name: '兑换积分' }));
    await interaction.click(screen.getByRole('button', { name: '退出登录' }));

    expect(onRedeem).toHaveBeenCalledWith('Ab12Cd34');
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('lets an admin generate a positive decimal points code and shows only the latest code', async () => {
    const onGenerateCode = vi.fn()
      .mockResolvedValueOnce({ code: 'First123', points: 12.5 })
      .mockResolvedValueOnce({ code: 'Second45', points: 8 });
    renderDialog({ user: admin, onGenerateCode });
    const interaction = userEvent.setup();

    expect(screen.getByRole('heading', { name: '生成兑换码' })).toBeTruthy();
    const pointsInput = screen.getByLabelText('兑换积分额度');
    await interaction.clear(pointsInput);
    await interaction.type(pointsInput, '12.5');
    await interaction.click(screen.getByRole('button', { name: '生成兑换码' }));

    expect(onGenerateCode).toHaveBeenLastCalledWith(12.5);
    expect(await screen.findByText('First123')).toBeTruthy();

    await interaction.clear(pointsInput);
    await interaction.type(pointsInput, '8');
    await interaction.click(screen.getByRole('button', { name: '生成兑换码' }));

    expect(await screen.findByText('Second45')).toBeTruthy();
    expect(screen.queryByText('First123')).toBeNull();
  });

  it('rejects a non-positive admin points value without calling the callback', async () => {
    const onGenerateCode = vi.fn();
    renderDialog({ user: admin, onGenerateCode });
    const interaction = userEvent.setup();

    const pointsInput = screen.getByLabelText('兑换积分额度');
    await interaction.clear(pointsInput);
    await interaction.type(pointsInput, '0');
    fireEvent.submit(pointsInput.closest('form') as HTMLFormElement);

    expect(onGenerateCode).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('请输入大于 0 的积分额度');
  });

  it('cannot close while an admin redemption code is being generated', async () => {
    let resolveGeneration: (code: GeneratedRedeemCode) => void = () => {};
    const onGenerateCode = vi.fn(() => new Promise<GeneratedRedeemCode>((resolve) => {
      resolveGeneration = resolve;
    }));
    const onClose = vi.fn();
    renderDialog({ user: admin, onGenerateCode, onClose });

    fireEvent.submit(screen.getByLabelText('兑换积分额度').closest('form') as HTMLFormElement);
    await waitFor(() => expect(onGenerateCode).toHaveBeenCalledTimes(1));

    const closeButton = screen.getByRole('button', { name: '关闭账户窗口' }) as HTMLButtonElement;
    expect(closeButton.disabled).toBe(true);
    fireEvent.click(closeButton);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveGeneration({ code: 'Ready123', points: 10 });
      await Promise.resolve();
    });
    expect(closeButton.disabled).toBe(false);
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('provides an accessible admin-only password reset and locks the dialog while submitting', async () => {
    let resolveReset: () => void = () => {};
    const onResetPassword = vi.fn((_input: AdminResetPasswordInput) => new Promise<void>((resolve) => {
      resolveReset = resolve;
    }));
    const onClose = vi.fn();
    renderDialog({ user: admin, onResetPassword, onClose });
    const interaction = userEvent.setup();

    const toggle = screen.getByRole('button', { name: '重置用户密码' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await interaction.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('form', { name: '重置用户密码' })).toBeTruthy();
    expect(screen.getByText('重置后，该用户会从所有设备退出登录')).toBeTruthy();

    const phoneInput = screen.getByLabelText('用户手机号') as HTMLInputElement;
    const realNameInput = screen.getByLabelText('用户真实姓名') as HTMLInputElement;
    const passwordInput = screen.getByLabelText('用户新密码') as HTMLInputElement;
    expect(phoneInput.getAttribute('autocomplete')).toBe('tel');
    expect(phoneInput.inputMode).toBe('numeric');
    expect(phoneInput.maxLength).toBe(11);
    expect(phoneInput.pattern).toBe('[0-9]{11}');
    expect(realNameInput.getAttribute('autocomplete')).toBe('off');
    expect(passwordInput.getAttribute('autocomplete')).toBe('new-password');

    await interaction.type(phoneInput, '13900139000');
    await interaction.type(realNameInput, ' 李四 ');
    await interaction.type(passwordInput, 'replacement2');
    await interaction.click(screen.getByRole('button', { name: '确认重置密码' }));
    await waitFor(() => expect(onResetPassword).toHaveBeenCalledWith({
      phone: '13900139000',
      realName: '李四',
      newPassword: 'replacement2',
    }));

    const closeButton = screen.getByRole('button', { name: '关闭账户窗口' }) as HTMLButtonElement;
    const submitButton = screen.getByRole('button', { name: '正在重置' }) as HTMLButtonElement;
    expect(closeButton.disabled).toBe(true);
    expect(submitButton.disabled).toBe(true);
    fireEvent.click(submitButton);
    fireEvent.click(closeButton);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onResetPassword).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveReset();
      await Promise.resolve();
    });

    expect(phoneInput.value).toBe('');
    expect(realNameInput.value).toBe('');
    expect(passwordInput.value).toBe('');
    expect(screen.getByRole('status').textContent).toContain('密码已重置，该用户已从所有设备退出');
    expect(closeButton.disabled).toBe(false);
  });

  it('keeps the Chinese success confirmation visible when resetting self switches to login', async () => {
    function SelfResetHarness() {
      const [currentUser, setCurrentUser] = useState<AuthUser | null>(admin);
      return (
        <AccountDialog
          busy={false}
          onClose={vi.fn()}
          onGenerateCode={vi.fn()}
          onLogin={vi.fn()}
          onLogout={vi.fn()}
          onRedeem={vi.fn()}
          onRegister={vi.fn()}
          onResetPassword={async () => setCurrentUser(null)}
          open
          user={currentUser}
        />
      );
    }

    render(<SelfResetHarness />);
    const interaction = userEvent.setup();
    await interaction.click(screen.getByRole('button', { name: '重置用户密码' }));
    await interaction.type(screen.getByLabelText('用户手机号'), admin.phone);
    await interaction.type(screen.getByLabelText('用户真实姓名'), admin.realName);
    await interaction.type(screen.getByLabelText('用户新密码'), 'replacement2');
    await interaction.click(screen.getByRole('button', { name: '确认重置密码' }));

    expect(await screen.findByRole('tab', { name: '登录' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('密码已重置，该用户已从所有设备退出');
    expect(screen.queryByLabelText('用户新密码')).toBeNull();
  });

  it('disables mutating controls while busy and keeps the close escape route available', async () => {
    const onClose = vi.fn();
    renderDialog({ user: admin, busy: true, onClose });
    const interaction = userEvent.setup();

    expect((screen.getByLabelText('兑换码') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '兑换积分' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('兑换积分额度') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '退出登录' }) as HTMLButtonElement).disabled).toBe(true);

    await interaction.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses a compact mobile-safe dialog surface without nested card styling', () => {
    const { container } = renderDialog({ user: admin });
    const dialog = screen.getByRole('dialog');

    expect(dialog.className).toContain('w-[calc(100%-2rem)]');
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(dialog.className).toContain('rounded-lg');
    expect(dialog.querySelectorAll('.shadow-xl')).toHaveLength(0);
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});
