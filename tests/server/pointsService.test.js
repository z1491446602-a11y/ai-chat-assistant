import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_LISTED_REDEEM_CODES,
  MAX_POINT_TRANSACTIONS,
  MAX_REDEEM_CODE_UNITS,
  MAX_REDEEM_CODE_RECORDS,
  MAX_TERMINAL_POINT_RESERVATIONS,
  MAX_UNUSED_REDEEM_CODES,
  MEDIA_COST_UNITS,
  POINT_UNITS_PER_POINT,
  createPointsService,
} from '../../server/pointsService.js';

const TEST_REDEEM_SECRET = '0123456789abcdef0123456789abcdef';
const OTHER_REDEEM_SECRET = 'abcdef0123456789abcdef0123456789';
const MAX_REDEEM_CODE_UNITS_FOR_TEST = 10_000_000;

function createHarness({
  balanceUnits = 0,
  now = () => 1_000,
  codeFactory,
  pointTransactions = [],
  saveData = vi.fn(),
  redeemCodeHmacSecret = TEST_REDEEM_SECRET,
} = {}) {
  const data = {
    authUsers: { 'user-1': { id: 'user-1', balanceUnits } },
    pointReservations: {},
    pointTransactions,
    redeemCodes: {},
  };
  const points = createPointsService({
    data,
    saveData,
    now,
    codeFactory,
    redeemCodeHmacSecret,
  });
  return { data, saveData, points };
}

function expectPersistenceRollback({ data, saveData }, action) {
  const sharedDataReference = data;
  const before = JSON.parse(JSON.stringify(data));
  const persistenceError = new Error('disk full');
  saveData.mockImplementation(() => {
    throw persistenceError;
  });

  expect(action).toThrow(persistenceError);
  expect(data).toBe(sharedDataReference);
  expect(data).toEqual(before);
}

