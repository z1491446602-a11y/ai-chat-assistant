import { createHmac, randomInt, randomUUID } from 'node:crypto';

export const POINT_UNITS_PER_POINT = 10;
export const MEDIA_COST_UNITS = Object.freeze({ gpt: 2, grok: 1, video: 15 });
export const MAX_POINT_TRANSACTIONS = 1_000;
export const MAX_TERMINAL_POINT_RESERVATIONS = 1_000;
export const MAX_UNUSED_REDEEM_CODES = 1_000;
export const MAX_REDEEM_CODE_RECORDS = 2_000;
export const MAX_LISTED_REDEEM_CODES = 200;

const TRANSACTIONAL_COLLECTION_KEYS = Object.freeze([
  'authUsers',
  'pointReservations',
  'pointTransactions',
  'redeemCodes',
]);

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const REDEEM_CODE_ALPHABET = `${UPPERCASE}${LOWERCASE}${DIGITS}`;
const REDEEM_CODE_DISPLAY_MASK = '********';
const MEDIA_TASK_TYPES = new Set(['image', 'video']);
const RESERVATION_STATUSES = new Set(['reserved', 'settled', 'released']);
const TRANSACTION_TYPES = new Set(['credit', 'reserve', 'debit', 'release']);

function createServiceError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertPositiveInteger(units) {
  if (!Number.isInteger(units) || units <= 0) {
    throw createServiceError('Point units must be a positive integer', 'INVALID_POINT_UNITS');
  }
}

