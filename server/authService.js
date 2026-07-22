import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_CONCURRENT_SCRYPT = 4;
const DUMMY_PASSWORD_MATERIAL = Object.freeze({
  passwordHash: '0'.repeat(128),
  passwordSalt: '00000000000000000000000000000000',
});
const PHONE_PATTERN = /^1[3-9]\d{9}$/u;
const REAL_NAME_PATTERN = /^[\p{Script=Han}A-Za-z ·]+$/u;
const MAX_PHONE_INPUT_CODE_UNITS = 64;
const MAX_PASSWORD_CHARACTERS = 72;
const MAX_PASSWORD_CODE_UNITS = MAX_PASSWORD_CHARACTERS * 2;
const MAX_REAL_NAME_INPUT_CODE_UNITS = 256;
const MAX_SESSIONS_PER_USER = 10;
let activeScryptOperations = 0;
const scryptWaiters = [];

async function acquireScryptSlot() {
  if (activeScryptOperations < MAX_CONCURRENT_SCRYPT) {
    activeScryptOperations += 1;
    return;
  }
  await new Promise(resolve => scryptWaiters.push(resolve));
}

function releaseScryptSlot() {
  const next = scryptWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeScryptOperations -= 1;
}

async function runScrypt(password, salt, keyLength) {
  await acquireScryptSlot();
  try {
    return await new Promise((resolve, reject) => {
      scryptCallback(password, salt, keyLength, (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      });
    });
  } finally {
    releaseScryptSlot();
  }
}

export class AuthServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthServiceError';
    this.code = code;
  }
}

function countCharacters(value) {
  return Array.from(value).length;
}

function normalizePhone(phone) {
  if (typeof phone !== 'string' || phone.length > MAX_PHONE_INPUT_CODE_UNITS) {
    throw new AuthServiceError('INVALID_PHONE', 'Phone number is invalid');
  }
  const normalized = phone.trim();
  if (!PHONE_PATTERN.test(normalized)) {
    throw new AuthServiceError('INVALID_PHONE', 'Phone number is invalid');
  }
  return normalized;
}

function hasAllowedPasswordLength(password) {
  if (
    typeof password !== 'string'
    || password.length < 8
    || password.length > MAX_PASSWORD_CODE_UNITS
  ) {
    return false;
  }
  const length = countCharacters(password);
  return length >= 8 && length <= MAX_PASSWORD_CHARACTERS;
}

function validatePassword(password) {
  if (
    !hasAllowedPasswordLength(password)
    || !/[A-Za-z]/u.test(password)
    || !/\d/u.test(password)
  ) {
    throw new AuthServiceError('INVALID_PASSWORD', 'Password must contain letters and numbers and be 8-72 characters long');
  }
  return password;
}

