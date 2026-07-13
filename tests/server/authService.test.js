import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAuthService } from '../../server/authService.js';
import { createEmptyData, normalizeData } from '../../server/storage.js';

function createHarness(overrides = {}) {
  let currentTime = overrides.currentTime ?? 1_700_000_000_000;
  const data = createEmptyData();
  const saveData = overrides.saveData ?? vi.fn();
  const auth = createAuthService({
    data,
    saveData,
    now: () => currentTime,
    sessionTtlMs: overrides.sessionTtlMs,
  });

  return {
    auth,
    data,
    saveData,
    setTime(value) {
      currentTime = value;
    },
  };
}

describe('authentication storage', () => {
  it('creates all authentication and points collections', () => {
    expect(createEmptyData()).toEqual({
      aiSessions: {},
      videoJobs: {},
      mediaRequests: {},
      authUsers: {},
      authSessions: {},
      redeemCodes: {},
      pointReservations: {},
      pointTransactions: [],
    });
  });

  it('removes legacy social data without discarding AI, authentication, or unknown fields', () => {
    const legacy = {
      aiSessions: { owner: [{ id: 'session-1' }] },
      videoJobs: { job: { status: 'queued' } },
      customSetting: true,
      users: { legacy: { phone: '13800138000', password: 'plaintext-secret' } },
      accounts: { legacy: { password: 'another-secret' } },
      friendChats: { legacy: [{ content: 'private message' }] },
      announcement: { content: 'legacy announcement' },
      videoCalls: { legacy: { status: 'connected' } },
      authUsers: { current: { id: 'current', phone: '13900139000' } },
      authSessions: { session: { userId: 'current' } },
      redeemCodes: { code: { hash: 'hash' } },
      pointReservations: { reservation: { userId: 'current' } },
      pointTransactions: [],
    };

    const normalized = normalizeData(legacy);

    expect(normalized).toEqual({
      aiSessions: { owner: [{ id: 'session-1' }] },
      videoJobs: { job: { status: 'queued' } },
      mediaRequests: {},
      authUsers: { current: { id: 'current', phone: '13900139000' } },
      authSessions: { session: { userId: 'current' } },
      redeemCodes: { code: { hash: 'hash' } },
      pointReservations: { reservation: { userId: 'current' } },
      pointTransactions: [],
      customSetting: true,
    });
    expect(JSON.stringify(normalized)).not.toContain('plaintext-secret');
    expect(JSON.stringify(normalized)).not.toContain('another-secret');
  });
});