function invalidPersistedPoints(message) {
  throw createServiceError(message, 'INVALID_PERSISTED_POINTS');
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isTimestamp(value) {
  return isNonNegativeSafeInteger(value);
}

function validatePersistedFinancialData(data) {
  for (const [userKey, user] of Object.entries(data.authUsers)) {
    if (!isRecord(user) || user.id !== userKey) {
      invalidPersistedPoints('Persisted point user identity is invalid');
    }
    if (Object.hasOwn(user, 'balanceUnits') && !isNonNegativeSafeInteger(user.balanceUnits)) {
      invalidPersistedPoints('Persisted user balance is invalid');
    }
  }

  for (const [taskKey, reservation] of Object.entries(data.pointReservations)) {
    if (
      !isRecord(reservation)
      || reservation.taskId !== taskKey
      || !isNonEmptyString(reservation.userId)
      || !Object.hasOwn(data.authUsers, reservation.userId)
      || !Number.isSafeInteger(reservation.costUnits)
      || reservation.costUnits <= 0
      || !MEDIA_TASK_TYPES.has(reservation.taskType)
      || !RESERVATION_STATUSES.has(reservation.status)
      || !isTimestamp(reservation.createdAt)
    ) {
      invalidPersistedPoints('Persisted point reservation is invalid');
    }
    const isReserved = reservation.status === 'reserved';
    if (
      (isReserved && (reservation.success !== null || reservation.settledAt !== null))
      || (!isReserved && (
        reservation.success !== (reservation.status === 'settled')
        || !isTimestamp(reservation.settledAt)
        || reservation.settledAt < reservation.createdAt
      ))
    ) {
      invalidPersistedPoints('Persisted point reservation settlement is invalid');
    }
    const hasSessionId = isNonEmptyString(reservation.sessionId);
    const hasMessageId = isNonEmptyString(reservation.messageId);
    if (hasSessionId !== hasMessageId) {
      invalidPersistedPoints('Persisted point reservation link is invalid');
    }
  }

  const transactionIds = new Set();
  for (const transaction of data.pointTransactions) {
    if (
      !isRecord(transaction)
      || !isNonEmptyString(transaction.id)
      || transactionIds.has(transaction.id)
      || !TRANSACTION_TYPES.has(transaction.type)
      || !isNonEmptyString(transaction.userId)
      || !Object.hasOwn(data.authUsers, transaction.userId)
      || !Number.isSafeInteger(transaction.units)
      || !isNonNegativeSafeInteger(transaction.balanceUnits)
      || !isNonNegativeSafeInteger(transaction.availableUnits)
      || !isTimestamp(transaction.createdAt)
    ) {
      invalidPersistedPoints('Persisted point transaction is invalid');
    }
    transactionIds.add(transaction.id);
    if (transaction.type === 'credit') {
      if (transaction.units <= 0) {
        invalidPersistedPoints('Persisted point credit is invalid');
      }
      continue;
    }
    if (
      !isNonEmptyString(transaction.taskId)
      || !MEDIA_TASK_TYPES.has(transaction.taskType)
      || !Number.isSafeInteger(transaction.costUnits)
      || transaction.costUnits <= 0
    ) {
      invalidPersistedPoints('Persisted media point transaction is invalid');
    }
    const expectedUnits = transaction.type === 'debit' ? -transaction.costUnits : 0;
    if (transaction.units !== expectedUnits) {
      invalidPersistedPoints('Persisted media point transaction units are invalid');
    }
  }

  const codeHashes = new Set();
  for (const [codeKey, record] of Object.entries(data.redeemCodes)) {
    if (
      !isRecord(record)
      || record.id !== codeKey
      || !/^[a-f0-9]{64}$/u.test(record.codeHash)
      || codeHashes.has(record.codeHash)
      || !Number.isSafeInteger(record.units)
      || record.units <= 0
      || !isTimestamp(record.createdAt)
    ) {
      invalidPersistedPoints('Persisted redeem code is invalid');
    }
    codeHashes.add(record.codeHash);
    const isUnused = record.usedBy === null && record.usedAt === null;
    const isUsed = isNonEmptyString(record.usedBy)
      && Object.hasOwn(data.authUsers, record.usedBy)
      && isTimestamp(record.usedAt)
      && record.usedAt >= record.createdAt;
    if (!isUnused && !isUsed) {
      invalidPersistedPoints('Persisted redeem code usage is invalid');
    }
  }
}

function pickRandomCharacter(characters) {
  return characters[randomInt(characters.length)];
}

function generateSecureRedeemCode() {
  const characters = [
    pickRandomCharacter(UPPERCASE),
    pickRandomCharacter(LOWERCASE),
    pickRandomCharacter(DIGITS),
  ];
  while (characters.length < 8) {
    characters.push(pickRandomCharacter(REDEEM_CODE_ALPHABET));
  }
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join('');
}

function hashRedeemCode(code, secret) {
  return createHmac('sha256', secret).update(code, 'utf8').digest('hex');
}

export function createPointsService({
  data,
  saveData,
  now = Date.now,
  codeFactory,
  redeemCodeHmacSecret,
} = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof saveData !== 'function') {
    throw new TypeError('createPointsService requires data and saveData');
  }
  if (
    typeof redeemCodeHmacSecret !== 'string'
    || Buffer.byteLength(redeemCodeHmacSecret, 'utf8') < 32
  ) {
    throw new TypeError('redeemCodeHmacSecret must be explicitly provided and contain at least 32 bytes');
  }

  for (const key of ['authUsers', 'pointReservations', 'redeemCodes']) {
    if (!Object.hasOwn(data, key)) {
      data[key] = {};
    } else if (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key])) {
      throw createServiceError(`${key} must be a persisted object`, 'INVALID_PERSISTED_POINTS');
    }
  }
  if (!Object.hasOwn(data, 'pointTransactions')) {
    data.pointTransactions = [];
  } else if (!Array.isArray(data.pointTransactions)) {
    throw createServiceError(
      'pointTransactions must be a persisted array',
      'INVALID_PERSISTED_POINTS',
    );
  }
  validatePersistedFinancialData(data);

  function getRedeemCodeRecords() {
    return Object.values(data.redeemCodes);
  }

  function isRedeemCodeUsed(record) {
    return record?.usedAt != null || record?.usedBy != null;
  }

  function pruneUsedRedeemCodes() {
    const records = Object.entries(data.redeemCodes);
    let excess = records.length - MAX_REDEEM_CODE_RECORDS;
    if (excess <= 0) {
      return [];
    }

    const usedRecords = records
      .filter(([, record]) => isRedeemCodeUsed(record))
      .map(([id, record], index) => ({
        id,
        timestamp: Number(record?.usedAt ?? record?.createdAt) || 0,
        index,
      }))
      .sort((left, right) => left.timestamp - right.timestamp || left.index - right.index);
    const pruned = [];
    for (const record of usedRecords) {
      if (excess <= 0) {
        break;
      }
      delete data.redeemCodes[record.id];
      pruned.push(record.id);
      excess -= 1;
    }
    return pruned;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function restoreCollection(reference, snapshot) {
    if (Array.isArray(reference)) {
      reference.splice(0, reference.length, ...snapshot);
      return;
    }

    for (const key of Object.keys(reference)) {
      delete reference[key];
    }
    Object.assign(reference, snapshot);
  }

  function createTransactionalSnapshot() {
    return Object.fromEntries(TRANSACTIONAL_COLLECTION_KEYS.map(key => [key, {
      reference: data[key],
      value: clone(data[key]),
    }]));
  }

  function restoreTransactionalSnapshot(snapshot) {
    for (const key of TRANSACTIONAL_COLLECTION_KEYS) {
      const collection = snapshot[key];
      restoreCollection(collection.reference, collection.value);
      data[key] = collection.reference;
    }
  }

  function persistMutation(mutate) {
    const snapshot = createTransactionalSnapshot();
    try {
      const result = mutate();
      saveData(data);
      return result;
    } catch (error) {
      restoreTransactionalSnapshot(snapshot);
      throw error;
    }
  }

  function getUser(userId) {
    const normalizedUserId = String(userId || '').trim();
    const user = Object.hasOwn(data.authUsers, normalizedUserId)
      ? data.authUsers[normalizedUserId]
      : null;
    if (!user) {
      throw createServiceError('User not found', 'USER_NOT_FOUND');
    }
    return user;
  }

  function getBalance(userId) {
    const user = getUser(userId);
    const balanceUnits = Number.isInteger(user.balanceUnits) ? user.balanceUnits : 0;
    const reservedUnits = Object.values(data.pointReservations)
      .filter(reservation => reservation?.userId === user.id && reservation.status === 'reserved')
      .reduce((total, reservation) => total + reservation.costUnits, 0);
    return { balanceUnits, availableUnits: balanceUnits - reservedUnits };
  }

  function findPersistedTaskMessage(reservation) {
    const ownerId = String(reservation.userId || '').trim();
    const sessionId = String(reservation.sessionId || '').trim();
    const messageId = String(reservation.messageId || '').trim();
    if (!ownerId || !sessionId || !messageId) {
      return null;
    }
    if (!data.aiSessions || typeof data.aiSessions !== 'object' || Array.isArray(data.aiSessions)) {
      return null;
    }

    const sessions = data.aiSessions[ownerId];
    if (!Array.isArray(sessions)) {
      return null;
    }
    const session = sessions.find(candidate => String(candidate?.id || '') === sessionId);
    if (!session || !Array.isArray(session.messages)) {
      return null;
    }
    return session.messages.find(candidate => String(candidate?.id || '') === messageId) || null;
  }

  function isMatchingCompletedVideoJob(reservation, videoJob) {
    const taskId = String(reservation.taskId || '').trim();
    const ownerId = String(reservation.userId || '').trim();
    const sessionId = String(reservation.sessionId || '').trim();
    const messageId = String(reservation.messageId || '').trim();
    if (
      reservation.taskType !== 'video'
      || !taskId
      || !ownerId
      || !sessionId
      || !messageId
      || String(videoJob?.id || '').trim() !== taskId
      || String(videoJob?.status || '').toLowerCase() !== 'completed'
    ) {
      return false;
    }

    const optionalMatches = (field, expected) => (
      videoJob[field] === undefined
      || videoJob[field] === null
      || String(videoJob[field]).trim() === expected
    );
    return optionalMatches('ownerId', ownerId)
      && optionalMatches('ownerType', 'user')
      && optionalMatches('sessionId', sessionId)
      && optionalMatches('messageId', messageId)
      && optionalMatches('type', 'video')
      && optionalMatches('taskType', 'video');
  }

  function hasPersistedSuccessEvidence(reservation) {
    const taskId = String(reservation.taskId || '');
    const videoJob = data.videoJobs && typeof data.videoJobs === 'object'
      ? data.videoJobs[taskId]
      : null;
    if (isMatchingCompletedVideoJob(reservation, videoJob)) {
      return true;
    }

    const message = findPersistedTaskMessage(reservation);
    const isTerminalSuccess = message?.role === 'assistant'
      && ['sent', 'completed'].includes(String(message?.status || '').toLowerCase());
    if (!isTerminalSuccess) {
      return false;
    }
    if (reservation.taskType === 'video') {
      return Boolean(String(message?.videoUrl || '').trim());
    }
    if (reservation.taskType === 'image') {
      return Array.isArray(message?.images) && message.images.some(image => String(image || '').trim());
    }
    return false;
  }

  function pruneTerminalReservations(protectedTaskIds = new Set()) {
    const terminalReservations = Object.entries(data.pointReservations)
      .filter(([, reservation]) => reservation?.status !== 'reserved')
      .map(([taskId, reservation], index) => ({
        taskId,
        timestamp: Number(reservation?.settledAt ?? reservation?.createdAt) || 0,
        index,
      }))
      .sort((left, right) => left.timestamp - right.timestamp || left.index - right.index);
    let excess = terminalReservations.length - MAX_TERMINAL_POINT_RESERVATIONS;
    if (excess <= 0) {
      return [];
    }

    const pruned = [];
    for (const candidate of terminalReservations) {
      if (excess <= 0) {
        break;
      }
      if (protectedTaskIds.has(candidate.taskId)) {
        continue;
      }
      delete data.pointReservations[candidate.taskId];
      pruned.push(candidate.taskId);
      excess -= 1;
    }
    return pruned;
  }

  function addTransaction(transaction) {
    const snapshot = getBalance(transaction.userId);
    data.pointTransactions.push({
      id: `point-${randomUUID()}`,
      ...transaction,
      ...snapshot,
      createdAt: now(),
    });
    if (data.pointTransactions.length > MAX_POINT_TRANSACTIONS) {
      data.pointTransactions.splice(
        0,
        data.pointTransactions.length - MAX_POINT_TRANSACTIONS,
      );
    }
  }

  function credit(userId, units, reason = 'credit') {
    assertPositiveInteger(units);
    const user = getUser(userId);
    return persistMutation(() => {
      user.balanceUnits = (Number.isInteger(user.balanceUnits) ? user.balanceUnits : 0) + units;
      addTransaction({ type: 'credit', userId: user.id, units, reason: String(reason || 'credit') });
      return getBalance(user.id);
    });
  }

  function reserve({ taskId, userId, costUnits, taskType } = {}) {
    assertPositiveInteger(costUnits);
    const normalizedTaskId = String(taskId || '').trim();
    const normalizedTaskType = String(taskType || '');
    if (!normalizedTaskId) {
      throw createServiceError('Task ID is required', 'INVALID_TASK_ID');
    }
    const user = getUser(userId);
    const existing = data.pointReservations[normalizedTaskId];
    if (existing) {
      const matches = existing.userId === user.id
        && existing.costUnits === costUnits
        && existing.taskType === normalizedTaskType;
      if (matches) {
        return existing;
      }
      throw createServiceError('Reservation already exists', 'RESERVATION_EXISTS');
    }
    if (getBalance(user.id).availableUnits < costUnits) {
      throw createServiceError('Insufficient points', 'INSUFFICIENT_POINTS');
    }

    return persistMutation(() => {
      const reservation = {
        taskId: normalizedTaskId,
        userId: user.id,
        costUnits,
        taskType: normalizedTaskType,
        status: 'reserved',
        success: null,
        createdAt: now(),
        settledAt: null,
      };
      data.pointReservations[normalizedTaskId] = reservation;
      addTransaction({
        type: 'reserve',
        userId: user.id,
        units: 0,
        costUnits,
        taskId: normalizedTaskId,
        taskType: reservation.taskType,
      });
      pruneTerminalReservations();
      return reservation;
    });
  }

  function linkMediaTask(taskId, { sessionId, messageId } = {}) {
    const normalizedTaskId = String(taskId || '').trim();
    const normalizedSessionId = String(sessionId || '').trim();
    const normalizedMessageId = String(messageId || '').trim();
    const reservation = data.pointReservations[normalizedTaskId];
    if (!reservation) {
      throw createServiceError('Reservation not found', 'RESERVATION_NOT_FOUND');
    }
    if (!normalizedSessionId || !normalizedMessageId) {
      throw createServiceError('Media task context is required', 'INVALID_TASK_CONTEXT');
    }
    if (reservation.status !== 'reserved') {
      return reservation;
    }
    if (
      (reservation.sessionId && reservation.sessionId !== normalizedSessionId)
      || (reservation.messageId && reservation.messageId !== normalizedMessageId)
    ) {
      throw createServiceError('Reservation is linked to another task context', 'RESERVATION_CONTEXT_MISMATCH');
    }
    if (
      reservation.sessionId === normalizedSessionId
      && reservation.messageId === normalizedMessageId
    ) {
      return reservation;
    }

    return persistMutation(() => {
      reservation.sessionId = normalizedSessionId;
      reservation.messageId = normalizedMessageId;
      return reservation;
    });
  }

  function settleReservation(reservation, success, reason) {
    if (reservation.status !== 'reserved') {
      return false;
    }

    reservation.status = success ? 'settled' : 'released';
    reservation.success = Boolean(success);
    reservation.settledAt = now();
    if (reason) {
      reservation.settlementReason = reason;
      if (!success) {
        reservation.releaseReason = reason;
      }
    }
    if (success) {
      const user = getUser(reservation.userId);
      user.balanceUnits = (Number.isInteger(user.balanceUnits) ? user.balanceUnits : 0)
        - reservation.costUnits;
    }
    addTransaction({
      type: success ? 'debit' : 'release',
      userId: reservation.userId,
      units: success ? -reservation.costUnits : 0,
      costUnits: reservation.costUnits,
      taskId: reservation.taskId,
      taskType: reservation.taskType,
      ...(reason ? { reason } : {}),
    });
    return true;
  }

  function settle(taskId, success) {
    const reservation = data.pointReservations[String(taskId || '')];
    if (!reservation) {
      throw createServiceError('Reservation not found', 'RESERVATION_NOT_FOUND');
    }
    if (reservation.status !== 'reserved') {
      return reservation;
    }
    return persistMutation(() => {
      settleReservation(reservation, Boolean(success));
      pruneTerminalReservations(new Set([reservation.taskId]));
      return reservation;
    });
  }

  function reconcileReservations(activeTaskIds = []) {
    const activeIds = new Set(activeTaskIds || []);
    const orphanedReservations = Object.values(data.pointReservations)
      .filter(reservation => (
        reservation?.status === 'reserved' && !activeIds.has(reservation.taskId)
      ));
    const terminalCount = Object.values(data.pointReservations)
      .filter(reservation => reservation?.status !== 'reserved')
      .length;
    if (
      orphanedReservations.length === 0
      && terminalCount <= MAX_TERMINAL_POINT_RESERVATIONS
    ) {
      return [];
    }
    return persistMutation(() => {
      for (const reservation of orphanedReservations) {
        const success = hasPersistedSuccessEvidence(reservation);
        settleReservation(
          reservation,
          success,
          success ? 'recovered_success' : 'orphaned',
        );
      }
      pruneTerminalReservations();
      return orphanedReservations.map(reservation => reservation.taskId);
    });
  }

  function generateRedeemCode(units) {
    assertPositiveInteger(units);
    const unusedCodeCount = getRedeemCodeRecords()
      .filter(record => !isRedeemCodeUsed(record))
      .length;
    if (unusedCodeCount >= MAX_UNUSED_REDEEM_CODES) {
      throw createServiceError(
        'Unused redeem code limit reached',
        'REDEEM_CODE_LIMIT_REACHED',
      );
    }

    let code;
    let codeHash;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      code = String(codeFactory ? codeFactory() : generateSecureRedeemCode());
      const isValidCode = /^[A-Za-z0-9]{8}$/u.test(code)
        && /[A-Z]/u.test(code)
        && /[a-z]/u.test(code)
        && /[0-9]/u.test(code);
      if (!isValidCode) {
        throw createServiceError(
          'Redeem codes must be eight alphanumeric characters with uppercase, lowercase, and digits',
          'INVALID_REDEEM_CODE',
        );
      }
      codeHash = hashRedeemCode(code, redeemCodeHmacSecret);
      if (!getRedeemCodeRecords().some(record => record?.codeHash === codeHash)) {
        break;
      }
      code = undefined;
      codeHash = undefined;
    }
    if (!code || !codeHash) {
      throw createServiceError('Could not generate a unique redeem code', 'REDEEM_CODE_COLLISION');
    }

    const record = {
      id: `redeem-${randomUUID()}`,
      codeHash,
      units,
      createdAt: now(),
      usedBy: null,
      usedAt: null,
    };
    return persistMutation(() => {
      data.redeemCodes[record.id] = record;
      pruneUsedRedeemCodes();
      return {
        id: record.id,
        code,
        maskedCode: REDEEM_CODE_DISPLAY_MASK,
        units: record.units,
        createdAt: record.createdAt,
      };
    });
  }

  function redeemCode(userId, code) {
    const user = getUser(userId);
    if (typeof code !== 'string' || code.length === 0) {
      throw createServiceError('Invalid redeem code', 'INVALID_REDEEM_CODE');
    }
    const codeHash = hashRedeemCode(code, redeemCodeHmacSecret);
    const record = getRedeemCodeRecords()
      .find(candidate => candidate?.codeHash === codeHash);
    if (!record) {
      throw createServiceError('Invalid redeem code', 'INVALID_REDEEM_CODE');
    }
    if (record.usedAt !== null || record.usedBy !== null) {
      throw createServiceError('Redeem code already used', 'REDEEM_CODE_ALREADY_USED');
    }

    return persistMutation(() => {
      record.usedBy = user.id;
      record.usedAt = now();
      user.balanceUnits = (Number.isInteger(user.balanceUnits) ? user.balanceUnits : 0) + record.units;
      addTransaction({
        type: 'credit',
        userId: user.id,
        units: record.units,
        reason: 'redeem',
        redeemCodeId: record.id,
      });
      pruneUsedRedeemCodes();
      return { creditedUnits: record.units, ...getBalance(user.id) };
    });
  }

  function listMaskedCodes() {
    return getRedeemCodeRecords()
      .filter(record => record && typeof record === 'object')
      .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
      .slice(0, MAX_LISTED_REDEEM_CODES)
      .map(record => ({
        id: record.id,
        maskedCode: REDEEM_CODE_DISPLAY_MASK,
        units: record.units,
        createdAt: record.createdAt,
        used: isRedeemCodeUsed(record),
        usedBy: record.usedBy ?? null,
        usedAt: record.usedAt ?? null,
      }));
  }

  return {
    getBalance,
    credit,
    reserve,
    linkMediaTask,
    settle,
    reconcileReservations,
    generateRedeemCode,
    redeemCode,
    listMaskedCodes,
  };
}
