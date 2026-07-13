import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePointUnits } from '../../server/authRoutes.js';
import { createServerConfig } from '../../server/config.js';

const originalEnv = { ...process.env };
const TEST_REDEEM_SECRET = '0123456789abcdef0123456789abcdef';
const serverSource = readFileSync(
  fileURLToPath(new URL('../../server.js', import.meta.url)),
  'utf8',
);

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

function createAuthStub() {
  const users = new Map();
  const tokens = new Map();
  let nextId = 1;

  return {
    async register({ phone, password, realName }) {
      if (phone === '13800138099') {
        throw Object.assign(new Error('private duplicate detail'), {
          code: 'PHONE_ALREADY_REGISTERED',
        });
      }
      if (phone !== '13800138000' || password !== 'password1' || !realName) {
        throw Object.assign(new Error('private validation detail'), { code: 'INVALID_PHONE' });
      }
      const user = {
        id: `user-${nextId++}`,
        phone,
        realName,
        role: 'user',
        createdAt: 1_700_000_000_000,
      };
      users.set(phone, { ...user, password });
      return user;
    },
    async login({ phone, password }) {
      const stored = users.get(phone);
      if (!stored || stored.password !== password) {
        throw Object.assign(new Error('private credentials detail'), {
          code: 'INVALID_CREDENTIALS',
        });
      }
      const token = `token-${stored.id}`;
      const user = {
        id: stored.id,
        phone: stored.phone,
        realName: stored.realName,
        role: stored.role,
        createdAt: stored.createdAt,
      };
      tokens.set(token, user);
      return { token, user, expiresAt: 1_700_003_600_000 };
    },
    getUserByToken(token) {
      return tokens.get(token) || null;
    },
    logout(token) {
      return tokens.delete(token);
    },
    seedUser(user, password = 'password1') {
      users.set(user.phone, { ...user, password });
    },
  };
}

function createPointsStub() {
  const balances = new Map();
  const codes = [];

  return {
    getBalance(userId) {
      const balanceUnits = balances.get(userId) || 0;
      return { balanceUnits, availableUnits: balanceUnits };
    },
    redeemCode(userId, code) {
      if (code === 'used-code') {
        throw Object.assign(new Error('private used detail'), {
          code: 'REDEEM_CODE_ALREADY_USED',
        });
      }
      if (code !== 'Aa1Bb2Cc') {
        throw Object.assign(new Error('private invalid detail'), {
          code: 'INVALID_REDEEM_CODE',
        });
      }
      balances.set(userId, 25);
      return { creditedUnits: 25, balanceUnits: 25, availableUnits: 25 };
    },
    generateRedeemCode(units) {
      const generated = {
        id: `code-${codes.length + 1}`,
        code: 'Aa1Bb2Cc',
        maskedCode: '********',
        units,
        createdAt: 1_700_000_000_000,
      };
      codes.push({
        id: generated.id,
        maskedCode: generated.maskedCode,
        units,
        createdAt: generated.createdAt,
        used: false,
        usedBy: null,
        usedAt: null,
      });
      return generated;
    },
    listMaskedCodes() {
      return codes;
    },
  };
}

async function startApp(overrides = {}) {
  const { registerAuthRoutes } = await import('../../server/authRoutes.js');
  const app = express();
  app.set('trust proxy', true);
  const globalParserBeforeAuth = overrides.globalParserBeforeAuth ?? false;
  if (globalParserBeforeAuth) app.use(express.json());

  const authService = overrides.authService || createAuthStub();
  const pointsService = overrides.pointsService || createPointsStub();
  registerAuthRoutes(app, {
    authService,
    pointsService,
    cookieName: 'chat_session',
    cookieSecure: overrides.cookieSecure ?? true,
    sessionTtlMs: 3_600_000,
    rateLimitWindowMs: overrides.rateLimitWindowMs ?? 60_000,
    rateLimitMax: overrides.rateLimitMax ?? 20,
    now: overrides.now,
    jsonParser: express.json({ limit: overrides.authJsonLimit || '16kb' }),
  });

  if (!globalParserBeforeAuth) app.use(express.json({ limit: '50mb' }));

  app.get('/after-auth', (req, res) => {
    res.json({ authUser: req.authUser || null });
  });
  app.post('/after-auth', (req, res) => {
    res.json({ bodyLength: req.body?.payload?.length || 0 });
  });

  const server = createServer(app);
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    authService,
    baseUrl,
    async request(path, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      return fetch(`${baseUrl}${path}`, { ...options, headers });
    },
    close: () => new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    }),
  };
}

