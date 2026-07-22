import { createServer } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAuthRoutes } from '../../server/authRoutes.js';
import { createServerConfig } from '../../server/config.js';

const originalEnv = { ...process.env };
const openServers = new Set();

afterEach(async () => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  await Promise.all([...openServers].map(server => new Promise(resolve => server.close(resolve))));
  openServers.clear();
});

function createAuthStub() {
  const ordinaryUser = {
    id: 'user-1',
    phone: '13800138000',
    realName: '张三',
    role: 'user',
    mediaPermissions: { imageGeneration: false, videoGeneration: false },
    createdAt: 1,
  };
  const adminUser = {
    id: 'admin-1',
    phone: '13900139000',
    realName: '管理员',
    role: 'admin',
    mediaPermissions: { imageGeneration: true, videoGeneration: true },
    createdAt: 2,
  };
  const users = new Map([[ordinaryUser.id, ordinaryUser], [adminUser.id, adminUser]]);
  const tokens = new Map([['user-token', ordinaryUser], ['admin-token', adminUser]]);
  const registeredCredentials = new Map();

  return {
    register: vi.fn(async ({ phone, password, realName }) => {
      const user = { ...ordinaryUser, id: 'registered-user', phone, realName };
      registeredCredentials.set(phone, { password, user });
      return user;
    }),
    login: vi.fn(async ({ phone, password }) => {
      const registered = registeredCredentials.get(phone);
      if (registered?.password === password) {
        tokens.set('registered-token', registered.user);
        return { token: 'registered-token', user: registered.user, expiresAt: Date.now() + 60_000 };
      }
      if (phone === adminUser.phone && password === 'adminpass1') {
        return { token: 'admin-token', user: adminUser, expiresAt: Date.now() + 60_000 };
      }
      if (phone === ordinaryUser.phone && password === 'password1') {
        return { token: 'user-token', user: ordinaryUser, expiresAt: Date.now() + 60_000 };
      }
      throw Object.assign(new Error('private detail'), { code: 'INVALID_CREDENTIALS' });
    }),
    getUserByToken: vi.fn(token => tokens.get(token) || null),
    logout: vi.fn(token => tokens.delete(token)),
    listUsers: vi.fn(() => [...users.values()]),
    updateMediaPermissions: vi.fn((userId, permissions) => {
      const user = users.get(userId);
      if (!user) throw Object.assign(new Error('missing'), { code: 'ACCOUNT_NOT_FOUND' });
      const updated = { ...user, mediaPermissions: permissions };
      users.set(userId, updated);
      return updated;
    }),
    resetPasswordByAdmin: vi.fn(async () => ordinaryUser),
  };
}

async function startApp(authService = createAuthStub()) {
  const app = express();
  registerAuthRoutes(app, {
    authService,
    cookieName: 'chat_session',
    cookieSecure: true,
    sessionTtlMs: 60_000,
    jsonParser: express.json({ limit: '16kb' }),
  });
  const server = createServer(app);
  openServers.add(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    authService,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function request(baseUrl, path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

describe('authentication HTTP routes', () => {
  it('registers and logs in while returning media permissions', async () => {
    const { baseUrl } = await startApp();
    const registered = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ phone: '13700137000', password: 'password1', realName: '李四' }),
    });
    expect(registered.status).toBe(201);
    expect((await registered.json()).user.mediaPermissions).toEqual({
      imageGeneration: false,
      videoGeneration: false,
    });

    const login = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: '13800138000', password: 'password1' }),
    });
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('chat_session=user-token');
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');
    expect(login.headers.get('set-cookie')).toContain('Secure');
  });

  it('returns the current account from the HttpOnly session cookie', async () => {
    const { baseUrl } = await startApp();
    const response = await request(baseUrl, '/api/auth/me', {
      headers: { Cookie: 'chat_session=user-token' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { id: 'user-1', role: 'user', mediaPermissions: { imageGeneration: false } },
    });
  });

  it('allows administrators to list accounts and grant permissions independently', async () => {
    const { baseUrl, authService } = await startApp();
    const headers = { Cookie: 'chat_session=admin-token' };
    const list = await request(baseUrl, '/api/admin/users', { headers });
    expect(list.status).toBe(200);
    expect((await list.json()).users).toHaveLength(2);

    const update = await request(baseUrl, '/api/admin/users/user-1/media-permissions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ imageGeneration: true, videoGeneration: false }),
    });
    expect(update.status).toBe(200);
    expect((await update.json()).user.mediaPermissions).toEqual({
      imageGeneration: true,
      videoGeneration: false,
    });
    expect(authService.updateMediaPermissions).toHaveBeenCalledWith('user-1', {
      imageGeneration: true,
      videoGeneration: false,
    });
  });

  it('rejects ordinary accounts from administrator permission APIs', async () => {
    const { baseUrl } = await startApp();
    const response = await request(baseUrl, '/api/admin/users', {
      headers: { Cookie: 'chat_session=user-token' },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: '无管理员权限' });
  });

  it('returns a fixed public error for invalid credentials', async () => {
    const { baseUrl } = await startApp();
    const response = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: '13800138000', password: 'wrongpass1' }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: '手机号或密码错误' });
  });

  it('does not expose removed points or redemption endpoints', async () => {
    const { baseUrl } = await startApp();
    for (const path of ['/api/points/balance', '/api/points/redeem', '/api/admin/redeem-codes']) {
      const response = await request(baseUrl, path, {
        headers: { Cookie: 'chat_session=admin-token' },
      });
      expect(response.status, path).toBe(404);
    }
  });
});

describe('authentication config', () => {
  it('does not require or expose the removed redemption secret', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      ADMIN_PHONE: '13800138000',
      ADMIN_BOOTSTRAP_PASSWORD: 'adminpass1',
      ADMIN_REAL_NAME: '管理员',
      REDEEM_CODE_HMAC_SECRET: '',
    };
    expect(createServerConfig('C:/app')).not.toHaveProperty('REDEEM_CODE_HMAC_SECRET');
  });
});
