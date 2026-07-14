// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { AiChatHeader } from './AiChatHeader';

afterEach(cleanup);

describe('AiChatHeader', () => {
  it('renders the product name with a soft sans-serif style and AI disclosure', () => {
    const { container } = render(<AiChatHeader user={null} onAccountClick={vi.fn()} />);

    const heading = screen.getByRole('heading', { name: '人工智障' });
    expect(heading.className).toContain('font-semibold');
    expect(heading.getAttribute('style')).toContain('Microsoft YaHei UI');
    expect(screen.getByText('内容由 AI 生成')).toBeTruthy();
    expect(container.querySelector('header')?.className).toContain('justify-center');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: '登录或注册' })).toBeTruthy();
  });

  it('shows available points without moving the centered product title', () => {
    const { container } = render(<AiChatHeader
      user={{
        id: 'user-1',
        phone: '13800138000',
        realName: '测试用户',
        role: 'user',
        points: 2,
        availablePoints: 1.8,
      }}
      onAccountClick={vi.fn()}
    />);

    expect(screen.getByRole('button', { name: '账户，当前可用 1.8 积分' })).toBeTruthy();
    expect(screen.getByText('1.8 积分')).toBeTruthy();
    expect(screen.getByText('测试用户')).toBeTruthy();
    expect(screen.getByText('测')).toBeTruthy();
    expect(container.querySelector('header')?.className).toContain('justify-center');
  });

  it('hides the account control while the sidebar is open so the controls cannot overlap', () => {
    render(<AiChatHeader user={null} sidebarOpen onAccountClick={vi.fn()} />);

    expect(screen.queryByRole('button', { name: '登录或注册' })).toBeNull();
  });

  it.each([
    ['loading', '正在确认登录状态', true],
    ['error', '登录状态异常，打开账户', false],
  ] as const)('exposes the %s authentication state in the account control', (authStatus, label, disabled) => {
    render(<AiChatHeader
      authStatus={authStatus}
      user={null}
      onAccountClick={vi.fn()}
    />);

    expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(disabled);
  });
});