function cookiePair(response) {
  return response.headers.get('set-cookie').split(';', 1)[0];
}

async function registerAndGetCookie(harness) {
  const response = await harness.request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    }),
  });
  return { response, cookie: cookiePair(response) };
}

describe('authentication HTTP routes', () => {
  it('rejects point amounts above the single-code limit during parsing', () => {
    expect(parsePointUnits('1000000')).toBe(10_000_000);
    expect(parsePointUnits('1000000.1')).toBeNull();
  });

  it('registers auth routes with a small parser before the global large parser', () => {
    const authRoutesIndex = serverSource.indexOf('registerAuthRoutes(app');
    const globalParserIndex = serverSource.indexOf("app.use(express.json({ limit: '50mb' }))");

    expect(authRoutesIndex).toBeGreaterThan(-1);
    expect(globalParserIndex).toBeGreaterThan(authRoutesIndex);
    expect(serverSource).toContain("jsonParser: express.json({ limit: '16kb' })");
  });

  it('accepts a valid auth body near the small-parser limit', async () => {
    const authService = createAuthStub();
    const register = vi.spyOn(authService, 'register');
    const harness = await startApp({ authService, globalParserBeforeAuth: false });
    try {
      const response = await harness.request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          phone: '13800138000',
          password: 'password1',
          realName: '张三',
          padding: 'x'.repeat(15 * 1_024),
        }),
      });

      expect(response.status).toBe(201);
      expect(register).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });

  it.each([
    '/api/auth/login',
    '/api/points/redeem',
    '/api/admin/redeem-codes',
    '/api/admin/users/reset-password',
  ])('rejects oversized JSON on %s before entering business logic', async route => {
    const authService = createAuthStub();
    const pointsService = createPointsStub();
    const getUserByToken = vi.spyOn(authService, 'getUserByToken');
    const login = vi.spyOn(authService, 'login');
    const redeemCode = vi.spyOn(pointsService, 'redeemCode');
    const generateRedeemCode = vi.spyOn(pointsService, 'generateRedeemCode');
    const harness = await startApp({
      authService,
      pointsService,
      globalParserBeforeAuth: false,
    });
    try {
      const response = await harness.request(route, {
        method: 'POST',
        body: JSON.stringify({ payload: 'x'.repeat(17 * 1_024) }),
      });

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: '请求内容过大' });
      expect(getUserByToken).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();
      expect(redeemCode).not.toHaveBeenCalled();
      expect(generateRedeemCode).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it.each([
    '/api/auth/login',
    '/api/points/redeem',
    '/api/admin/redeem-codes',
    '/api/admin/users/reset-password',
  ])('rejects malformed JSON on %s before entering business logic', async route => {
    const authService = createAuthStub();
    const pointsService = createPointsStub();
    const getUserByToken = vi.spyOn(authService, 'getUserByToken');
    const harness = await startApp({
      authService,
      pointsService,
      globalParserBeforeAuth: false,
    });
    try {
      const response = await harness.request(route, {
        method: 'POST',
        body: '{"invalidJson":',
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: '请求内容格式错误' });
      expect(getUserByToken).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it('leaves the later large parser available to non-auth routes', async () => {
    const harness = await startApp({ globalParserBeforeAuth: false });
    try {
      const response = await harness.request('/after-auth', {
        method: 'POST',
        body: JSON.stringify({ payload: 'x'.repeat(20 * 1_024) }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ bodyLength: 20 * 1_024 });
    } finally {
      await harness.close();
    }
  });

  it('registers, logs in automatically, and sets the configured hardened cookie', async () => {
    const harness = await startApp();
    try {
      const { response } = await registerAndGetCookie(harness);

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        user: {
          id: 'user-1',
          phone: '13800138000',
          realName: '张三',
          role: 'user',
          createdAt: 1_700_000_000_000,
          points: 0,
          availablePoints: 0,
        },
      });
      expect(response.headers.get('set-cookie')).toContain('chat_session=token-user-1');
      expect(response.headers.get('set-cookie')).toContain('Max-Age=3600');
      expect(response.headers.get('set-cookie')).toContain('Path=/');
      expect(response.headers.get('set-cookie')).toContain('HttpOnly');
      expect(response.headers.get('set-cookie')).toContain('Secure');
      expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
    } finally {
      await harness.close();
    }
  });

  it('logs in, resolves cookie identity for later routes, and reports the current user', async () => {
    const authService = createAuthStub();
    authService.seedUser({
      id: 'existing-user',
      phone: '13800138000',
      realName: '李四',
      role: 'user',
      createdAt: 1_600_000_000_000,
    });
    const harness = await startApp({ authService, cookieSecure: false });
    try {
      const login = await harness.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone: '13800138000', password: 'password1' }),
      });
      const cookie = cookiePair(login);

      expect(login.status).toBe(200);
      expect(login.headers.get('set-cookie')).not.toContain('Secure');

      const me = await harness.request('/api/auth/me', { headers: { Cookie: cookie } });
      const downstream = await harness.request('/after-auth', { headers: { Cookie: cookie } });
      expect(await me.json()).toMatchObject({
        user: { id: 'existing-user', points: 0, availablePoints: 0 },
      });
      expect(await downstream.json()).toMatchObject({
        authUser: { id: 'existing-user', phone: '13800138000' },
      });
    } finally {
      await harness.close();
    }
  });

  it('returns a null user without authentication and clears the cookie on logout', async () => {
    const harness = await startApp();
    try {
      const anonymousMe = await harness.request('/api/auth/me');
      expect(anonymousMe.status).toBe(200);
      expect(await anonymousMe.json()).toEqual({ user: null });

      const { cookie } = await registerAndGetCookie(harness);
      const logout = await harness.request('/api/auth/logout', {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      expect(logout.status).toBe(200);
      expect(await logout.json()).toEqual({ ok: true });
      expect(logout.headers.get('set-cookie')).toContain('chat_session=');
      expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');

      const me = await harness.request('/api/auth/me', { headers: { Cookie: cookie } });
      expect(await me.json()).toEqual({ user: null });
    } finally {
      await harness.close();
    }
  });

  it('requires login to redeem a code and returns the updated public balance', async () => {
    const harness = await startApp();
    try {
      const anonymous = await harness.request('/api/points/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: 'Aa1Bb2Cc' }),
      });
      expect(anonymous.status).toBe(401);
      expect(await anonymous.json()).toEqual({ error: '请先登录' });

      const { cookie } = await registerAndGetCookie(harness);
      const redeemed = await harness.request('/api/points/redeem', {
        method: 'POST',
        headers: { Cookie: cookie },
        body: JSON.stringify({ code: 'Aa1Bb2Cc' }),
      });
      expect(redeemed.status).toBe(200);
      expect(await redeemed.json()).toMatchObject({
        user: { id: 'user-1', points: 2.5, availablePoints: 2.5 },
      });
    } finally {
      await harness.close();
    }
  });

  it('maps a balance overflow during redemption to a fixed Chinese conflict error', async () => {
    const pointsService = createPointsStub();
    pointsService.redeemCode = vi.fn(() => {
      throw Object.assign(new Error('private overflow detail'), {
        code: 'POINT_BALANCE_LIMIT_EXCEEDED',
      });
    });
    const harness = await startApp({ pointsService });
    try {
      const { cookie } = await registerAndGetCookie(harness);
      const response = await harness.request('/api/points/redeem', {
        method: 'POST',
        headers: { Cookie: cookie },
        body: JSON.stringify({ code: 'Aa1Bb2Cc' }),
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: '积分余额已达上限' });
    } finally {
      await harness.close();
    }
  });

  it('allows only administrators to generate and list masked redeem codes', async () => {
    const authService = createAuthStub();
    authService.seedUser({
      id: 'admin-1',
      phone: '13800138000',
      realName: '管理员',
      role: 'admin',
      createdAt: 1_600_000_000_000,
    });
    const harness = await startApp({ authService });
    try {
      const login = await harness.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone: '13800138000', password: 'password1' }),
      });
      const cookie = cookiePair(login);

      const generated = await harness.request('/api/admin/redeem-codes', {
        method: 'POST',
        headers: { Cookie: cookie },
        body: JSON.stringify({ points: 2.5 }),
      });
      expect(generated.status).toBe(201);
      expect(await generated.json()).toEqual({ code: 'Aa1Bb2Cc', points: 2.5 });

      const listed = await harness.request('/api/admin/redeem-codes', {
        headers: { Cookie: cookie },
      });
      expect(await listed.json()).toEqual({
        codes: [{
          id: 'code-1',
          maskedCode: '********',
          points: 2.5,
          createdAt: 1_700_000_000_000,
          used: false,
          usedBy: null,
          usedAt: null,
        }],
      });
    } finally {
      await harness.close();
    }
  });

  it('rejects non-administrators and invalid point precision with fixed Chinese errors', async () => {
    const harness = await startApp();
    try {
      const { cookie } = await registerAndGetCookie(harness);
      const forbidden = await harness.request('/api/admin/redeem-codes', {
        headers: { Cookie: cookie },
      });
      expect(forbidden.status).toBe(403);
      expect(await forbidden.json()).toEqual({ error: '无管理员权限' });

      const authService = createAuthStub();
      authService.seedUser({
        id: 'admin-1',
        phone: '13800138000',
        realName: '管理员',
        role: 'admin',
        createdAt: 1,
      });
      const adminHarness = await startApp({ authService });
      try {
        const login = await adminHarness.request('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ phone: '13800138000', password: 'password1' }),
        });
        const invalid = await adminHarness.request('/api/admin/redeem-codes', {
          method: 'POST',
          headers: { Cookie: cookiePair(login) },
          body: JSON.stringify({ points: 1.25 }),
        });
        expect(invalid.status).toBe(422);
        expect(await invalid.json()).toEqual({
          error: '积分必须为 0.1 至 1000000，且最多保留一位小数',
        });
      } finally {
        await adminHarness.close();
      }
    } finally {
      await harness.close();
    }
  });

  it('rejects an over-limit redeem code before calling the points service', async () => {
    const authService = createAuthStub();
    authService.seedUser({
      id: 'admin-1',
      phone: '13800138000',
      realName: '管理员',
      role: 'admin',
      createdAt: 1,
    });
    const pointsService = createPointsStub();
    const generateRedeemCode = vi.spyOn(pointsService, 'generateRedeemCode');
    const harness = await startApp({ authService, pointsService });
    try {
      const login = await harness.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone: '13800138000', password: 'password1' }),
      });
      const response = await harness.request('/api/admin/redeem-codes', {
        method: 'POST',
        headers: { Cookie: cookiePair(login) },
        body: JSON.stringify({ points: 1_000_000.1 }),
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: '积分必须为 0.1 至 1000000，且最多保留一位小数',
      });
      expect(generateRedeemCode).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it('maps the unused redeem-code hard limit to a fixed Chinese conflict error', async () => {
    const authService = createAuthStub();
    authService.seedUser({
      id: 'admin-1',
      phone: '13800138000',
      realName: '管理员',
      role: 'admin',
      createdAt: 1,
    });
    const pointsService = createPointsStub();
    pointsService.generateRedeemCode = () => {
      throw Object.assign(new Error('private capacity detail'), {
        code: 'REDEEM_CODE_LIMIT_REACHED',
      });
    };
    const harness = await startApp({ authService, pointsService });
    try {
      const login = await harness.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone: '13800138000', password: 'password1' }),
      });
      const response = await harness.request('/api/admin/redeem-codes', {
        method: 'POST',
        headers: { Cookie: cookiePair(login) },
        body: JSON.stringify({ points: 1 }),
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: '未使用兑换码数量已达上限，请先使用现有码' });
    } finally {
      await harness.close();
    }
  });

  it('allows an administrator to reset a verified account without returning password material', async () => {
    const authService = createAuthStub();
    authService.seedUser({
      id: 'admin-1',
      phone: '13800138000',
      realName: '管理员',
      role: 'admin',
      createdAt: 1,
    });
    authService.resetPasswordByAdmin = vi.fn().mockResolvedValue({
      id: 'user-2',
      phone: '13900139000',
      realName: '张三',
      role: 'user',
      createdAt: 2,
    });
    const harness = await startApp({ authService });
    try {
      const login = await harness.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone: '13800138000', password: 'password1' }),
      });
      const response = await harness.request('/api/admin/users/reset-password', {
        method: 'POST',
        headers: { Cookie: cookiePair(login) },
        body: JSON.stringify({
          phone: '13900139000',
          realName: '张三',
          newPassword: 'replacement2',
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(authService.resetPasswordByAdmin).toHaveBeenCalledWith({
        phone: '13900139000',
        realName: '张三',
        newPassword: 'replacement2',
      });
      expect(body).toMatchObject({ ok: true, user: { id: 'user-2', phone: '13900139000' } });
      expect(JSON.stringify(body)).not.toMatch(/password|hash|salt|replacement2/iu);
    } finally {
      await harness.close();
    }
  });

  it('allows an administrator to reset their own password and clears the current cookie', async () => {
    const authService = createAuthStub();
    const admin = {
      id: 'admin-1',
      phone: '13800138000',
      realName: '管理员',
      role: 'admin',
      createdAt: 1,
    };
    authService.seedUser(admin);
    authService.resetPasswordByAdmin = vi.fn().mockResolvedValue(admin);
    const harness = await startApp({ authService });
    try {
      const login = await harness.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone: admin.phone, password: 'password1' }),
      });
      const response = await harness.request('/api/admin/users/reset-password', {
        method: 'POST',
        headers: { Cookie: cookiePair(login) },
        body: JSON.stringify({
          phone: admin.phone,
          realName: admin.realName,
          newPassword: 'replacement2',
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
      expect(authService.resetPasswordByAdmin).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });

  it('rejects guests, non-administrators, and identity mismatches with fixed Chinese errors', async () => {
    const userHarness = await startApp();
    try {
      const guest = await userHarness.request('/api/admin/users/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          phone: '13900139000',
          realName: '张三',
          newPassword: 'replacement2',
        }),
      });
      expect(guest.status).toBe(401);
      expect(await guest.json()).toEqual({ error: '请先登录' });

      const { cookie } = await registerAndGetCookie(userHarness);
      const forbidden = await userHarness.request('/api/admin/users/reset-password', {
        method: 'POST',
        headers: { Cookie: cookie },
        body: JSON.stringify({
          phone: '13900139000',
          realName: '张三',
          newPassword: 'replacement2',
        }),
      });
      expect(forbidden.status).toBe(403);
      expect(await forbidden.json()).toEqual({ error: '无管理员权限' });
    } finally {
      await userHarness.close();
    }

    const authService = createAuthStub();
    authService.seedUser({
      id: 'admin-1',
      phone: '13800138000',
      realName: '管理员',
      role: 'admin',
      createdAt: 1,
    });
    authService.resetPasswordByAdmin = vi.fn().mockRejectedValue(
      Object.assign(new Error('private identity detail'), { code: 'ACCOUNT_IDENTITY_MISMATCH' }),
    );
    const adminHarness = await startApp({ authService });
    try {
      const login = await adminHarness.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone: '13800138000', password: 'password1' }),
      });
      const mismatch = await adminHarness.request('/api/admin/users/reset-password', {
        method: 'POST',
        headers: { Cookie: cookiePair(login) },
        body: JSON.stringify({
          phone: '13900139000',
          realName: '错误姓名',
          newPassword: 'replacement2',
        }),
      });
      const body = await mismatch.json();

      expect(mismatch.status).toBe(404);
      expect(body).toEqual({ error: '手机号或真实姓名不匹配' });
      expect(JSON.stringify(body)).not.toContain('private');
    } finally {
      await adminHarness.close();
    }
  });

  it('does not expose a phone-and-name self-service password reset route', async () => {
    const authService = createAuthStub();
    authService.resetPasswordByAdmin = vi.fn();
    const harness = await startApp({ authService });
    try {
      const response = await harness.request('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          phone: '13800138000',
          realName: '张三',
          newPassword: 'replacement2',
        }),
      });

      expect(response.status).toBe(404);
      expect(authService.resetPasswordByAdmin).not.toHaveBeenCalled();
      expect(serverSource).not.toContain("app.post('/api/auth/reset-password'");
    } finally {
      await harness.close();
    }
  });

  it('maps domain failures to fixed Chinese messages without exposing private details', async () => {
    const harness = await startApp();
    try {
      const duplicate = await harness.request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          phone: '13800138099',
          password: 'password1',
          realName: '张三',
        }),
      });
      expect(duplicate.status).toBe(409);
      const duplicateBody = await duplicate.json();
      expect(duplicateBody).toEqual({ error: '该手机号已注册' });

      const badLogin = await harness.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone: '13800138000', password: 'wrong' }),
      });
      expect(badLogin.status).toBe(401);
      expect(await badLogin.json()).toEqual({ error: '手机号或密码错误' });
      expect(JSON.stringify(duplicateBody)).not.toContain('private');
    } finally {
      await harness.close();
    }
  });

  it('rate limits register and login together per IP and resets after the window', async () => {
    let now = 1_000;
    const harness = await startApp({
      now: () => now,
      rateLimitMax: 2,
      rateLimitWindowMs: 1_000,
    });
    try {
      const requestOptions = {
        method: 'POST',
        headers: { 'X-Forwarded-For': '203.0.113.9' },
        body: JSON.stringify({ phone: 'bad', password: 'bad' }),
      };
      expect((await harness.request('/api/auth/login', requestOptions)).status).toBe(401);
      expect((await harness.request('/api/auth/register', requestOptions)).status).toBe(422);

      const limited = await harness.request('/api/auth/login', requestOptions);
      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({ error: '请求过于频繁，请稍后重试' });
      expect(limited.headers.get('retry-after')).toBe('1');

      now = 2_000;
      expect((await harness.request('/api/auth/login', requestOptions)).status).toBe(401);
    } finally {
      await harness.close();
    }
  });
});