describe('createAuthService', () => {
  it('initializes missing authentication collections', () => {
    const data = {};

    createAuthService({ data, saveData: vi.fn() });

    expect(data).toEqual({ authUsers: {}, authSessions: {} });
  });

  it.each([
    { collection: 'authUsers', invalidValue: [], kind: 'an array' },
    { collection: 'authUsers', invalidValue: 'corrupted', kind: 'a scalar' },
    { collection: 'authUsers', invalidValue: null, kind: 'null' },
    { collection: 'authSessions', invalidValue: [], kind: 'an array' },
    { collection: 'authSessions', invalidValue: 'corrupted', kind: 'a scalar' },
    { collection: 'authSessions', invalidValue: null, kind: 'null' },
  ])('fails closed when $collection is $kind', ({ collection, invalidValue }) => {
    const data = { [collection]: invalidValue };
    const before = { ...data };

    expect(() => createAuthService({ data, saveData: vi.fn() })).toThrow(TypeError);
    expect(data).toEqual(before);
    expect(data[collection]).toBe(invalidValue);
  });

  it('registers a public user and persists only scrypt password material', async () => {
    const { auth, data, saveData } = createHarness();

    const user = await auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张 三·Alice',
    });

    expect(user).toMatchObject({
      phone: '13800138000',
      realName: '张 三·Alice',
      role: 'user',
      createdAt: 1_700_000_000_000,
    });
    expect(user).not.toHaveProperty('password');
    expect(user).not.toHaveProperty('passwordHash');
    expect(user).not.toHaveProperty('passwordSalt');

    const storedUser = data.authUsers[user.id];
    expect(storedUser.passwordHash).toMatch(/^[a-f0-9]{128}$/u);
    expect(storedUser.passwordSalt).toMatch(/^[a-f0-9]+$/u);
    expect(JSON.stringify(data)).not.toContain('password1');
    expect(saveData).toHaveBeenCalledWith(data);
  });

  it.each([
    ['12800138000', 'password1', '张三', 'INVALID_PHONE'],
    ['1380013800', 'password1', '张三', 'INVALID_PHONE'],
    ['13800138000', 'short1', '张三', 'INVALID_PASSWORD'],
    ['13800138000', 'abcdefgh', '张三', 'INVALID_PASSWORD'],
    ['13800138000', '12345678', '张三', 'INVALID_PASSWORD'],
    ['13800138000', `${'a'.repeat(72)}1`, '张三', 'INVALID_PASSWORD'],
    ['13800138000', 'password1', '张', 'INVALID_REAL_NAME'],
    ['13800138000', 'password1', `${'张'.repeat(31)}`, 'INVALID_REAL_NAME'],
    ['13800138000', 'password1', '张三1', 'INVALID_REAL_NAME'],
    ['13800138000', 'password1', '张_三', 'INVALID_REAL_NAME'],
  ])('rejects invalid registration fields %#', async (phone, password, realName, code) => {
    const { auth } = createHarness();

    await expect(auth.register({ phone, password, realName }))
      .rejects.toMatchObject({ code });
  });

  it('rejects an obviously long password before iterating over its characters', async () => {
    const { auth } = createHarness();
    const originalArrayFrom = Array.from;
    const unexpectedIteration = new Error('oversized password was iterated');
    const arrayFrom = vi.spyOn(Array, 'from').mockImplementation((value, ...args) => {
      if (typeof value === 'string' && value.length > 1_000) throw unexpectedIteration;
      return Reflect.apply(originalArrayFrom, Array, [value, ...args]);
    });
    let caughtError;

    try {
      await auth.register({
        phone: '13800138000',
        password: `a1${'x'.repeat(1_000_000)}`,
        realName: '张三',
      });
    } catch (error) {
      caughtError = error;
    } finally {
      arrayFrom.mockRestore();
    }

    expect(caughtError).toMatchObject({ code: 'INVALID_PASSWORD' });
    expect(caughtError).not.toBe(unexpectedIteration);
  });

  it.each([
    ['phone', { phone: `13800138000${' '.repeat(1_000_000)}`, password: 'password1', realName: '张三' }, 'INVALID_PHONE'],
    ['real name', { phone: '13800138000', password: 'password1', realName: `张三${' '.repeat(1_000_000)}` }, 'INVALID_REAL_NAME'],
  ])('rejects an obviously long %s before trimming it', async (_label, details, code) => {
    const { auth } = createHarness();
    const originalTrim = String.prototype.trim;
    const unexpectedTrim = new Error('oversized string was trimmed');
    const trim = vi.spyOn(String.prototype, 'trim').mockImplementation(function trimInput() {
      if (String(this).length > 1_000) throw unexpectedTrim;
      return Reflect.apply(originalTrim, this, []);
    });
    let caughtError;

    try {
      await auth.register(details);
    } catch (error) {
      caughtError = error;
    } finally {
      trim.mockRestore();
    }

    expect(caughtError).toMatchObject({ code });
    expect(caughtError).not.toBe(unexpectedTrim);
  });

  it('rejects an overlong login password without invoking scrypt', async () => {
    const scrypt = vi.fn((_password, _salt, keyLength, callback) => {
      callback(null, Buffer.alloc(keyLength));
    });
    vi.resetModules();
    vi.doMock('node:crypto', async importOriginal => ({
      ...await importOriginal(),
      scrypt,
    }));
    const { createAuthService: createIsolatedAuthService } = await import('../../server/authService.js');
    const data = createEmptyData();
    data.authUsers.user = {
      id: 'user',
      phone: '13800138000',
      realName: '张三',
      role: 'user',
      createdAt: 1,
      updatedAt: 1,
      passwordHash: Buffer.alloc(64).toString('hex'),
      passwordSalt: 'salt',
    };
    const auth = createIsolatedAuthService({ data, saveData: vi.fn() });

    try {
      await expect(auth.login({
        phone: '13800138000',
        password: `a1${'x'.repeat(1_000_000)}`,
      })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

      expect(scrypt).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('node:crypto');
      vi.resetModules();
    }
  });

  it('preserves the 72-character password and 30-character real-name boundaries', async () => {
    const { auth } = createHarness();
    const password = `${'😀'.repeat(70)}a1`;
    const realName = '张'.repeat(30);

    await expect(auth.register({
      phone: '13800138000',
      password,
      realName,
    })).resolves.toMatchObject({ phone: '13800138000', realName });
  });

  it('enforces unique phone numbers', async () => {
    const { auth } = createHarness();
    const details = { phone: '13800138000', password: 'password1', realName: '张三' };
    await auth.register(details);

    await expect(auth.register({ ...details, realName: '李四' }))
      .rejects.toMatchObject({ code: 'PHONE_ALREADY_REGISTERED' });
  });

  it('enforces unique phone numbers across concurrent registrations', async () => {
    const { auth, data } = createHarness();
    const details = { phone: '13800138000', password: 'password1', realName: '张三' };

    const results = await Promise.allSettled([
      auth.register(details),
      auth.register({ ...details, realName: '李四' }),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(Object.values(data.authUsers).filter(user => user.phone === details.phone)).toHaveLength(1);
  });

  it('logs in with a random token while storing only its SHA-256 hash', async () => {
    const { auth, data } = createHarness({ sessionTtlMs: 5_000 });
    const user = await auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    });

    const login = await auth.login({ phone: user.phone, password: 'password1' });
    const tokenHash = createHash('sha256').update(login.token).digest('hex');

    expect(login.user).toEqual(user);
    expect(login.expiresAt).toBe(1_700_000_005_000);
    expect(login.token).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(data.authSessions[login.token]).toBeUndefined();
    expect(data.authSessions[tokenHash]).toEqual({
      tokenHash,
      userId: user.id,
      createdAt: 1_700_000_000_000,
      expiresAt: 1_700_000_005_000,
    });
    expect(JSON.stringify(data.authSessions)).not.toContain(login.token);
    expect(auth.getUserByToken(login.token)).toEqual(user);
  });

  it('keeps only the ten newest sessions for one user', async () => {
    const { auth, data, saveData, setTime } = createHarness();
    const user = await auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    });
    const logins = [];
    saveData.mockClear();

    for (let index = 0; index < 12; index += 1) {
      setTime(1_700_000_000_001 + index);
      logins.push(await auth.login({ phone: user.phone, password: 'password1' }));
    }

    const userSessions = Object.values(data.authSessions)
      .filter(session => session.userId === user.id);
    expect(userSessions).toHaveLength(10);
    expect(auth.getUserByToken(logins[0].token)).toBeNull();
    expect(auth.getUserByToken(logins[1].token)).toBeNull();
    expect(auth.getUserByToken(logins[2].token)).toEqual(user);
    expect(auth.getUserByToken(logins.at(-1).token)).toEqual(user);
    expect(saveData).toHaveBeenCalledTimes(12);
  });

  it('does not evict another user session when enforcing the limit', async () => {
    const { auth, data, setTime } = createHarness();
    const firstUser = await auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    });
    const secondUser = await auth.register({
      phone: '13900139000',
      password: 'password2',
      realName: '李四',
    });
    setTime(1_700_000_000_001);
    const secondUserLogin = await auth.login({
      phone: secondUser.phone,
      password: 'password2',
    });
    const secondUserSession = Object.values(data.authSessions)
      .find(session => session.userId === secondUser.id);

    for (let index = 0; index < 11; index += 1) {
      setTime(1_700_000_000_002 + index);
      await auth.login({ phone: firstUser.phone, password: 'password1' });
    }

    expect(Object.values(data.authSessions).filter(session => session.userId === firstUser.id))
      .toHaveLength(10);
    expect(Object.values(data.authSessions).filter(session => session.userId === secondUser.id))
      .toEqual([secondUserSession]);
    expect(auth.getUserByToken(secondUserLogin.token)).toEqual(secondUser);
  });

  it('restores added, cleaned, and evicted sessions in place when login persistence fails', async () => {
    const { auth, data, saveData, setTime } = createHarness();
    const user = await auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    });
    for (let index = 0; index < 10; index += 1) {
      setTime(1_700_000_000_001 + index);
      await auth.login({ phone: user.phone, password: 'password1' });
    }
    data.authSessions.expired = {
      tokenHash: 'expired',
      userId: user.id,
      createdAt: 1,
      expiresAt: 1_700_000_000_000,
    };
    data.authSessions.orphaned = {
      tokenHash: 'orphaned',
      userId: 'missing-user',
      createdAt: 2,
      expiresAt: 1_800_000_000_000,
    };
    const authSessions = data.authSessions;
    const entriesBefore = Object.entries(authSessions);
    const before = { ...authSessions };
    const persistenceError = new Error('persistence failed');
    let sessionsDuringSave;
    setTime(1_700_000_000_100);
    saveData.mockImplementationOnce(currentData => {
      sessionsDuringSave = { ...currentData.authSessions };
      throw persistenceError;
    });

    await expect(auth.login({ phone: user.phone, password: 'password1' }))
      .rejects.toBe(persistenceError);

    expect(Object.values(sessionsDuringSave).filter(session => session.userId === user.id))
      .toHaveLength(10);
    expect(sessionsDuringSave).not.toHaveProperty('expired');
    expect(sessionsDuringSave).not.toHaveProperty('orphaned');
    expect(data.authSessions).toBe(authSessions);
    expect(authSessions).toEqual(before);
    for (const [tokenHash, session] of entriesBefore) {
      expect(authSessions[tokenHash]).toBe(session);
    }
  });

  it('rejects unknown phones and incorrect passwords with the same error', async () => {
    const { auth } = createHarness();
    await auth.register({ phone: '13800138000', password: 'password1', realName: '张三' });

    await expect(auth.login({ phone: '13900139000', password: 'password1' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(auth.login({ phone: '13800138000', password: 'different2' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('performs scrypt for an unknown phone before returning the generic credential error', async () => {
    const scrypt = vi.fn((_password, _salt, keyLength, callback) => {
      callback(null, Buffer.alloc(keyLength));
    });
    vi.resetModules();
    vi.doMock('node:crypto', async importOriginal => ({
      ...await importOriginal(),
      scrypt,
    }));
    const { createAuthService: createIsolatedAuthService } = await import('../../server/authService.js');
    const auth = createIsolatedAuthService({ data: createEmptyData(), saveData: vi.fn() });

    try {
      await expect(auth.login({ phone: '13900139000', password: 'password1' }))
        .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(scrypt).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock('node:crypto');
      vi.resetModules();
    }
  });

  it('limits scrypt work to four concurrent operations across auth service instances', async () => {
    let active = 0;
    let maxActive = 0;
    const scrypt = vi.fn((_password, _salt, keyLength, callback) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        active -= 1;
        callback(null, Buffer.alloc(keyLength));
      }, 5);
    });
    vi.resetModules();
    vi.doMock('node:crypto', async importOriginal => ({
      ...await importOriginal(),
      scrypt,
    }));
    const { createAuthService: createIsolatedAuthService } = await import('../../server/authService.js');
    const firstAuth = createIsolatedAuthService({ data: createEmptyData(), saveData: vi.fn() });
    const secondAuth = createIsolatedAuthService({ data: createEmptyData(), saveData: vi.fn() });

    try {
      await Promise.all(Array.from({ length: 12 }, (_, index) => {
        const auth = index % 2 === 0 ? firstAuth : secondAuth;
        return auth.login({
          phone: `1390000${String(index).padStart(4, '0')}`,
          password: 'password1',
        }).catch(error => {
          expect(error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
        });
      }));

      expect(scrypt).toHaveBeenCalledTimes(12);
      expect(maxActive).toBe(4);
    } finally {
      vi.doUnmock('node:crypto');
      vi.resetModules();
    }
  });

  it('expires sessions on lookup and supports explicit logout', async () => {
    const { auth, data, saveData, setTime } = createHarness({ sessionTtlMs: 1_000 });
    const user = await auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    });
    const firstLogin = await auth.login({ phone: user.phone, password: 'password1' });

    expect(await auth.logout(firstLogin.token)).toBe(true);
    expect(await auth.logout(firstLogin.token)).toBe(false);
    expect(await auth.getUserByToken(firstLogin.token)).toBeNull();

    const secondLogin = await auth.login({ phone: user.phone, password: 'password1' });
    setTime(secondLogin.expiresAt);
    saveData.mockClear();

    expect(await auth.getUserByToken(secondLogin.token)).toBeNull();
    expect(Object.keys(data.authSessions)).toHaveLength(0);
    expect(saveData).toHaveBeenCalledOnce();
  });

  it('prunes expired, malformed, and orphaned sessions while retaining live sessions', async () => {
    const { auth, data, saveData } = createHarness();
    const user = await auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    });
    data.authSessions = {
      live: { userId: user.id, expiresAt: 1_700_000_000_001 },
      expired: { userId: user.id, expiresAt: 1_700_000_000_000 },
      orphaned: { userId: 'missing-user', expiresAt: 1_700_000_000_001 },
      malformed: null,
    };
    saveData.mockClear();

    expect(auth.prune()).toBe(3);
    expect(data.authSessions).toEqual({
      live: { userId: user.id, expiresAt: 1_700_000_000_001 },
    });
    expect(saveData).toHaveBeenCalledOnce();
  });

  it('rolls registration back in place when persistence fails', async () => {
    const persistenceError = new Error('persistence failed');
    const { auth, data } = createHarness({
      saveData: vi.fn(() => {
        throw persistenceError;
      }),
    });
    const authUsers = data.authUsers;
    const aiSessions = data.aiSessions;

    await expect(auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    })).rejects.toBe(persistenceError);

    expect(data.authUsers).toBe(authUsers);
    expect(authUsers).toEqual({});
    expect(data.aiSessions).toBe(aiSessions);
  });

  it('rolls login back in place when persistence fails', async () => {
    const { auth, data, saveData } = createHarness();
    const user = await auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    });
    const authSessions = data.authSessions;
    const persistenceError = new Error('persistence failed');
    saveData.mockImplementationOnce(() => {
      throw persistenceError;
    });

    await expect(auth.login({ phone: user.phone, password: 'password1' }))
      .rejects.toBe(persistenceError);

    expect(data.authSessions).toBe(authSessions);
    expect(authSessions).toEqual({});
  });

  it('restores an expired session in place when cleanup cannot be persisted', async () => {
    const { auth, data, saveData, setTime } = createHarness({ sessionTtlMs: 1_000 });
    const user = await auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    });
    const login = await auth.login({ phone: user.phone, password: 'password1' });
    const authSessions = data.authSessions;
    const storedSession = authSessions[createHash('sha256').update(login.token).digest('hex')];
    const persistenceError = new Error('persistence failed');
    setTime(login.expiresAt);
    saveData.mockImplementationOnce(() => {
      throw persistenceError;
    });

    expect(() => auth.getUserByToken(login.token)).toThrow(persistenceError);
    expect(data.authSessions).toBe(authSessions);
    expect(Object.values(authSessions)).toContain(storedSession);
  });

  it('restores a logged-out session in place when persistence fails', async () => {
    const { auth, data, saveData } = createHarness();
    const user = await auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    });
    const login = await auth.login({ phone: user.phone, password: 'password1' });
    const authSessions = data.authSessions;
    const before = { ...authSessions };
    const persistenceError = new Error('persistence failed');
    saveData.mockImplementationOnce(() => {
      throw persistenceError;
    });

    expect(() => auth.logout(login.token)).toThrow(persistenceError);
    expect(data.authSessions).toBe(authSessions);
    expect(authSessions).toEqual(before);
  });

  it('restores all pruned sessions in place when persistence fails', async () => {
    const { auth, data, saveData } = createHarness();
    const user = await auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    });
    data.authSessions.expired = { userId: user.id, expiresAt: 1_700_000_000_000 };
    data.authSessions.orphaned = { userId: 'missing', expiresAt: 1_700_000_000_001 };
    const authSessions = data.authSessions;
    const before = { ...authSessions };
    const persistenceError = new Error('persistence failed');
    saveData.mockImplementationOnce(() => {
      throw persistenceError;
    });

    expect(() => auth.prune()).toThrow(persistenceError);
    expect(data.authSessions).toBe(authSessions);
    expect(authSessions).toEqual(before);
  });

  it('rolls administrator creation back in place when persistence fails', async () => {
    const persistenceError = new Error('persistence failed');
    const { auth, data } = createHarness({
      saveData: vi.fn(() => {
        throw persistenceError;
      }),
    });
    const authUsers = data.authUsers;

    await expect(auth.ensureAdmin({
      phone: '13800138000',
      password: 'adminpass1',
    })).rejects.toBe(persistenceError);

    expect(data.authUsers).toBe(authUsers);
    expect(authUsers).toEqual({});
  });

  it('creates the first administrator with the default real name', async () => {
    const { auth } = createHarness();

    const admin = await auth.ensureAdmin({
      phone: '13800138000',
      password: 'adminpass1',
    });

    expect(admin).toMatchObject({
      phone: '13800138000',
      realName: '管理员',
      role: 'admin',
    });
    const login = await auth.login({ phone: admin.phone, password: 'adminpass1' });
    expect(login.user).toEqual(admin);
  });

  it('keeps an existing administrator after a password change and restart', async () => {
    const { auth, data } = createHarness();
    const bootstrapDetails = {
      phone: '13800138000',
      password: 'adminpass1',
      realName: '管理员',
    };
    const admin = await auth.ensureAdmin(bootstrapDetails);
    await auth.resetPasswordByAdmin({
      phone: admin.phone,
      realName: admin.realName,
      newPassword: 'replacement2',
    });
    const saveDataAfterRestart = vi.fn();
    const restartedAuth = createAuthService({ data, saveData: saveDataAfterRestart });

    await expect(restartedAuth.ensureAdmin(bootstrapDetails)).resolves.toEqual(admin);
    expect(saveDataAfterRestart).not.toHaveBeenCalled();
    await expect(restartedAuth.login({ phone: admin.phone, password: 'replacement2' }))
      .resolves.toHaveProperty('token');
    await expect(restartedAuth.login({ phone: admin.phone, password: 'adminpass1' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('creates only one user across matching concurrent administrator bootstraps', async () => {
    const { auth, data } = createHarness();
    const phone = '13800138000';

    const admins = await Promise.all([
      auth.ensureAdmin({ phone, password: 'sharedpass1', realName: '第一管理员' }),
      auth.ensureAdmin({ phone, password: 'sharedpass1', realName: '第二管理员' }),
    ]);

    const matchingUsers = Object.values(data.authUsers).filter(user => user.phone === phone);
    expect(matchingUsers).toHaveLength(1);
    expect(admins[0]).toEqual(admins[1]);
    expect(admins[0]).toMatchObject({ id: matchingUsers[0].id, role: 'admin' });

    await expect(auth.login({ phone, password: 'sharedpass1' })).resolves.toHaveProperty('token');
  });

  it('rejects a conflicting concurrent administrator bootstrap', async () => {
    const { auth, data } = createHarness();
    const phone = '13800138000';

    const results = await Promise.allSettled([
      auth.ensureAdmin({ phone, password: 'firstpass1', realName: '第一管理员' }),
      auth.ensureAdmin({ phone, password: 'secondpass2', realName: '第二管理员' }),
    ]);

    expect(Object.values(data.authUsers).filter(user => user.phone === phone)).toHaveLength(1);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'ADMIN_CREDENTIAL_MISMATCH' });
  });

  it('does not silently promote a differently credentialed user in a registration race', async () => {
    const { auth, data } = createHarness();
    const phone = '13800138000';
    const registeredDetails = { phone, password: 'userpass1', realName: '注册用户' };
    const bootstrapDetails = { phone, password: 'adminpass2', realName: '引导管理员' };

    const [registration, bootstrap] = await Promise.allSettled([
      auth.register(registeredDetails),
      auth.ensureAdmin(bootstrapDetails),
    ]);

    const matchingUsers = Object.values(data.authUsers).filter(user => user.phone === phone);
    expect(matchingUsers).toHaveLength(1);

    const registrationWon = registration.status === 'fulfilled';
    if (registrationWon) {
      expect(bootstrap).toMatchObject({
        status: 'rejected',
        reason: { code: 'ADMIN_CREDENTIAL_MISMATCH' },
      });
      expect(matchingUsers[0]).toMatchObject({ role: 'user', realName: registeredDetails.realName });
      await expect(auth.login({ phone, password: registeredDetails.password }))
        .resolves.toHaveProperty('token');
    } else {
      expect(registration).toMatchObject({
        status: 'rejected',
        reason: { code: 'PHONE_ALREADY_REGISTERED' },
      });
      expect(bootstrap).toMatchObject({ status: 'fulfilled' });
      expect(matchingUsers[0]).toMatchObject({ role: 'admin', realName: bootstrapDetails.realName });
      await expect(auth.login({ phone, password: bootstrapDetails.password }))
        .resolves.toHaveProperty('token');
    }
  });

  it('promotes an existing user only when the bootstrap password matches', async () => {
    const { auth, data, saveData } = createHarness();
    const user = await auth.register({
      phone: '13800138000',
      password: 'original1',
      realName: '张三',
    });
    const before = { ...data.authUsers[user.id] };
    const firstLogin = await auth.login({ phone: user.phone, password: 'original1' });
    const secondLogin = await auth.login({ phone: user.phone, password: 'original1' });
    saveData.mockClear();

    const admin = await auth.ensureAdmin({
      phone: user.phone,
      password: 'original1',
      realName: '其他名字',
    });

    expect(admin).toMatchObject({ id: user.id, realName: '张三', role: 'admin' });
    expect(data.authUsers[user.id].passwordHash).toBe(before.passwordHash);
    expect(data.authUsers[user.id].passwordSalt).toBe(before.passwordSalt);
    expect(data.authSessions).toEqual({});
    expect(auth.getUserByToken(firstLogin.token)).toBeNull();
    expect(auth.getUserByToken(secondLogin.token)).toBeNull();
    expect(saveData).toHaveBeenCalledOnce();
    await expect(auth.login({ phone: user.phone, password: 'original1' })).resolves.toHaveProperty('token');
  });

  it('does not revoke sessions or save again when the account is already an administrator', async () => {
    const { auth, saveData } = createHarness();
    const bootstrap = { phone: '13800138000', password: 'adminpass1', realName: '管理员' };
    const admin = await auth.ensureAdmin(bootstrap);
    const login = await auth.login({ phone: admin.phone, password: bootstrap.password });
    saveData.mockClear();

    await expect(auth.ensureAdmin(bootstrap)).resolves.toEqual(admin);

    expect(auth.getUserByToken(login.token)).toEqual(admin);
    expect(saveData).not.toHaveBeenCalled();
  });

  it('rejects mismatched administrator credentials without changing roles or sessions', async () => {
    const { auth, data, saveData } = createHarness();
    const user = await auth.register({
      phone: '13800138000',
      password: 'original1',
      realName: '张三',
    });
    const login = await auth.login({ phone: user.phone, password: 'original1' });
    const storedUser = data.authUsers[user.id];
    const sessionsBefore = { ...data.authSessions };
    saveData.mockClear();

    await expect(auth.ensureAdmin({
      phone: user.phone,
      password: 'different2',
      realName: '其他名字',
    })).rejects.toMatchObject({ code: 'ADMIN_CREDENTIAL_MISMATCH' });

    expect(storedUser.role).toBe('user');
    expect(data.authSessions).toEqual(sessionsBefore);
    expect(auth.getUserByToken(login.token)).toMatchObject({ id: user.id, role: 'user' });
    expect(saveData).not.toHaveBeenCalled();
  });

  it('rolls administrator promotion back in place when persistence fails', async () => {
    const { auth, data, saveData } = createHarness();
    const user = await auth.register({
      phone: '13800138000',
      password: 'original1',
      realName: '张三',
    });
    const storedUser = data.authUsers[user.id];
    const updatedAt = storedUser.updatedAt;
    const firstLogin = await auth.login({ phone: user.phone, password: 'original1' });
    const secondLogin = await auth.login({ phone: user.phone, password: 'original1' });
    const sessionsReference = data.authSessions;
    const sessionsBefore = Object.fromEntries(Object.entries(data.authSessions));
    const persistenceError = new Error('persistence failed');
    saveData.mockImplementationOnce(() => {
      throw persistenceError;
    });

    await expect(auth.ensureAdmin({
      phone: user.phone,
      password: 'original1',
    })).rejects.toBe(persistenceError);

    expect(data.authUsers[user.id]).toBe(storedUser);
    expect(storedUser).toMatchObject({ role: 'user', updatedAt });
    expect(data.authSessions).toBe(sessionsReference);
    expect(data.authSessions).toEqual(sessionsBefore);
    expect(auth.getUserByToken(firstLogin.token)).toMatchObject({ id: user.id, role: 'user' });
    expect(auth.getUserByToken(secondLogin.token)).toMatchObject({ id: user.id, role: 'user' });
  });

  it('resets a verified account password in one save and signs out every device', async () => {
    const { auth, data, saveData, setTime } = createHarness();
    const user = await auth.register({
      phone: '13800138000',
      password: 'original1',
      realName: '张三',
    });
    const otherUser = await auth.register({
      phone: '13900139000',
      password: 'otherpass2',
      realName: '李四',
    });
    const firstLogin = await auth.login({ phone: user.phone, password: 'original1' });
    const secondLogin = await auth.login({ phone: user.phone, password: 'original1' });
    const otherLogin = await auth.login({ phone: otherUser.phone, password: 'otherpass2' });
    const previousHash = data.authUsers[user.id].passwordHash;
    setTime(1_700_000_010_000);
    saveData.mockClear();

    const resetUser = await auth.resetPasswordByAdmin({
      phone: user.phone,
      realName: '张三',
      newPassword: 'replacement2',
    });

    expect(saveData).toHaveBeenCalledTimes(1);
    expect(resetUser).toMatchObject({ id: user.id, phone: user.phone, realName: '张三' });
    expect(resetUser).not.toHaveProperty('password');
    expect(resetUser).not.toHaveProperty('passwordHash');
    expect(resetUser).not.toHaveProperty('passwordSalt');
    expect(data.authUsers[user.id].passwordHash).not.toBe(previousHash);
    expect(data.authUsers[user.id].updatedAt).toBe(1_700_000_010_000);
    expect(auth.getUserByToken(firstLogin.token)).toBeNull();
    expect(auth.getUserByToken(secondLogin.token)).toBeNull();
    expect(auth.getUserByToken(otherLogin.token)).toMatchObject({ id: otherUser.id });
    await expect(auth.login({ phone: user.phone, password: 'original1' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(auth.login({ phone: user.phone, password: 'replacement2' }))
      .resolves.toMatchObject({ user: { id: user.id } });
  });

  it('rejects an unknown phone and a mismatched real name without changing account data', async () => {
    const { auth, data, saveData } = createHarness();
    const user = await auth.register({
      phone: '13800138000',
      password: 'original1',
      realName: '张三',
    });
    const storedBefore = { ...data.authUsers[user.id] };
    saveData.mockClear();

    for (const details of [
      { phone: user.phone, realName: '李四', newPassword: 'replacement2' },
      { phone: '13900139000', realName: '张三', newPassword: 'replacement2' },
    ]) {
      await expect(auth.resetPasswordByAdmin(details))
        .rejects.toMatchObject({ code: 'ACCOUNT_IDENTITY_MISMATCH' });
    }

    expect(data.authUsers[user.id]).toEqual(storedBefore);
    expect(saveData).not.toHaveBeenCalled();
    await expect(auth.login({ phone: user.phone, password: 'original1' }))
      .resolves.toHaveProperty('token');
  });

  it('rolls password and all session deletions back in place when reset persistence fails', async () => {
    const { auth, data, saveData } = createHarness();
    const user = await auth.register({
      phone: '13800138000',
      password: 'original1',
      realName: '张三',
    });
    const firstLogin = await auth.login({ phone: user.phone, password: 'original1' });
    const secondLogin = await auth.login({ phone: user.phone, password: 'original1' });
    const storedUser = data.authUsers[user.id];
    const storedUserBefore = { ...storedUser };
    const sessions = data.authSessions;
    const sessionEntries = Object.entries(sessions);
    const persistenceError = new Error('password reset persistence failed');
    saveData.mockImplementationOnce(() => {
      throw persistenceError;
    });

    await expect(auth.resetPasswordByAdmin({
      phone: user.phone,
      realName: '张三',
      newPassword: 'replacement2',
    })).rejects.toBe(persistenceError);

    expect(data.authUsers[user.id]).toBe(storedUser);
    expect(storedUser).toEqual(storedUserBefore);
    expect(data.authSessions).toBe(sessions);
    expect(Object.entries(sessions)).toEqual(sessionEntries);
    for (const [tokenHash, session] of sessionEntries) {
      expect(sessions[tokenHash]).toBe(session);
    }
    expect(auth.getUserByToken(firstLogin.token)).toMatchObject({ id: user.id });
    expect(auth.getUserByToken(secondLogin.token)).toMatchObject({ id: user.id });
    await expect(auth.login({ phone: user.phone, password: 'original1' }))
      .resolves.toHaveProperty('token');
    await expect(auth.login({ phone: user.phone, password: 'replacement2' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
});