describe('points service', () => {
  it('initializes missing point collections for a new data store', () => {
    const data = {};

    createPointsService({
      data,
      saveData: vi.fn(),
      redeemCodeHmacSecret: TEST_REDEEM_SECRET,
    });

    expect(data).toMatchObject({
      authUsers: {},
      pointReservations: {},
      pointTransactions: [],
      redeemCodes: {},
    });
  });

  it.each([
    ['authUsers', { authUsers: [] }],
    ['pointReservations', { pointReservations: 'corrupted' }],
    ['pointTransactions', { pointTransactions: {} }],
    ['redeemCodes', { redeemCodes: null }],
  ])('fails closed when persisted %s has the wrong type', (_label, data) => {
    expect(() => createPointsService({
      data,
      saveData: vi.fn(),
      redeemCodeHmacSecret: TEST_REDEEM_SECRET,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_PERSISTED_POINTS' }));
  });

  it.each([
    ['missing', undefined],
    ['NaN', Number.NaN],
    ['negative', -1],
  ])('fails closed when a persisted reservation has %s costUnits', (_label, costUnits) => {
    const reservation = {
      taskId: 'task-1',
      userId: 'user-1',
      costUnits,
      taskType: 'image',
      status: 'reserved',
      success: null,
      createdAt: 1_000,
      settledAt: null,
    };
    if (costUnits === undefined) delete reservation.costUnits;
    const data = {
      authUsers: { 'user-1': { id: 'user-1', balanceUnits: 0 } },
      pointReservations: { 'task-1': reservation },
      pointTransactions: [],
      redeemCodes: {},
    };

    expect(() => createPointsService({
      data,
      saveData: vi.fn(),
      redeemCodeHmacSecret: TEST_REDEEM_SECRET,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_PERSISTED_POINTS' }));
  });

  it.each([
    ['transaction', {
      pointTransactions: [{
        id: 'tx-1', type: 'debit', userId: 'user-1', units: -2, costUnits: -2,
        taskId: 'task-1', taskType: 'image', balanceUnits: 0, availableUnits: 0,
        createdAt: 1_000,
      }],
    }],
    ['redeem code', {
      redeemCodes: {
        'code-1': {
          id: 'code-1', codeHash: 'not-a-hash', units: 10, createdAt: 1_000,
          usedBy: null, usedAt: null,
        },
      },
    }],
    ['user balance', { authUsers: { 'user-1': { id: 'user-1', balanceUnits: -1 } } }],
    ['reservation owner', {
      pointReservations: {
        'task-1': {
          taskId: 'task-1', userId: 'toString', costUnits: 2, taskType: 'image',
          status: 'reserved', success: null, createdAt: 1_000, settledAt: null,
        },
      },
    }],
  ])('fails closed when a persisted %s has invalid financial fields', (_label, overrides) => {
    const data = {
      authUsers: { 'user-1': { id: 'user-1', balanceUnits: 0 } },
      pointReservations: {},
      pointTransactions: [],
      redeemCodes: {},
      ...overrides,
    };

    expect(() => createPointsService({
      data,
      saveData: vi.fn(),
      redeemCodeHmacSecret: TEST_REDEEM_SECRET,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_PERSISTED_POINTS' }));
  });

  it('loads legacy over-limit codes but refuses to redeem an unused one', () => {
    const unusedCodeHash = createHmac('sha256', TEST_REDEEM_SECRET)
      .update('Aa1Bb2Cc', 'utf8')
      .digest('hex');
    const data = {
      authUsers: { 'user-1': { id: 'user-1', balanceUnits: 0 } },
      pointReservations: {},
      pointTransactions: [],
      redeemCodes: {
        used: {
          id: 'used', codeHash: 'a'.repeat(64),
          units: MAX_REDEEM_CODE_UNITS_FOR_TEST + 1, createdAt: 1_000,
          usedBy: 'user-1', usedAt: 1_001,
        },
        unused: {
          id: 'unused', codeHash: unusedCodeHash,
          units: MAX_REDEEM_CODE_UNITS_FOR_TEST + 1, createdAt: 1_000,
          usedBy: null, usedAt: null,
        },
      },
    };
    const saveData = vi.fn();
    const points = createPointsService({
      data,
      saveData,
      redeemCodeHmacSecret: TEST_REDEEM_SECRET,
    });

    expect(() => points.redeemCode('user-1', 'Aa1Bb2Cc')).toThrowError(
      expect.objectContaining({ code: 'REDEEM_CODE_POINT_LIMIT_EXCEEDED' }),
    );
    expect(data.redeemCodes.unused).toMatchObject({ usedBy: null, usedAt: null });
    expect(data.authUsers['user-1'].balanceUnits).toBe(0);
    expect(data.pointTransactions).toEqual([]);
    expect(saveData).not.toHaveBeenCalled();
  });

  it('fails closed when active reservations exceed the persisted user balance', () => {
    const data = {
      authUsers: { 'user-1': { id: 'user-1', balanceUnits: 2 } },
      pointReservations: {
        'task-1': {
          taskId: 'task-1', userId: 'user-1', costUnits: 1, taskType: 'image',
          status: 'reserved', success: null, createdAt: 1_000, settledAt: null,
        },
        'task-2': {
          taskId: 'task-2', userId: 'user-1', costUnits: 2, taskType: 'video',
          status: 'reserved', success: null, createdAt: 1_001, settledAt: null,
        },
      },
      pointTransactions: [],
      redeemCodes: {},
    };

    expect(() => createPointsService({
      data,
      saveData: vi.fn(),
      redeemCodeHmacSecret: TEST_REDEEM_SECRET,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_PERSISTED_POINTS' }));
  });

  it('accepts active reservations whose total exactly matches the user balance', () => {
    const data = {
      authUsers: { 'user-1': { id: 'user-1', balanceUnits: 3 } },
      pointReservations: {
        'task-1': {
          taskId: 'task-1', userId: 'user-1', costUnits: 1, taskType: 'image',
          status: 'reserved', success: null, createdAt: 1_000, settledAt: null,
        },
        'task-2': {
          taskId: 'task-2', userId: 'user-1', costUnits: 2, taskType: 'video',
          status: 'reserved', success: null, createdAt: 1_001, settledAt: null,
        },
      },
      pointTransactions: [],
      redeemCodes: {},
    };

    const points = createPointsService({
      data,
      saveData: vi.fn(),
      redeemCodeHmacSecret: TEST_REDEEM_SECRET,
    });

    expect(points.getBalance('user-1')).toEqual({ balanceUnits: 3, availableUnits: 0 });
  });

  it('credits, reserves, and settles integer point units', () => {
    const { points, saveData } = createHarness();

    points.credit('user-1', 20, 'test credit');
    points.reserve({
      taskId: 'image-1',
      userId: 'user-1',
      costUnits: 2,
      taskType: 'image',
    });

    expect(points.getBalance('user-1')).toEqual({
      balanceUnits: 20,
      availableUnits: 18,
    });

    points.settle('image-1', true);
    expect(points.getBalance('user-1')).toEqual({
      balanceUnits: 18,
      availableUnits: 18,
    });
    expect(saveData).toHaveBeenCalled();
  });

  it('defines one tenth of a point as one unit and fixed media costs', () => {
    expect(POINT_UNITS_PER_POINT).toBe(10);
    expect(MEDIA_COST_UNITS).toEqual({ gpt: 2, grok: 1, video: 15 });
    expect(MAX_REDEEM_CODE_UNITS).toBe(MAX_REDEEM_CODE_UNITS_FOR_TEST);
  });

  it('reads and mutates only authenticated users', () => {
    const { data, points } = createHarness({ balanceUnits: 5 });
    data.users = { 'user-1': { id: 'user-1', balanceUnits: 500 } };

    points.credit('user-1', 3, 'authenticated account');

    expect(data.authUsers['user-1'].balanceUnits).toBe(8);
    expect(data.users['user-1'].balanceUnits).toBe(500);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid credit units: %s',
    units => {
      const { points } = createHarness();
      expect(() => points.credit('user-1', units, 'invalid')).toThrowError(
        expect.objectContaining({ code: 'INVALID_POINT_UNITS' }),
      );
    },
  );

  it('rejects a credit that would overflow the user balance without mutating data', () => {
    const harness = createHarness({ balanceUnits: Number.MAX_SAFE_INTEGER });
    const before = JSON.parse(JSON.stringify(harness.data));

    expect(() => harness.points.credit('user-1', 1, 'overflow')).toThrowError(
      expect.objectContaining({ code: 'POINT_BALANCE_LIMIT_EXCEEDED' }),
    );
    expect(harness.data).toEqual(before);
    expect(harness.saveData).not.toHaveBeenCalled();
  });

  it('rejects a reservation when available units are insufficient', () => {
    const { points } = createHarness({ balanceUnits: 2 });
    points.reserve({ taskId: 'first', userId: 'user-1', costUnits: 2, taskType: 'image' });

    expect(() => points.reserve({
      taskId: 'second',
      userId: 'user-1',
      costUnits: 1,
      taskType: 'image',
    })).toThrowError(expect.objectContaining({ code: 'INSUFFICIENT_POINTS' }));
  });

  it('treats an equivalent repeated reservation as idempotent after normalization', () => {
    const { points, saveData } = createHarness({ balanceUnits: 10 });
    const first = points.reserve({ taskId: 'normalized', userId: 'user-1', costUnits: 2 });
    const savesAfterFirstReservation = saveData.mock.calls.length;

    const repeated = points.reserve({ taskId: ' normalized ', userId: ' user-1 ', costUnits: 2 });

    expect(repeated).toBe(first);
    expect(saveData).toHaveBeenCalledTimes(savesAfterFirstReservation);
  });

  it('settles a successful reservation only once', () => {
    const { data, points, saveData } = createHarness({ balanceUnits: 10 });
    points.reserve({ taskId: 'image-1', userId: 'user-1', costUnits: 2, taskType: 'image' });
    points.settle('image-1', true);
    const savesAfterFirstSettlement = saveData.mock.calls.length;

    const repeated = points.settle('image-1', true);

    expect(repeated).toMatchObject({ status: 'settled', success: true });
    expect(points.getBalance('user-1')).toEqual({ balanceUnits: 8, availableUnits: 8 });
    expect(data.pointTransactions.filter(item => item.type === 'debit')).toHaveLength(1);
    expect(saveData).toHaveBeenCalledTimes(savesAfterFirstSettlement);
  });

  it('releases a failed reservation only once without debiting balance', () => {
    const { data, points, saveData } = createHarness({ balanceUnits: 10 });
    points.reserve({ taskId: 'video-1', userId: 'user-1', costUnits: 7, taskType: 'video' });
    points.settle('video-1', false);
    const savesAfterFirstSettlement = saveData.mock.calls.length;

    const repeated = points.settle('video-1', false);

    expect(repeated).toMatchObject({ status: 'released', success: false });
    expect(points.getBalance('user-1')).toEqual({ balanceUnits: 10, availableUnits: 10 });
    expect(data.pointTransactions.filter(item => item.type === 'release')).toHaveLength(1);
    expect(saveData).toHaveBeenCalledTimes(savesAfterFirstSettlement);
  });

  it('releases orphaned reservations while preserving active tasks', () => {
    const { data, points } = createHarness({ balanceUnits: 20 });
    points.reserve({ taskId: 'active', userId: 'user-1', costUnits: 3, taskType: 'image' });
    points.reserve({ taskId: 'orphan', userId: 'user-1', costUnits: 5, taskType: 'video' });

    expect(points.reconcileReservations(['active'])).toEqual(['orphan']);
    expect(data.pointReservations.active.status).toBe('reserved');
    expect(data.pointReservations.orphan.status).toBe('released');
    expect(points.getBalance('user-1')).toEqual({ balanceUnits: 20, availableUnits: 17 });
  });

  it('settles a reserved image after restart when its persisted assistant message succeeded', () => {
    const { data, points } = createHarness({ balanceUnits: 20 });
    points.reserve({ taskId: 'image-recovered', userId: 'user-1', costUnits: 2, taskType: 'image' });
    points.linkMediaTask('image-recovered', {
      sessionId: 'session-image',
      messageId: 'message-image',
    });
    data.aiSessions = {
      'user-1': [{
        id: 'session-image',
        messages: [{
          id: 'message-image',
          role: 'assistant',
          status: 'sent',
          images: ['/uploads/recovered.png'],
        }],
      }],
    };

    expect(points.reconcileReservations([])).toEqual(['image-recovered']);
    expect(data.pointReservations['image-recovered']).toMatchObject({
      status: 'settled',
      success: true,
    });
    expect(points.getBalance('user-1')).toEqual({ balanceUnits: 18, availableUnits: 18 });
  });

  it('does not accept matching session and message IDs from another owner bucket', () => {
    const { data, points } = createHarness({ balanceUnits: 20 });
    points.reserve({ taskId: 'image-cross-owner', userId: 'user-1', costUnits: 2, taskType: 'image' });
    points.linkMediaTask('image-cross-owner', {
      sessionId: 'shared-session',
      messageId: 'shared-message',
    });
    data.aiSessions = {
      'other-user': [{
        id: 'shared-session',
        messages: [{
          id: 'shared-message',
          role: 'assistant',
          status: 'sent',
          images: ['/uploads/other-user.png'],
        }],
      }],
    };

    points.reconcileReservations([]);

    expect(data.pointReservations['image-cross-owner']).toMatchObject({
      status: 'released',
      success: false,
    });
    expect(points.getBalance('user-1')).toEqual({ balanceUnits: 20, availableUnits: 20 });
  });

  it('does not fall back to an older image when reservation messageId is missing', () => {
    const { data, points } = createHarness({ balanceUnits: 20 });
    points.reserve({ taskId: 'image-no-message', userId: 'user-1', costUnits: 2, taskType: 'image' });
    data.pointReservations['image-no-message'].sessionId = 'session-image';
    data.aiSessions = {
      'user-1': [{
        id: 'session-image',
        pendingTaskId: 'image-no-message',
        messages: [{
          id: 'older-success',
          role: 'assistant',
          status: 'sent',
          images: ['/uploads/older.png'],
        }],
      }],
    };

    points.reconcileReservations([]);

    expect(data.pointReservations['image-no-message']).toMatchObject({
      status: 'released',
      success: false,
    });
    expect(points.getBalance('user-1')).toEqual({ balanceUnits: 20, availableUnits: 20 });
  });

  it('releases a linked reservation when its exact persisted result is missing', () => {
    const { data, points } = createHarness({ balanceUnits: 20 });
    points.reserve({ taskId: 'image-missing', userId: 'user-1', costUnits: 2, taskType: 'image' });
    points.linkMediaTask('image-missing', {
      sessionId: 'session-image',
      messageId: 'missing-message',
    });
    data.aiSessions = {
      'user-1': [{
        id: 'session-image',
        messages: [{
          id: 'older-success',
          role: 'assistant',
          status: 'sent',
          images: ['/uploads/older.png'],
        }],
      }],
    };

    points.reconcileReservations([]);

    expect(data.pointReservations['image-missing']).toMatchObject({
      status: 'released',
      success: false,
    });
    expect(points.getBalance('user-1')).toEqual({ balanceUnits: 20, availableUnits: 20 });
  });

  it('settles a reserved video after restart when its persisted video job completed', () => {
    const { data, points } = createHarness({ balanceUnits: 30 });
    points.reserve({ taskId: 'video-recovered', userId: 'user-1', costUnits: 15, taskType: 'video' });
    points.linkMediaTask('video-recovered', {
      sessionId: 'session-video',
      messageId: 'message-video',
    });
    data.videoJobs = {
      'video-recovered': {
        id: 'video-recovered',
        ownerId: 'user-1',
        ownerType: 'user',
        sessionId: 'session-video',
        messageId: 'message-video',
        status: 'completed',
      },
    };

    points.reconcileReservations([]);

    expect(data.pointReservations['video-recovered']).toMatchObject({
      status: 'settled',
      success: true,
    });
    expect(points.getBalance('user-1')).toEqual({ balanceUnits: 15, availableUnits: 15 });
  });

  it('rejects a completed video job whose persisted owner does not match the reservation', () => {
    const { data, points } = createHarness({ balanceUnits: 30 });
    points.reserve({ taskId: 'video-wrong-owner', userId: 'user-1', costUnits: 15, taskType: 'video' });
    points.linkMediaTask('video-wrong-owner', {
      sessionId: 'session-video',
      messageId: 'message-video',
    });
    data.videoJobs = {
      'video-wrong-owner': {
        id: 'video-wrong-owner',
        ownerId: 'other-user',
        ownerType: 'user',
        sessionId: 'session-video',
        messageId: 'message-video',
        status: 'completed',
      },
    };

    points.reconcileReservations([]);

    expect(data.pointReservations['video-wrong-owner']).toMatchObject({
      status: 'released',
      success: false,
    });
    expect(points.getBalance('user-1')).toEqual({ balanceUnits: 30, availableUnits: 30 });
  });

  it('bounds terminal reservations without pruning active or newly settled idempotency records', () => {
    const { data, points, saveData } = createHarness({ balanceUnits: 2_000 });
    for (let index = 0; index < MAX_TERMINAL_POINT_RESERVATIONS; index += 1) {
      const taskId = `terminal-${index}`;
      data.pointReservations[taskId] = {
        taskId,
        userId: 'user-1',
        costUnits: 1,
        taskType: 'image',
        status: 'released',
        success: false,
        createdAt: index,
        settledAt: index,
      };
    }
    data.pointReservations.active = {
      taskId: 'active',
      userId: 'user-1',
      costUnits: 1,
      taskType: 'image',
      status: 'reserved',
      success: null,
      createdAt: 1_000,
      settledAt: null,
    };
    points.reserve({ taskId: 'newly-settled', userId: 'user-1', costUnits: 2, taskType: 'image' });
    points.settle('newly-settled', true);
    const savesAfterSettlement = saveData.mock.calls.length;
    const debitsAfterSettlement = data.pointTransactions.filter(item => item.type === 'debit').length;

    expect(Object.values(data.pointReservations).filter(item => item.status !== 'reserved'))
      .toHaveLength(MAX_TERMINAL_POINT_RESERVATIONS);
    expect(data.pointReservations.active.status).toBe('reserved');
    expect(data.pointReservations['newly-settled']).toMatchObject({ status: 'settled', success: true });

    points.settle('newly-settled', true);
    expect(saveData).toHaveBeenCalledTimes(savesAfterSettlement);
    expect(data.pointTransactions.filter(item => item.type === 'debit'))
      .toHaveLength(debitsAfterSettlement);
  });

  it('records balance snapshots and caps the transaction audit trail', () => {
    const seededTransactions = Array.from(
      { length: MAX_POINT_TRANSACTIONS },
      (_, index) => ({
        id: `old-${index}`,
        type: 'credit',
        userId: 'user-1',
        units: 1,
        reason: 'seeded audit record',
        balanceUnits: 0,
        availableUnits: 0,
        createdAt: index,
      }),
    );
    const { data, points } = createHarness({ pointTransactions: seededTransactions });

    points.credit('user-1', 4, 'audit test');

    expect(data.pointTransactions).toHaveLength(MAX_POINT_TRANSACTIONS);
    expect(data.pointTransactions[0].id).toBe('old-1');
    expect(data.pointTransactions.at(-1)).toMatchObject({
      type: 'credit',
      userId: 'user-1',
      units: 4,
      balanceUnits: 4,
      availableUnits: 4,
    });
  });

  it.each([0, -2, 2.5, Number.MAX_SAFE_INTEGER + 1])(
    'requires positive safe integer redemption units: %s',
    units => {
      const { points } = createHarness({ codeFactory: () => 'Aa1Bb2Cc' });
      expect(() => points.generateRedeemCode(units)).toThrowError(
        expect.objectContaining({ code: 'INVALID_POINT_UNITS' }),
      );
    },
  );

  it('rejects a redeem code above the per-code point limit without persisting it', () => {
    const { data, points, saveData } = createHarness({ codeFactory: () => 'Aa1Bb2Cc' });

    expect(() => points.generateRedeemCode(MAX_REDEEM_CODE_UNITS_FOR_TEST + 1)).toThrowError(
      expect.objectContaining({ code: 'REDEEM_CODE_POINT_LIMIT_EXCEEDED' }),
    );
    expect(data.redeemCodes).toEqual({});
    expect(saveData).not.toHaveBeenCalled();
  });

  it.each([
    [undefined],
    ['short-secret'],
    ['密钥不足三十二字节'],
  ])('requires an explicitly injected redeem-code HMAC secret of at least 32 bytes: %s', redeemCodeHmacSecret => {
    const data = {
      authUsers: {},
      pointReservations: {},
      pointTransactions: [],
      redeemCodes: {},
    };

    expect(() => createPointsService({
      data,
      saveData: vi.fn(),
      redeemCodeHmacSecret,
    })).toThrow(/redeemCodeHmacSecret.*32 bytes/iu);
  });

  it('stores only a secret-keyed HMAC and never persists a narrowing code mask', () => {
    const { data, points } = createHarness({ codeFactory: () => 'Aa1Bb2Cc' });

    const generated = points.generateRedeemCode(25);

    expect(generated).toMatchObject({ code: 'Aa1Bb2Cc', maskedCode: '********', units: 25 });
    const storedCode = Object.values(data.redeemCodes)[0];
    expect(Object.values(data.redeemCodes)).toHaveLength(1);
    expect(storedCode).toMatchObject({
      codeHash: createHmac('sha256', TEST_REDEEM_SECRET).update('Aa1Bb2Cc', 'utf8').digest('hex'),
      units: 25,
      usedBy: null,
      usedAt: null,
    });
    expect(storedCode.codeHash).not.toBe(
      createHash('sha256').update('Aa1Bb2Cc', 'utf8').digest('hex'),
    );
    expect(storedCode).not.toHaveProperty('code');
    expect(storedCode).not.toHaveProperty('maskedCode');
    expect(JSON.stringify(data)).not.toContain('Aa1Bb2Cc');
    expect(JSON.stringify(data)).not.toContain('Aa****Cc');

    const listed = points.listMaskedCodes();
    expect(listed[0]).toMatchObject({ maskedCode: '********', units: 25, used: false });
    expect(listed[0]).not.toHaveProperty('code');
    expect(listed[0]).not.toHaveProperty('codeHash');
  });

  it('cannot redeem a stored code with a different HMAC secret', () => {
    const { data, points } = createHarness({ codeFactory: () => 'Aa1Bb2Cc' });
    points.generateRedeemCode(25);
    const pointsWithAnotherSecret = createPointsService({
      data,
      saveData: vi.fn(),
      redeemCodeHmacSecret: OTHER_REDEEM_SECRET,
    });

    expect(() => pointsWithAnotherSecret.redeemCode('user-1', 'Aa1Bb2Cc')).toThrowError(
      expect.objectContaining({ code: 'INVALID_REDEEM_CODE' }),
    );
  });

  it('rejects generation when unused redeem codes reach the hard limit', () => {
    const { data, points, saveData } = createHarness({ codeFactory: () => 'Aa1Bb2Cc' });
    for (let index = 0; index < MAX_UNUSED_REDEEM_CODES; index += 1) {
      data.redeemCodes[`unused-${index}`] = {
        id: `unused-${index}`,
        codeHash: `hash-${index}`,
        units: 1,
        createdAt: index,
        usedBy: null,
        usedAt: null,
      };
    }

    expect(() => points.generateRedeemCode(1)).toThrowError(
      expect.objectContaining({ code: 'REDEEM_CODE_LIMIT_REACHED' }),
    );
    expect(Object.keys(data.redeemCodes)).toHaveLength(MAX_UNUSED_REDEEM_CODES);
    expect(saveData).not.toHaveBeenCalled();
  });

  it('does not let unusable legacy over-limit codes exhaust the active code capacity', () => {
    const { data, points } = createHarness({ codeFactory: () => 'Aa1Bb2Cc' });
    for (let index = 0; index < MAX_UNUSED_REDEEM_CODES; index += 1) {
      data.redeemCodes[`legacy-${index}`] = {
        id: `legacy-${index}`,
        codeHash: `legacy-hash-${index}`,
        units: MAX_REDEEM_CODE_UNITS_FOR_TEST + 1,
        createdAt: index,
        usedBy: null,
        usedAt: null,
      };
    }

    const generated = points.generateRedeemCode(1);

    expect(generated).toMatchObject({ code: 'Aa1Bb2Cc', units: 1 });
    expect(data.redeemCodes[generated.id]).toBeDefined();
  });

  it('prunes the oldest used record before removing unused redeem codes', () => {
    const { data, points } = createHarness({
      codeFactory: () => 'Aa1Bb2Cc',
      now: () => MAX_REDEEM_CODE_RECORDS + 1,
    });
    for (let index = 0; index < MAX_REDEEM_CODE_RECORDS - 1; index += 1) {
      data.redeemCodes[`used-${index}`] = {
        id: `used-${index}`,
        codeHash: `used-hash-${index}`,
        units: 1,
        createdAt: index,
        usedBy: 'user-1',
        usedAt: index + 1,
      };
    }
    data.redeemCodes['existing-unused'] = {
      id: 'existing-unused',
      codeHash: 'unused-hash',
      units: 1,
      createdAt: MAX_REDEEM_CODE_RECORDS,
      usedBy: null,
      usedAt: null,
    };

    const generated = points.generateRedeemCode(1);

    expect(Object.keys(data.redeemCodes)).toHaveLength(MAX_REDEEM_CODE_RECORDS);
    expect(data.redeemCodes['used-0']).toBeUndefined();
    expect(data.redeemCodes['existing-unused']).toBeDefined();
    expect(data.redeemCodes[generated.id]).toBeDefined();
  });

  it('lists only the most recent bounded redeem-code history with a fixed display mask', () => {
    const { data, points } = createHarness();
    for (let index = 0; index < MAX_LISTED_REDEEM_CODES + 50; index += 1) {
      data.redeemCodes[`code-${index}`] = {
        id: `code-${index}`,
        codeHash: `hash-${index}`,
        maskedCode: `Leaked-${index}`,
        units: 1,
        createdAt: index,
        usedBy: index % 2 ? 'user-1' : null,
        usedAt: index % 2 ? index : null,
      };
    }

    const listed = points.listMaskedCodes();

    expect(listed).toHaveLength(MAX_LISTED_REDEEM_CODES);
    expect(listed[0]).toMatchObject({ id: `code-${MAX_LISTED_REDEEM_CODES + 49}`, maskedCode: '********' });
    expect(listed.at(-1)).toMatchObject({ id: 'code-50', maskedCode: '********' });
    expect(JSON.stringify(listed)).not.toContain('Leaked-');
  });

  it('redeems codes once with case-sensitive matching', () => {
    const { data, points } = createHarness({ codeFactory: () => 'Aa1Bb2Cc' });
    points.generateRedeemCode(25);

    expect(() => points.redeemCode('user-1', 'aa1bb2cc')).toThrowError(
      expect.objectContaining({ code: 'INVALID_REDEEM_CODE' }),
    );
    expect(points.redeemCode('user-1', 'Aa1Bb2Cc')).toEqual({
      creditedUnits: 25,
      balanceUnits: 25,
      availableUnits: 25,
    });
    expect(Object.values(data.redeemCodes)[0]).toMatchObject({
      usedBy: 'user-1',
      usedAt: 1_000,
    });
    expect(() => points.redeemCode('user-1', 'Aa1Bb2Cc')).toThrowError(
      expect.objectContaining({ code: 'REDEEM_CODE_ALREADY_USED' }),
    );
    expect(points.getBalance('user-1').balanceUnits).toBe(25);
  });

  it('keeps an overflowing redemption unused and leaves the ledger unchanged', () => {
    const harness = createHarness({
      balanceUnits: Number.MAX_SAFE_INTEGER,
      codeFactory: () => 'Aa1Bb2Cc',
    });
    harness.points.generateRedeemCode(1);
    const before = JSON.parse(JSON.stringify(harness.data));
    const saveCount = harness.saveData.mock.calls.length;

    expect(() => harness.points.redeemCode('user-1', 'Aa1Bb2Cc')).toThrowError(
      expect.objectContaining({ code: 'POINT_BALANCE_LIMIT_EXCEEDED' }),
    );
    expect(harness.data).toEqual(before);
    expect(harness.saveData).toHaveBeenCalledTimes(saveCount);
    expect(() => createPointsService({
      data: harness.data,
      saveData: vi.fn(),
      redeemCodeHmacSecret: TEST_REDEEM_SECRET,
    })).not.toThrow();
  });

  it('generates secure eight-character mixed alphanumeric codes by default', () => {
    const { points } = createHarness();
    const { code } = points.generateRedeemCode(1);

    expect(code).toMatch(/^[A-Za-z0-9]{8}$/u);
    expect(code).toMatch(/[A-Z]/u);
    expect(code).toMatch(/[a-z]/u);
    expect(code).toMatch(/[0-9]/u);
  });

  it.each([
    ['uppercase', 'abcdefgh'],
    ['lowercase', 'ABCDEFGH'],
    ['digit', 'AbCdEfGh'],
  ])('rejects an injected code without a required %s character', (_missingGroup, code) => {
    const { data, points } = createHarness({ codeFactory: () => code });

    expect(() => points.generateRedeemCode(1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_REDEEM_CODE' }),
    );
    expect(data.redeemCodes).toEqual({});
  });

  it('rolls back a credit when persistence fails', () => {
    const harness = createHarness({ balanceUnits: 5 });

    expectPersistenceRollback(harness, () => {
      harness.points.credit('user-1', 3, 'failed credit');
    });
  });

  it('does not roll back unrelated persisted state when a points save fails', () => {
    const harness = createHarness({ balanceUnits: 5 });
    const aiSessions = { existing: [{ id: 'session-before' }] };
    harness.data.aiSessions = aiSessions;
    const persistenceError = new Error('disk full');
    harness.saveData.mockImplementation(() => {
      aiSessions.concurrent = [{ id: 'session-during-save' }];
      throw persistenceError;
    });

    expect(() => harness.points.credit('user-1', 3, 'failed credit')).toThrow(persistenceError);

    expect(harness.data.authUsers['user-1'].balanceUnits).toBe(5);
    expect(harness.data.pointTransactions).toEqual([]);
    expect(harness.data.aiSessions).toBe(aiSessions);
    expect(harness.data.aiSessions.concurrent).toEqual([{ id: 'session-during-save' }]);
  });

  it('rolls back a reservation when persistence fails', () => {
    const harness = createHarness({ balanceUnits: 5 });

    expectPersistenceRollback(harness, () => {
      harness.points.reserve({
        taskId: 'image-failed',
        userId: 'user-1',
        costUnits: 2,
        taskType: 'image',
      });
    });
  });

  it.each([true, false])('rolls back settlement success=%s when persistence fails', success => {
    const harness = createHarness({ balanceUnits: 5 });
    harness.points.reserve({
      taskId: 'settlement-failed',
      userId: 'user-1',
      costUnits: 2,
      taskType: 'image',
    });

    expectPersistenceRollback(harness, () => {
      harness.points.settle('settlement-failed', success);
    });
  });

  it('rolls back orphan reconciliation when persistence fails', () => {
    const harness = createHarness({ balanceUnits: 10 });
    harness.points.reserve({
      taskId: 'orphan-a',
      userId: 'user-1',
      costUnits: 2,
      taskType: 'image',
    });
    harness.points.reserve({
      taskId: 'orphan-b',
      userId: 'user-1',
      costUnits: 3,
      taskType: 'video',
    });

    expectPersistenceRollback(harness, () => {
      harness.points.reconcileReservations([]);
    });
  });

  it('rolls back code generation when persistence fails', () => {
    const harness = createHarness({ codeFactory: () => 'Aa1Bb2Cc' });

    expectPersistenceRollback(harness, () => {
      harness.points.generateRedeemCode(5);
    });
  });

  it('rolls back redemption when persistence fails so the code remains unused', () => {
    const harness = createHarness({ codeFactory: () => 'Aa1Bb2Cc' });
    harness.points.generateRedeemCode(5);

    expectPersistenceRollback(harness, () => {
      harness.points.redeemCode('user-1', 'Aa1Bb2Cc');
    });
  });
});