function normalizeRealName(realName) {
  if (typeof realName !== 'string' || realName.length > MAX_REAL_NAME_INPUT_CODE_UNITS) {
    throw new AuthServiceError('INVALID_REAL_NAME', 'Real name is invalid');
  }
  const normalized = realName.trim();
  const length = countCharacters(normalized);
  if (length < 2 || length > 30 || !REAL_NAME_PATTERN.test(normalized)) {
    throw new AuthServiceError('INVALID_REAL_NAME', 'Real name is invalid');
  }
  return normalized;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function createPasswordMaterial(password) {
  const passwordSalt = randomBytes(16).toString('hex');
  const derivedKey = await runScrypt(password, passwordSalt, 64);
  return {
    passwordHash: Buffer.from(derivedKey).toString('hex'),
    passwordSalt,
  };
}

async function passwordMatches(password, user) {
  const hasValidPasswordMaterial = Boolean(
    typeof user?.passwordHash === 'string'
    && typeof user?.passwordSalt === 'string'
    && /^[a-f0-9]{128}$/u.test(user.passwordHash)
  );
  const material = hasValidPasswordMaterial ? user : DUMMY_PASSWORD_MATERIAL;
  const candidate = Buffer.from(await runScrypt(password, material.passwordSalt, 64));
  const stored = Buffer.from(material.passwordHash, 'hex');
  const matches = candidate.length === stored.length && timingSafeEqual(candidate, stored);
  return hasValidPasswordMaterial && matches;
}

function publicUser(user) {
  if (!user) return null;
  const isAdmin = user.role === 'admin';
  return {
    id: user.id,
    phone: user.phone,
    realName: user.realName,
    role: isAdmin ? 'admin' : 'user',
    mediaPermissions: {
      imageGeneration: isAdmin || user.mediaPermissions?.imageGeneration === true,
      videoGeneration: isAdmin || user.mediaPermissions?.videoGeneration === true,
    },
    createdAt: user.createdAt,
  };
}

export function createAuthService({
  data,
  saveData,
  now = () => Date.now(),
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('data must be an object');
  }
  if (typeof saveData !== 'function') {
    throw new TypeError('saveData must be a function');
  }

  for (const collectionName of ['authUsers', 'authSessions']) {
    if (!Object.hasOwn(data, collectionName)) continue;
    const collection = data[collectionName];
    if (!collection || typeof collection !== 'object' || Array.isArray(collection)) {
      throw new TypeError(`${collectionName} must be an object`);
    }
  }

  if (!Object.hasOwn(data, 'authUsers')) {
    data.authUsers = {};
  }
  if (!Object.hasOwn(data, 'authSessions')) {
    data.authSessions = {};
  }

  const getNow = typeof now === 'function' ? now : () => Date.now();
  const ttlMs = Number.isFinite(Number(sessionTtlMs)) && Number(sessionTtlMs) > 0
    ? Number(sessionTtlMs)
    : DEFAULT_SESSION_TTL_MS;

  function findUserByPhone(phone) {
    return Object.values(data.authUsers).find(user => user?.phone === phone) || null;
  }

  function promoteToAdmin(user) {
    if (user.role !== 'admin') {
      const userEntriesBefore = Object.entries(user);
      const sessionEntriesBefore = Object.entries(data.authSessions);
      user.role = 'admin';
      user.updatedAt = Number(getNow());
      for (const [tokenHash, session] of Object.entries(data.authSessions)) {
        if (session?.userId === user.id) {
          delete data.authSessions[tokenHash];
        }
      }
      try {
        saveData(data);
      } catch (error) {
        restoreRecordsInPlace(user, userEntriesBefore);
        restoreRecordsInPlace(data.authSessions, sessionEntriesBefore);
        throw error;
      }
    }
    return publicUser(user);
  }

  function persistRecord(collection, key, value) {
    const hadPreviousValue = Object.hasOwn(collection, key);
    const previousValue = collection[key];
    collection[key] = value;
    try {
      saveData(data);
    } catch (error) {
      if (hadPreviousValue) collection[key] = previousValue;
      else delete collection[key];
      throw error;
    }
  }

  function deleteRecord(collection, key) {
    const value = collection[key];
    delete collection[key];
    try {
      saveData(data);
    } catch (error) {
      collection[key] = value;
      throw error;
    }
  }

  function restoreRecordsInPlace(collection, entries) {
    for (const key of Object.keys(collection)) {
      delete collection[key];
    }
    for (const [key, value] of entries) {
      collection[key] = value;
    }
  }

  function persistSessionMutation(mutate) {
    const entriesBefore = Object.entries(data.authSessions);
    try {
      const result = mutate();
      saveData(data);
      return result;
    } catch (error) {
      restoreRecordsInPlace(data.authSessions, entriesBefore);
      throw error;
    }
  }

  function isInvalidSession(session, timestamp) {
    return (
      !session
      || !data.authUsers[session.userId]
      || !Number.isFinite(Number(session.expiresAt))
      || Number(session.expiresAt) <= timestamp
    );
  }

  function removeInvalidSessions(timestamp) {
    let removed = 0;
    for (const [tokenHash, session] of Object.entries(data.authSessions)) {
      if (isInvalidSession(session, timestamp)) {
        delete data.authSessions[tokenHash];
        removed += 1;
      }
    }
    return removed;
  }

  function enforceUserSessionLimit(userId, retainedTokenHash) {
    const sessions = Object.entries(data.authSessions)
      .map(([tokenHash, session], index) => ({ tokenHash, session, index }))
      .filter(({ session }) => session?.userId === userId);
    const excess = sessions.length - MAX_SESSIONS_PER_USER;
    if (excess <= 0) return;

    const oldest = sessions
      .filter(({ tokenHash }) => tokenHash !== retainedTokenHash)
      .sort((left, right) => {
        const leftCreatedAt = Number(left.session?.createdAt);
        const rightCreatedAt = Number(right.session?.createdAt);
        const leftOrder = Number.isFinite(leftCreatedAt) ? leftCreatedAt : Number.NEGATIVE_INFINITY;
        const rightOrder = Number.isFinite(rightCreatedAt) ? rightCreatedAt : Number.NEGATIVE_INFINITY;
        return leftOrder - rightOrder || left.index - right.index;
      });
    for (const { tokenHash } of oldest.slice(0, excess)) {
      delete data.authSessions[tokenHash];
    }
  }

  async function verifyAdminBootstrapPassword(password, user) {
    if (!await passwordMatches(password, user)) {
      throw new AuthServiceError(
        'ADMIN_CREDENTIAL_MISMATCH',
        'Administrator bootstrap credentials do not match the existing account',
      );
    }
  }

  async function register({ phone, password, realName } = {}) {
    const normalizedPhone = normalizePhone(phone);
    const validPassword = validatePassword(password);
    const normalizedRealName = normalizeRealName(realName);

    if (findUserByPhone(normalizedPhone)) {
      throw new AuthServiceError('PHONE_ALREADY_REGISTERED', 'Phone number is already registered');
    }

    const timestamp = Number(getNow());
    const passwordMaterial = await createPasswordMaterial(validPassword);
    if (findUserByPhone(normalizedPhone)) {
      throw new AuthServiceError('PHONE_ALREADY_REGISTERED', 'Phone number is already registered');
    }
    const user = {
      id: randomUUID(),
      phone: normalizedPhone,
      realName: normalizedRealName,
      role: 'user',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...passwordMaterial,
    };
    persistRecord(data.authUsers, user.id, user);
    return publicUser(user);
  }

  async function login({ phone, password } = {}) {
    let normalizedPhone;
    try {
      normalizedPhone = normalizePhone(phone);
    } catch {
      throw new AuthServiceError('INVALID_CREDENTIALS', 'Phone number or password is incorrect');
    }

    if (!hasAllowedPasswordLength(password)) {
      throw new AuthServiceError('INVALID_CREDENTIALS', 'Phone number or password is incorrect');
    }

    const user = findUserByPhone(normalizedPhone);
    const matches = await passwordMatches(password, user);
    if (!user || !matches) {
      throw new AuthServiceError('INVALID_CREDENTIALS', 'Phone number or password is incorrect');
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const createdAt = Number(getNow());
    const expiresAt = createdAt + ttlMs;
    const session = {
      tokenHash,
      userId: user.id,
      createdAt,
      expiresAt,
    };
    persistSessionMutation(() => {
      data.authSessions[tokenHash] = session;
      removeInvalidSessions(createdAt);
      enforceUserSessionLimit(user.id, tokenHash);
    });

    return {
      token,
      user: publicUser(user),
      expiresAt,
    };
  }

  function getUserByToken(token) {
    if (typeof token !== 'string' || !token) return null;

    const tokenHash = hashToken(token);
    const session = data.authSessions[tokenHash];
    if (!session) return null;

    const user = data.authUsers[session.userId];
    if (!user || !Number.isFinite(Number(session.expiresAt)) || Number(session.expiresAt) <= Number(getNow())) {
      deleteRecord(data.authSessions, tokenHash);
      return null;
    }

    return publicUser(user);
  }

  function logout(token) {
    if (typeof token !== 'string' || !token) return false;

    const tokenHash = hashToken(token);
    if (!data.authSessions[tokenHash]) return false;

    deleteRecord(data.authSessions, tokenHash);
    return true;
  }

  function prune() {
    const timestamp = Number(getNow());
    let removed = 0;
    const removedSessions = [];

    for (const [tokenHash, session] of Object.entries(data.authSessions)) {
      if (isInvalidSession(session, timestamp)) {
        removedSessions.push([tokenHash, session]);
        delete data.authSessions[tokenHash];
        removed += 1;
      }
    }

    if (removed > 0) {
      try {
        saveData(data);
      } catch (error) {
        for (const [tokenHash, session] of removedSessions) {
          data.authSessions[tokenHash] = session;
        }
        throw error;
      }
    }
    return removed;
  }

  async function ensureAdmin({ phone, password, realName = '管理员' } = {}) {
    const normalizedPhone = normalizePhone(phone);
    const validPassword = validatePassword(password);
    const existingUser = findUserByPhone(normalizedPhone);

    if (existingUser) {
      if (existingUser.role !== 'admin') {
        await verifyAdminBootstrapPassword(validPassword, existingUser);
      }
      return promoteToAdmin(existingUser);
    }

    const normalizedRealName = normalizeRealName(realName);
    const timestamp = Number(getNow());
    const passwordMaterial = await createPasswordMaterial(validPassword);
    const concurrentUser = findUserByPhone(normalizedPhone);
    if (concurrentUser) {
      await verifyAdminBootstrapPassword(validPassword, concurrentUser);
      return promoteToAdmin(concurrentUser);
    }

    const user = {
      id: randomUUID(),
      phone: normalizedPhone,
      realName: normalizedRealName,
      role: 'admin',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...passwordMaterial,
    };
    persistRecord(data.authUsers, user.id, user);
    return publicUser(user);
  }

  async function resetPasswordByAdmin({ phone, realName, newPassword } = {}) {
    const normalizedPhone = normalizePhone(phone);
    const normalizedRealName = normalizeRealName(realName);
    const validPassword = validatePassword(newPassword);
    const initialUser = findUserByPhone(normalizedPhone);
    if (!initialUser || initialUser.realName !== normalizedRealName) {
      throw new AuthServiceError(
        'ACCOUNT_IDENTITY_MISMATCH',
        'Phone number and real name do not match an account',
      );
    }

    const passwordMaterial = await createPasswordMaterial(validPassword);
    const user = findUserByPhone(normalizedPhone);
    if (!user || user.id !== initialUser.id || user.realName !== normalizedRealName) {
      throw new AuthServiceError(
        'ACCOUNT_IDENTITY_MISMATCH',
        'Phone number and real name do not match an account',
      );
    }

    const userEntriesBefore = Object.entries(user);
    const sessionEntriesBefore = Object.entries(data.authSessions);
    const removedSessions = Object.entries(data.authSessions)
      .filter(([, session]) => session?.userId === user.id);
    user.passwordHash = passwordMaterial.passwordHash;
    user.passwordSalt = passwordMaterial.passwordSalt;
    user.updatedAt = Number(getNow());
    for (const [tokenHash] of removedSessions) {
      delete data.authSessions[tokenHash];
    }

    try {
      saveData(data);
    } catch (error) {
      restoreRecordsInPlace(user, userEntriesBefore);
      restoreRecordsInPlace(data.authSessions, sessionEntriesBefore);
      throw error;
    }
    return publicUser(user);
  }

  function listUsers() {
    return Object.values(data.authUsers)
      .map(publicUser)
      .sort((left, right) => Number(left.createdAt) - Number(right.createdAt));
  }

  function updateMediaPermissions(userId, permissions = {}) {
    const normalizedUserId = String(userId || '').trim();
    const user = data.authUsers[normalizedUserId];
    if (!user) {
      throw new AuthServiceError('ACCOUNT_NOT_FOUND', 'Account does not exist');
    }
    if (user.role === 'admin') return publicUser(user);

    const previousEntries = Object.entries(user);
    user.mediaPermissions = {
      imageGeneration: permissions.imageGeneration === true,
      videoGeneration: permissions.videoGeneration === true,
    };
    user.updatedAt = Number(getNow());
    try {
      saveData(data);
    } catch (error) {
      restoreRecordsInPlace(user, previousEntries);
      throw error;
    }
    return publicUser(user);
  }

  return {
    register,
    login,
    getUserByToken,
    logout,
    prune,
    ensureAdmin,
    resetPasswordByAdmin,
    listUsers,
    updateMediaPermissions,
  };
}
