import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthService } from '../../server/authService.js';
import {
  createDataStore,
  createEmptyData,
  normalizeData,
} from '../../server/storage.js';

const temporaryRoots = [];
const LEGACY_KEYS = [
  'users',
  'accounts',
  'friendChats',
  'announcement',
  'videoCalls',
  'redeemCodes',
  'pointReservations',
  'pointTransactions',
];

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-data-store-'));
  temporaryRoots.push(root);
  const dataDir = path.join(root, 'private-data');
  const dataFile = path.join(dataDir, 'data.json');
  return {
    dataDir,
    dataFile,
    dataBackupFile: `${dataFile}.bak`,
    legacyDataFile: path.join(root, 'legacy-data.json'),
  };
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizedCopy(data) {
  return normalizeData(JSON.parse(JSON.stringify(data)));
}

function expectLegacyDataRemoved(data) {
  for (const key of LEGACY_KEYS) {
    expect(data).not.toHaveProperty(key);
  }
  expect(JSON.stringify(data)).not.toContain('plaintext-secret');
  expect(JSON.stringify(data)).not.toContain('another-secret');
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('createDataStore', () => {
  it('normalizes the persistent media request registry without losing valid records', () => {
    const record = {
      key: '["user-1","image","request-1"]',
      status: 'accepted',
      payloadFingerprint: 'sha256:payload',
      taskId: 'task-1',
    };

    expect(createEmptyData().mediaRequests).toEqual({});
    expect(normalizeData({}).mediaRequests).toEqual({});
    expect(normalizeData({ mediaRequests: { request: record } }).mediaRequests)
      .toEqual({ request: record });
  });

  it.each([
    ['top-level data', []],
    ['aiSessions', { aiSessions: [] }],
    ['videoJobs', { videoJobs: 'corrupted' }],
    ['mediaRequests', { mediaRequests: [] }],
    ['authUsers', { authUsers: [] }],
    ['authSessions', { authSessions: 'corrupted' }],
  ])('fails closed when persisted %s has the wrong schema', (_label, value) => {
    expect(() => normalizeData(value)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PERSISTED_DATA' }),
    );
  });

  it('persists only normalized data and applies private data permissions', () => {
    const paths = createHarness();
    const chmod = vi.spyOn(fs, 'chmodSync');
    const store = createDataStore(paths);
    const data = {
      ...createEmptyData(),
      customSetting: true,
      users: { legacy: { password: 'plaintext-secret' } },
      accounts: { legacy: { password: 'another-secret' } },
      friendChats: { legacy: [{ content: 'private message' }] },
      announcement: { content: 'legacy announcement' },
      videoCalls: { legacy: { status: 'connected' } },
    };

    store.saveData(data);

    const persisted = JSON.parse(fs.readFileSync(paths.dataFile, 'utf8'));
    expect(persisted).toEqual({ ...createEmptyData(), customSetting: true });
    expect(chmod).toHaveBeenCalledWith(paths.dataDir, 0o700);
    expect(chmod).toHaveBeenCalledWith(`${paths.dataFile}.tmp`, 0o600);
    if (process.platform !== 'win32') {
      expect(fs.statSync(paths.dataDir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(paths.dataFile).mode & 0o777).toBe(0o600);
    }
  });

  it('hardens existing primary and backup files during save and recovery', () => {
    const paths = createHarness();
    const store = createDataStore(paths);
    store.saveData(createEmptyData());
    store.saveData({
      ...createEmptyData(),
      users: { legacy: { password: 'plaintext-secret' } },
    });

    expect(fs.existsSync(paths.dataBackupFile)).toBe(true);
    fs.writeFileSync(paths.dataFile, '{invalid json', 'utf8');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(store.loadData()).toEqual(createEmptyData());
    expect(JSON.parse(fs.readFileSync(paths.dataFile, 'utf8'))).toEqual(createEmptyData());
    expect(JSON.parse(fs.readFileSync(paths.dataBackupFile, 'utf8'))).toEqual(createEmptyData());
    if (process.platform !== 'win32') {
      expect(fs.statSync(paths.dataBackupFile).mode & 0o777).toBe(0o600);
      expect(fs.statSync(paths.dataFile).mode & 0o777).toBe(0o600);
    }
  });

  it('recovers a schema-invalid primary from a valid backup', () => {
    const paths = createHarness();
    const invalidPrimary = { ...createEmptyData(), authUsers: [] };
    const backupData = { ...createEmptyData(), durableMarker: 'valid-backup' };
    writeJson(paths.dataFile, invalidPrimary);
    writeJson(paths.dataBackupFile, backupData);

    const loaded = createDataStore(paths).loadData();

    expect(loaded).toEqual(backupData);
    expect(readJson(paths.dataFile)).toEqual(backupData);
    expect(readJson(paths.dataBackupFile)).toEqual(backupData);
  });

  it('does not overwrite files when both primary and backup have invalid schemas', () => {
    const paths = createHarness();
    const invalidPrimary = { ...createEmptyData(), authUsers: [] };
    const invalidBackup = { ...createEmptyData(), authSessions: [] };
    writeJson(paths.dataFile, invalidPrimary);
    writeJson(paths.dataBackupFile, invalidBackup);

    expect(() => createDataStore(paths).loadData()).toThrow(AggregateError);
    expect(readJson(paths.dataFile)).toEqual(invalidPrimary);
    expect(readJson(paths.dataBackupFile)).toEqual(invalidBackup);
  });

  it('scrubs legacy fields from both persisted copies when loading old data', () => {
    const paths = createHarness();
    fs.mkdirSync(paths.dataDir, { recursive: true });
    const legacyData = {
      aiSessions: { owner: [{ id: 'session-1' }] },
      users: { legacy: { password: 'plaintext-secret' } },
      accounts: { legacy: { password: 'another-secret' } },
      friendChats: { legacy: [{ content: 'private message' }] },
      announcement: { content: 'legacy announcement' },
      videoCalls: { legacy: { status: 'connected' } },
    };
    fs.writeFileSync(paths.dataFile, JSON.stringify(legacyData), 'utf8');
    fs.writeFileSync(paths.dataBackupFile, JSON.stringify(legacyData), 'utf8');

    const loaded = createDataStore(paths).loadData();
    const expected = {
      ...createEmptyData(),
      aiSessions: legacyData.aiSessions,
    };

    expect(loaded).toEqual(expected);
    expect(JSON.parse(fs.readFileSync(paths.dataFile, 'utf8'))).toEqual(expected);
    expect(JSON.parse(fs.readFileSync(paths.dataBackupFile, 'utf8'))).toEqual(expected);
  });

  it('commits the same sanitized next state to the primary and backup', () => {
    const paths = createHarness();
    const previousData = {
      aiSessions: { owner: [{ id: 'previous-session' }] },
      videoJobs: { previous: { status: 'complete' } },
      customPreviousField: { retained: true },
      users: { legacy: { password: 'plaintext-secret' } },
      accounts: { legacy: { password: 'another-secret' } },
    };
    const nextData = {
      ...createEmptyData(),
      aiSessions: { owner: [{ id: 'next-session' }] },
      customNextField: true,
    };
    writeJson(paths.dataFile, previousData);

    createDataStore(paths).saveData(nextData);

    expect(readJson(paths.dataFile)).toEqual(nextData);
    expect(readJson(paths.dataBackupFile)).toEqual(nextData);
    expectLegacyDataRemoved(readJson(paths.dataBackupFile));
  });

  it('replaces a pre-existing backup with the same committed next state', () => {
    const paths = createHarness();
    const backupData = {
      aiSessions: { owner: [{ id: 'backup-session' }] },
      videoJobs: { backup: { status: 'complete' } },
      customBackupField: true,
      users: { legacy: { password: 'plaintext-secret' } },
    };
    const nextData = { ...createEmptyData(), customNextField: true };
    writeJson(paths.dataBackupFile, backupData);

    createDataStore(paths).saveData(nextData);

    expect(readJson(paths.dataFile)).toEqual(nextData);
    expect(readJson(paths.dataBackupFile)).toEqual(nextData);
    expectLegacyDataRemoved(readJson(paths.dataBackupFile));
  });

  it('does not revive a logged-out session when a corrupt primary is recovered', async () => {
    const paths = createHarness();
    const store = createDataStore(paths);
    const data = createEmptyData();
    store.saveData(data);
    const auth = createAuthService({ data, saveData: store.saveData });
    await auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    });
    const login = await auth.login({ phone: '13800138000', password: 'password1' });

    expect(auth.logout(login.token)).toBe(true);
    expect(readJson(paths.dataFile).authSessions).toEqual({});
    expect(readJson(paths.dataBackupFile).authSessions).toEqual({});

    fs.writeFileSync(paths.dataFile, '{broken-primary', 'utf8');
    const recoveredData = createDataStore(paths).loadData();
    const recoveredAuth = createAuthService({
      data: recoveredData,
      saveData: createDataStore(paths).saveData,
    });

    expect(recoveredAuth.getUserByToken(login.token)).toBeNull();
  });

  it('upgrades the primary, backup, and root legacy file without losing non-legacy fields', () => {
    const paths = createHarness();
    const primaryData = {
      aiSessions: { owner: [{ id: 'primary-session' }] },
      videoJobs: { primary: { status: 'queued' } },
      authUsers: { current: { id: 'current', phone: '13900139000' } },
      customPrimaryField: { retained: true },
      users: { legacy: { password: 'plaintext-secret' } },
      friendChats: { legacy: [{ content: 'private message' }] },
    };
    const rootLegacyData = {
      aiSessions: { owner: [{ id: 'root-session' }] },
      videoJobs: { root: { status: 'complete' } },
      customRootField: ['retained'],
      accounts: { legacy: { password: 'another-secret' } },
      announcement: { content: 'legacy announcement' },
      videoCalls: { legacy: { status: 'connected' } },
    };
    writeJson(paths.dataFile, primaryData);
    writeJson(paths.dataBackupFile, primaryData);
    writeJson(paths.legacyDataFile, rootLegacyData);

    const loaded = createDataStore(paths).loadData();
    const expectedPrimary = normalizedCopy(primaryData);
    const expectedRootLegacy = normalizedCopy(rootLegacyData);

    expect(loaded).toEqual(expectedPrimary);
    expect(readJson(paths.dataFile)).toEqual(expectedPrimary);
    expect(readJson(paths.dataBackupFile)).toEqual(expectedPrimary);
    expect(readJson(paths.legacyDataFile)).toEqual(expectedRootLegacy);
    for (const filePath of [paths.dataFile, paths.dataBackupFile, paths.legacyDataFile]) {
      expectLegacyDataRemoved(readJson(filePath));
    }
  });

  it('leaves a sanitized recovery copy and retries after primary replacement is interrupted', () => {
    const paths = createHarness();
    const legacyData = {
      aiSessions: { owner: [{ id: 'session-1' }] },
      videoJobs: { job: { status: 'queued' } },
      customSetting: true,
      users: { legacy: { password: 'plaintext-secret' } },
    };
    writeJson(paths.dataFile, legacyData);
    writeJson(paths.dataBackupFile, legacyData);
    writeJson(paths.legacyDataFile, legacyData);
    const expected = normalizedCopy(legacyData);
    const persistenceError = Object.assign(new Error('simulated interrupted replacement'), { code: 'EIO' });
    const renameSync = fs.renameSync.bind(fs);
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (path.resolve(String(destination)) === path.resolve(paths.dataFile)) {
        throw persistenceError;
      }
      return renameSync(source, destination);
    });

    expect(() => createDataStore(paths).loadData()).toThrow(persistenceError);
    expect(readJson(paths.dataFile)).toEqual(legacyData);
    expect(readJson(paths.dataBackupFile)).toEqual(expected);
    expectLegacyDataRemoved(readJson(paths.dataBackupFile));

    rename.mockRestore();
    expect(createDataStore(paths).loadData()).toEqual(expected);
    expect(readJson(paths.dataFile)).toEqual(expected);
    expect(readJson(paths.dataBackupFile)).toEqual(expected);
    expect(readJson(paths.legacyDataFile)).toEqual(expected);
  });

  it('propagates root legacy migration write failures and preserves data for a retry', () => {
    const paths = createHarness();
    const legacyData = {
      aiSessions: { owner: [{ id: 'legacy-session' }] },
      videoJobs: { legacy: { status: 'complete' } },
      customLegacyField: { retained: true },
      users: { legacy: { password: 'plaintext-secret' } },
    };
    writeJson(paths.legacyDataFile, legacyData);
    const expected = normalizedCopy(legacyData);
    const persistenceError = Object.assign(new Error('simulated migration write failure'), { code: 'EIO' });
    const renameSync = fs.renameSync.bind(fs);
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (path.resolve(String(destination)) === path.resolve(paths.dataFile)) {
        throw persistenceError;
      }
      return renameSync(source, destination);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => createDataStore(paths).loadData()).toThrow(persistenceError);
    expect(fs.existsSync(paths.dataFile)).toBe(false);
    expect(readJson(paths.legacyDataFile)).toEqual(expected);

    rename.mockRestore();
    expect(createDataStore(paths).loadData()).toEqual(expected);
    expect(readJson(paths.dataFile)).toEqual(expected);
    expect(readJson(paths.dataBackupFile)).toEqual(expected);
    expect(readJson(paths.legacyDataFile)).toEqual(expected);
  });

  it('hardens existing backup and interrupted temp files without creating missing ones', () => {
    const paths = createHarness();
    const tempFile = `${paths.dataFile}.tmp`;
    writeJson(paths.dataFile, createEmptyData());
    writeJson(paths.dataBackupFile, createEmptyData());
    writeJson(tempFile, createEmptyData());
    fs.chmodSync(paths.dataBackupFile, 0o666);
    fs.chmodSync(tempFile, 0o666);
    const chmod = vi.spyOn(fs, 'chmodSync');

    createDataStore(paths).loadData();

    expect(chmod).toHaveBeenCalledWith(paths.dataBackupFile, 0o600);
    expect(chmod).toHaveBeenCalledWith(tempFile, 0o600);
    if (process.platform !== 'win32') {
      expect(fs.statSync(paths.dataBackupFile).mode & 0o777).toBe(0o600);
      expect(fs.statSync(tempFile).mode & 0o777).toBe(0o600);
    }

    const withoutArtifacts = createHarness();
    writeJson(withoutArtifacts.dataFile, createEmptyData());
    createDataStore(withoutArtifacts).loadData();
    expect(fs.existsSync(withoutArtifacts.dataBackupFile)).toBe(false);
    expect(fs.existsSync(`${withoutArtifacts.dataFile}.tmp`)).toBe(false);
  });

  it('follows a data-file symlink target for loading, cleanup, and chmod', () => {
    const paths = createHarness();
    const targetFile = path.join(path.dirname(paths.dataDir), 'persistent-data.json');
    const logicalData = { marker: 'logical-file-must-not-be-replaced' };
    const targetData = {
      aiSessions: { owner: [{ id: 'target-session' }] },
      customTargetField: true,
      users: { legacy: { password: 'plaintext-secret' } },
    };
    writeJson(paths.dataFile, logicalData);
    writeJson(targetFile, targetData);
    const originalLstatSync = fs.lstatSync.bind(fs);
    const originalRealpathSync = fs.realpathSync.bind(fs);
    vi.spyOn(fs, 'lstatSync').mockImplementation(filePath => (
      path.resolve(String(filePath)) === path.resolve(paths.dataFile)
        ? { isSymbolicLink: () => true }
        : originalLstatSync(filePath)
    ));
    vi.spyOn(fs, 'realpathSync').mockImplementation(filePath => (
      path.resolve(String(filePath)) === path.resolve(paths.dataFile)
        ? targetFile
        : originalRealpathSync(filePath)
    ));
    const chmod = vi.spyOn(fs, 'chmodSync');

    expect(createDataStore(paths).loadData()).toEqual(normalizedCopy(targetData));
    expect(readJson(targetFile)).toEqual(normalizedCopy(targetData));
    expect(readJson(paths.dataFile)).toEqual(logicalData);
    expect(chmod).toHaveBeenCalledWith(targetFile, 0o600);
  });

  it('keeps the primary uncommitted when legacy replacement fails so auth can roll back', async () => {
    const paths = createHarness();
    const data = { ...createEmptyData(), customSetting: 'old-value' };
    const legacyData = {
      aiSessions: { owner: [{ id: 'legacy-session' }] },
      users: { legacy: { password: 'plaintext-secret' } },
    };
    writeJson(paths.dataFile, data);
    writeJson(paths.legacyDataFile, legacyData);
    const persistedBefore = readJson(paths.dataFile);
    const store = createDataStore(paths);
    const auth = createAuthService({ data, saveData: store.saveData });
    const persistenceError = Object.assign(new Error('legacy replacement failed'), { code: 'EIO' });
    const renameSync = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (path.resolve(String(destination)) === path.resolve(paths.legacyDataFile)) {
        throw persistenceError;
      }
      return renameSync(source, destination);
    });

    await expect(auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    })).rejects.toBe(persistenceError);

    expect(data.authUsers).toEqual({});
    expect(readJson(paths.dataFile)).toEqual(persistedBefore);
    expect(readJson(paths.legacyDataFile)).toEqual(legacyData);
  });

  it('keeps the primary uncommitted when legacy chmod fails so auth can roll back', async () => {
    const paths = createHarness();
    const data = { ...createEmptyData(), customSetting: 'old-value' };
    const legacyData = {
      videoJobs: { legacy: { status: 'queued' } },
      accounts: { legacy: { password: 'another-secret' } },
    };
    writeJson(paths.dataFile, data);
    writeJson(paths.legacyDataFile, legacyData);
    const persistedBefore = readJson(paths.dataFile);
    const store = createDataStore(paths);
    const auth = createAuthService({ data, saveData: store.saveData });
    const permissionError = Object.assign(new Error('legacy chmod failed'), { code: 'EACCES' });
    const chmodSync = fs.chmodSync.bind(fs);
    vi.spyOn(fs, 'chmodSync').mockImplementation((filePath, mode) => {
      if (path.resolve(String(filePath)) === path.resolve(`${paths.legacyDataFile}.tmp`)) {
        throw permissionError;
      }
      return chmodSync(filePath, mode);
    });

    await expect(auth.register({
      phone: '13800138000',
      password: 'password1',
      realName: '张三',
    })).rejects.toBe(permissionError);

    expect(data.authUsers).toEqual({});
    expect(readJson(paths.dataFile)).toEqual(persistedBefore);
    expect(readJson(paths.legacyDataFile)).toEqual(legacyData);
  });

  it('makes the primary rename the final filesystem operation in saveData', () => {
    const paths = createHarness();
    const previousData = { ...createEmptyData(), customSetting: 'old-value' };
    const nextData = { ...createEmptyData(), customSetting: 'new-value' };
    writeJson(paths.dataFile, previousData);
    writeJson(paths.legacyDataFile, {
      customLegacyField: true,
      users: { legacy: { password: 'plaintext-secret' } },
    });
    const postCommitError = new Error('filesystem operation ran after primary commit');
    const chmodSync = fs.chmodSync.bind(fs);
    const renameSync = fs.renameSync.bind(fs);
    let primaryCommitted = false;
    vi.spyOn(fs, 'chmodSync').mockImplementation((filePath, mode) => {
      if (primaryCommitted) throw postCommitError;
      return chmodSync(filePath, mode);
    });
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (primaryCommitted) throw postCommitError;
      const result = renameSync(source, destination);
      if (path.resolve(String(destination)) === path.resolve(paths.dataFile)) {
        primaryCommitted = true;
      }
      return result;
    });

    expect(() => createDataStore(paths).saveData(nextData)).not.toThrow();
    expect(primaryCommitted).toBe(true);
    expect(readJson(paths.dataFile)).toEqual(nextData);
    expectLegacyDataRemoved(readJson(paths.legacyDataFile));
  });

  it('throws instead of starting with empty data when both primary and backup are corrupt', () => {
    const paths = createHarness();
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.writeFileSync(paths.dataFile, '{broken-primary', 'utf8');
    fs.writeFileSync(paths.dataBackupFile, '{broken-backup', 'utf8');

    expect(() => createDataStore(paths).loadData()).toThrow();
  });

  it('throws when the only persisted primary data is corrupt', () => {
    const paths = createHarness();
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.writeFileSync(paths.dataFile, '{broken-primary', 'utf8');

    expect(() => createDataStore(paths).loadData()).toThrow();
  });

  it('recovers a missing primary from a valid backup instead of treating it as a first run', () => {
    const paths = createHarness();
    const backupData = { ...createEmptyData(), durableMarker: 'from-backup' };
    writeJson(paths.dataBackupFile, backupData);

    const loaded = createDataStore(paths).loadData();

    expect(loaded).toEqual(backupData);
    expect(readJson(paths.dataFile)).toEqual(backupData);
  });

  it('returns empty data only when no primary, backup, or legacy data exists', () => {
    const paths = createHarness();

    expect(createDataStore(paths).loadData()).toEqual(createEmptyData());

    fs.writeFileSync(paths.legacyDataFile, '{broken-legacy', 'utf8');
    expect(() => createDataStore(paths).loadData()).toThrow();
  });
});