describe('authentication config', () => {
  it('uses secure production defaults and exposes all auth settings', () => {
    process.env = {
      NODE_ENV: 'production',
      REDEEM_CODE_HMAC_SECRET: TEST_REDEEM_SECRET,
    };

    expect(createServerConfig('C:/app')).toMatchObject({
      AUTH_COOKIE_NAME: 'chat_auth',
      AUTH_COOKIE_SECURE: true,
      AUTH_SESSION_TTL_MS: 2_592_000_000,
      AUTH_RATE_LIMIT_WINDOW_MS: 900_000,
      AUTH_RATE_LIMIT_MAX: 10,
      ADMIN_PHONE: '',
      ADMIN_BOOTSTRAP_PASSWORD: '',
      ADMIN_REAL_NAME: '',
      REDEEM_CODE_HMAC_SECRET: TEST_REDEEM_SECRET,
    });
  });

  it('requires a production redeem-code secret and rejects configured secrets shorter than 32 bytes', () => {
    process.env = { NODE_ENV: 'production' };
    expect(() => createServerConfig('C:/app')).toThrow(
      'REDEEM_CODE_HMAC_SECRET is required in production',
    );

    process.env = {
      NODE_ENV: 'development',
      REDEEM_CODE_HMAC_SECRET: 'short-secret',
    };
    expect(() => createServerConfig('C:/app')).toThrow(
      'REDEEM_CODE_HMAC_SECRET must contain at least 32 bytes',
    );
  });

  it('reads explicit auth settings and strictly rejects malformed values', () => {
    process.env = {
      AUTH_COOKIE_NAME: 'custom_cookie',
      AUTH_COOKIE_SECURE: 'false',
      AUTH_SESSION_TTL_MS: '60000',
      AUTH_RATE_LIMIT_WINDOW_MS: '30000',
      AUTH_RATE_LIMIT_MAX: '4',
      ADMIN_PHONE: ' 13800138000 ',
      ADMIN_BOOTSTRAP_PASSWORD: 'secret-value',
      ADMIN_REAL_NAME: ' 管理员 ',
      REDEEM_CODE_HMAC_SECRET: TEST_REDEEM_SECRET,
    };

    expect(createServerConfig('C:/app')).toMatchObject({
      AUTH_COOKIE_NAME: 'custom_cookie',
      AUTH_COOKIE_SECURE: false,
      AUTH_SESSION_TTL_MS: 60_000,
      AUTH_RATE_LIMIT_WINDOW_MS: 30_000,
      AUTH_RATE_LIMIT_MAX: 4,
      ADMIN_PHONE: '13800138000',
      ADMIN_BOOTSTRAP_PASSWORD: 'secret-value',
      ADMIN_REAL_NAME: '管理员',
      REDEEM_CODE_HMAC_SECRET: TEST_REDEEM_SECRET,
    });

    process.env.AUTH_COOKIE_SECURE = 'sometimes';
    expect(() => createServerConfig('C:/app')).toThrow('AUTH_COOKIE_SECURE must be true or false');
  });
});
