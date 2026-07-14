import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  adminResetPassword,
  fetchCurrentUser,
  fetchPointTransactions,
  fetchRedeemCodes,
  generateRedeemCode,
  login,
  logout,
  redeemCode,
  register,
} from './authApi';
import type {
  AdminResetPasswordInput,
  AdminResetPasswordResult,
  AuthUser,
  PointTransactionRecord,
  RedeemCodeRecord,
} from './authApi';
import { subscribeToSessionExpired } from './http';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fetchMock() {
  return vi.mocked(fetch);
}

const user: AuthUser = {
  id: 'user-1',
  phone: '13800138000',
  realName: '张三',
  role: 'user',
  points: 20,
  availablePoints: 18,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auth API', () => {
  it('loads the current same-origin cookie session', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ user }));

    await expect(fetchCurrentUser()).resolves.toEqual(user);
    expect(fetchMock()).toHaveBeenCalledWith('/api/auth/me', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  });

  it('returns null when there is no authenticated user', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ user: null }));

    await expect(fetchCurrentUser()).resolves.toBeNull();
  });

  it.each([
    {
      name: 'login',
      request: () => login({ phone: '13800138000', password: 'password1' }),
      path: '/api/auth/login',
      body: { phone: '13800138000', password: 'password1' },
    },
    {
      name: 'registration',
      request: () => register({
        phone: '13800138000',
        password: 'password1',
        realName: '张三',
      }),
      path: '/api/auth/register',
      body: { phone: '13800138000', password: 'password1', realName: '张三' },
    },
  ])('sends $name as same-origin JSON and returns the user', async ({ request, path, body }) => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ user }));

    await expect(request()).resolves.toEqual(user);
    expect(fetchMock()).toHaveBeenCalledWith(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  });

  it('logs out with an empty JSON POST', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(logout()).resolves.toBeUndefined();
    expect(fetchMock()).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  });

  it('does not retry an auth POST and localizes a network failure', async () => {
    fetchMock().mockRejectedValue(new TypeError('fetch failed'));

    await expect(login({ phone: '13800138000', password: 'password1' }))
      .rejects.toThrow('网络连接失败，请检查网络后重试');
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('redeems a code and returns the refreshed user', async () => {
    const creditedUser = { ...user, points: 30, availablePoints: 28 };
    fetchMock().mockResolvedValueOnce(jsonResponse({ user: creditedUser }));

    await expect(redeemCode('Ab12Cd34')).resolves.toEqual(creditedUser);
    expect(fetchMock()).toHaveBeenCalledWith('/api/points/redeem', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: 'Ab12Cd34' }),
    });
  });

  it('loads the signed-in user point activity', async () => {
    const transactions: PointTransactionRecord[] = [{
      id: 'point-1',
      type: 'debit',
      points: -1.5,
      costPoints: 1.5,
      taskType: 'video',
      reason: null,
      balance: 8.5,
      availablePoints: 8.5,
      createdAt: 1_700_000_000_000,
    }];
    fetchMock().mockResolvedValueOnce(jsonResponse({ transactions }));

    await expect(fetchPointTransactions()).resolves.toEqual(transactions);
    expect(fetchMock()).toHaveBeenCalledWith('/api/points/transactions', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  });

  it('generates and lists masked admin redemption codes', async () => {
    const generated = { code: 'Xy12Za34', points: 12.5 };
    const records: RedeemCodeRecord[] = [{
      id: 'code-1',
      maskedCode: '********',
      points: 12.5,
      createdAt: 1_700_000_000_000,
      used: false,
      usedBy: null,
      usedAt: null,
    }];
    fetchMock()
      .mockResolvedValueOnce(jsonResponse(generated))
      .mockResolvedValueOnce(jsonResponse({ codes: records }));

    await expect(generateRedeemCode(12.5)).resolves.toEqual(generated);
    await expect(fetchRedeemCodes()).resolves.toEqual(records);
    expect(fetchMock()).toHaveBeenNthCalledWith(1, '/api/admin/redeem-codes', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ points: 12.5 }),
    });
    expect(fetchMock()).toHaveBeenNthCalledWith(2, '/api/admin/redeem-codes', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  });

  it('lets an admin reset a verified user password through the protected route', async () => {
    const resetResult: AdminResetPasswordResult = {
      ok: true,
      user: {
        id: 'user-2',
        phone: '13900139000',
        realName: '李四',
        role: 'user',
      },
    };
    fetchMock().mockResolvedValueOnce(jsonResponse(resetResult));

    await expect(adminResetPassword('13900139000', '李四', 'replacement2'))
      .resolves.toEqual(resetResult);
    expect(fetchMock()).toHaveBeenCalledWith('/api/admin/users/reset-password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: '13900139000',
        realName: '李四',
        newPassword: 'replacement2',
      }),
    });
  });

  it('surfaces the structured server error for a failed request', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ error: '手机号或密码错误' }, 401));

    await expect(login({ phone: '13800138000', password: 'wrong' }))
      .rejects.toThrow('手机号或密码错误');
  });

  it('reports a protected-request 401 but not invalid login credentials as session expiry', async () => {
    const onSessionExpired = vi.fn();
    const unsubscribe = subscribeToSessionExpired(onSessionExpired);
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({ error: '登录已过期' }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: '手机号或密码错误' }, 401));

    await expect(redeemCode('Expired1')).rejects.toThrow('登录已过期');
    await expect(login({ phone: '13800138000', password: 'wrong' }))
      .rejects.toThrow('手机号或密码错误');

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('uses a stable fallback when an error response is not JSON', async () => {
    fetchMock().mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }));

    await expect(fetchCurrentUser()).rejects.toThrow('请求失败，请稍后重试');
  });

  it('exposes the exact public user shape', () => {
    expectTypeOf<AuthUser>().toEqualTypeOf<{
      id: string;
      phone: string;
      realName: string;
      role: 'user' | 'admin';
      points: number;
      availablePoints: number;
    }>();
  });

  it('exposes only masked admin redemption-code records', () => {
    expectTypeOf<RedeemCodeRecord>().toEqualTypeOf<{
      id: string;
      maskedCode: string;
      points: number;
      createdAt: string | number;
      used: boolean;
      usedBy: string | null;
      usedAt: string | number | null;
    }>();
  });

  it('exposes typed administrator password-reset inputs and results', () => {
    expectTypeOf<AdminResetPasswordInput>().toEqualTypeOf<{
      phone: string;
      realName: string;
      newPassword: string;
    }>();
    expectTypeOf<AdminResetPasswordResult>().toEqualTypeOf<{
      ok: true;
      user: {
        id: string;
        phone: string;
        realName: string;
        role: 'user' | 'admin';
      };
    }>();
  });
});
