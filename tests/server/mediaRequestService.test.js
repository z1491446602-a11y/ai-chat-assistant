import { describe, expect, it, vi } from 'vitest';
import {
  MEDIA_REQUEST_RETENTION_MS,
  MEDIA_REQUEST_CLAIM_LEASE_MS,
  MAX_MEDIA_REQUEST_RECORDS,
  createMediaRequestService,
} from '../../server/mediaRequestService.js';

function createHarness({
  mediaRequests = {},
  now = () => 1_000,
  saveData = vi.fn(),
} = {}) {
  const data = { mediaRequests };
  const service = createMediaRequestService({ data, saveData, now });
  return { data, saveData, service };
}

function imageClaim(overrides = {}) {
  return {
    userId: 'user-1',
    mediaType: 'image',
    requestId: 'request-1',
    payloadFingerprint: 'sha256:image-payload',
    ...overrides,
  };
}

function persistedClaim({
  userId = 'user-1',
  mediaType = 'image',
  requestId = 'request-1',
  taskId = '',
  sessionId = '',
  messageId = '',
  status = 'claimed',
  createdAt = 1_000,
  updatedAt = createdAt,
  ...overrides
} = {}) {
  const key = JSON.stringify([userId, mediaType, requestId]);
  return {
    key,
    userId,
    mediaType,
    requestId,
    payloadFingerprint: `sha256:${requestId}`,
    taskId,
    sessionId,
    messageId,
    status,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

function persistedAccepted(overrides = {}) {
  const record = persistedClaim({
    status: 'accepted',
    taskId: 'task-1',
    sessionId: 'session-1',
    messageId: 'message-1',
    acceptedAt: 1_000,
    ...overrides,
  });
  return record;
}

function acceptClaim(harness, overrides = {}) {
  const claim = harness.service.claim(imageClaim(overrides.claim));
  const record = harness.service.accept(claim.record.key, {
    taskId: 'task-1',
    sessionId: 'session-1',
    messageId: 'message-1',
    ...overrides.link,
  });
  return { claim, record };
}

describe('media request service', () => {
  it('claims a normalized authenticated media request without storing its payload', () => {
    const harness = createHarness();

    const result = harness.service.claim(imageClaim({
      userId: ' user-1 ',
      mediaType: ' IMAGE ',
      requestId: ' request-1 ',
      prompt: 'must not be persisted',
      images: ['data:image/png;base64,private'],
    }));

    expect(result.created).toBe(true);
    expect(result.record).toMatchObject({
      userId: 'user-1',
      mediaType: 'image',
      requestId: 'request-1',
      payloadFingerprint: 'sha256:image-payload',
      taskId: '',
      sessionId: '',
      messageId: '',
      status: 'claimed',
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(JSON.stringify(harness.data.mediaRequests)).not.toContain('must not be persisted');
    expect(JSON.stringify(harness.data.mediaRequests)).not.toContain('data:image');
    expect(harness.saveData).toHaveBeenCalledOnce();
  });

  it('returns the existing record for an equivalent repeated claim without saving again', () => {
    const harness = createHarness();
    const first = harness.service.claim(imageClaim());
    const savesAfterFirstClaim = harness.saveData.mock.calls.length;

    const repeated = harness.service.claim(imageClaim());

    expect(repeated).toEqual({ record: first.record, created: false });
    expect(repeated.record).toBe(first.record);
    expect(harness.saveData).toHaveBeenCalledTimes(savesAfterFirstClaim);
  });

  it('reclaims an abandoned claim after its short lease expires', () => {
    let currentTime = 1_000;
    const harness = createHarness({ now: () => currentTime });
    const first = harness.service.claim(imageClaim()).record;

    currentTime = first.updatedAt + MEDIA_REQUEST_CLAIM_LEASE_MS - 1;
    expect(harness.service.claim(imageClaim())).toEqual({ record: first, created: false });

    currentTime += 1;
    const reclaimed = harness.service.claim(imageClaim());
    expect(reclaimed.created).toBe(true);
    expect(reclaimed.record).not.toBe(first);
    expect(reclaimed.record).toMatchObject({ status: 'claimed', createdAt: currentTime });
  });

  it('reclaims an expired claim before checking a replacement payload fingerprint', () => {
    let currentTime = 1_000;
    const harness = createHarness({ now: () => currentTime });
    const original = harness.service.claim(imageClaim()).record;
    currentTime = original.updatedAt + MEDIA_REQUEST_CLAIM_LEASE_MS;

    const replacement = harness.service.claim(imageClaim({
      payloadFingerprint: 'sha256:replacement-payload',
    }));

    expect(replacement.created).toBe(true);
    expect(replacement.record.payloadFingerprint).toBe('sha256:replacement-payload');
  });

  it('rejects reuse of the same request key with a different payload fingerprint', () => {
    const harness = createHarness();
    harness.service.claim(imageClaim());
    const savesAfterFirstClaim = harness.saveData.mock.calls.length;

    expect(() => harness.service.claim(imageClaim({
      payloadFingerprint: 'sha256:different-payload',
    }))).toThrowError(expect.objectContaining({
      code: 'MEDIA_REQUEST_FINGERPRINT_CONFLICT',
      status: 409,
      statusCode: 409,
    }));
    expect(harness.saveData).toHaveBeenCalledTimes(savesAfterFirstClaim);
  });

  it('keeps image and video request keys separate for the same user and request id', () => {
    const harness = createHarness();

    const image = harness.service.claim(imageClaim());
    const video = harness.service.claim(imageClaim({ mediaType: 'video' }));

    expect(image.record.key).not.toBe(video.record.key);
    expect(Object.keys(harness.data.mediaRequests)).toHaveLength(2);
  });

  it.each([
    imageClaim({ userId: '' }),
    imageClaim({ mediaType: 'audio' }),
    imageClaim({ requestId: '' }),
    imageClaim({ requestId: 'x'.repeat(129) }),
    imageClaim({ payloadFingerprint: '' }),
  ])('rejects invalid claim identity %#', input => {
    const harness = createHarness();

    expect(() => harness.service.claim(input)).toThrowError(
      expect.objectContaining({ code: 'INVALID_MEDIA_REQUEST', status: 400 }),
    );
    expect(harness.saveData).not.toHaveBeenCalled();
  });

  it('links a claimed request to one accepted task and replays it thereafter', () => {
    const harness = createHarness();
    const { claim, record } = acceptClaim(harness);
    const savesAfterAccept = harness.saveData.mock.calls.length;

    expect(record).toMatchObject({
      key: claim.record.key,
      taskId: 'task-1',
      sessionId: 'session-1',
      messageId: 'message-1',
      status: 'accepted',
      acceptedAt: 1_000,
    });
    expect(harness.service.claim(imageClaim())).toEqual({ record, created: false });
    expect(harness.service.find(imageClaim())).toBe(record);
    expect(harness.service.find(record.key)).toBe(record);
    expect(harness.saveData).toHaveBeenCalledTimes(savesAfterAccept);
  });

  it('aborts an unaccepted claim and lets the same fingerprint acquire a fresh claim', () => {
    let currentTime = 1_000;
    const harness = createHarness({ now: () => currentTime });
    const first = harness.service.claim(imageClaim());
    const aborted = harness.service.abort(first.record.key);

    expect(aborted).toMatchObject({
      status: 'aborted',
      taskId: '',
      sessionId: '',
      messageId: '',
      abortedAt: 1_000,
    });

    currentTime = 2_000;
    const retried = harness.service.claim(imageClaim());
    expect(retried.created).toBe(true);
    expect(retried.record).not.toBe(aborted);
    expect(retried.record).toMatchObject({
      status: 'claimed',
      taskId: '',
      createdAt: 2_000,
    });
  });

  it('does not abort a request after its task has been accepted', () => {
    const harness = createHarness();
    const { record } = acceptClaim(harness);

    expect(() => harness.service.abort(record.key)).toThrowError(
      expect.objectContaining({ code: 'MEDIA_REQUEST_STATE_CONFLICT', status: 409 }),
    );
    expect(harness.service.find(record.key)).toBe(record);
  });

  it('lets startup recovery abort an accepted orphan and reuse its request id', () => {
    let currentTime = 1_000;
    const harness = createHarness({ now: () => currentTime });
    const { record } = acceptClaim(harness);

    currentTime = 2_000;
    const recovered = harness.service.recoverAccepted(record.key, 'aborted');
    expect(recovered).toMatchObject({
      status: 'aborted',
      taskId: '',
      sessionId: '',
      messageId: '',
      abortedAt: 2_000,
    });

    currentTime = 3_000;
    expect(harness.service.claim(imageClaim()).created).toBe(true);
  });

  it.each(['completed', 'failed', 'cancelled'])('records and replays terminal status %s', status => {
    const harness = createHarness();
    const { record: accepted } = acceptClaim(harness);

    const terminal = harness.service.terminal(accepted.key, status);
    const savesAfterTerminal = harness.saveData.mock.calls.length;

    expect(terminal).toMatchObject({
      taskId: 'task-1',
      sessionId: 'session-1',
      messageId: 'message-1',
      status,
      terminalAt: 1_000,
    });
    expect(harness.service.claim(imageClaim())).toEqual({ record: terminal, created: false });
    expect(harness.service.terminal(accepted.key, status)).toBe(terminal);
    expect(harness.saveData).toHaveBeenCalledTimes(savesAfterTerminal);
  });

  it('retains terminal requests for 24 hours and prunes them only when the window expires', () => {
    let currentTime = 1_000;
    const harness = createHarness({ now: () => currentTime });
    const { record: accepted } = acceptClaim(harness);
    const terminal = harness.service.terminal(accepted.key, 'completed');

    currentTime = terminal.terminalAt + MEDIA_REQUEST_RETENTION_MS - 1;
    expect(harness.service.prune()).toEqual([]);
    expect(harness.service.find(terminal.key)).toBe(terminal);

    currentTime += 1;
    expect(harness.service.prune()).toEqual([terminal.key]);
    expect(harness.service.find(terminal.key)).toBeNull();
  });

  it('reclaims an expired terminal before checking a replacement payload fingerprint', () => {
    let currentTime = 1_000;
    const harness = createHarness({ now: () => currentTime });
    const { record: accepted } = acceptClaim(harness);
    const terminal = harness.service.terminal(accepted.key, 'completed');
    currentTime = terminal.terminalAt + MEDIA_REQUEST_RETENTION_MS;

    const replacement = harness.service.claim(imageClaim({
      payloadFingerprint: 'sha256:replacement-payload',
    }));

    expect(replacement.created).toBe(true);
    expect(replacement.record.payloadFingerprint).toBe('sha256:replacement-payload');
  });

  it('prunes expired claims while retaining accepted requests for explicit recovery', () => {
    let currentTime = 1_000;
    const harness = createHarness({ now: () => currentTime });
    const claimed = harness.service.claim(imageClaim({ requestId: 'claimed' })).record;
    const acceptedClaim = harness.service.claim(imageClaim({ requestId: 'accepted' }));
    const accepted = harness.service.accept(acceptedClaim.record.key, {
      taskId: 'active-task',
      sessionId: 'active-session',
      messageId: 'active-message',
    });

    currentTime += MEDIA_REQUEST_RETENTION_MS * 100;

    expect(harness.service.prune()).toEqual([claimed.key]);
    expect(harness.service.find(claimed.key)).toBeNull();
    expect(harness.service.find(accepted.key)).toBe(accepted);
  });

  it('classifies accepted records without an active task as startup recovery orphans', () => {
    const claimed = persistedClaim({ requestId: 'claimed' });
    const active = persistedAccepted({ requestId: 'active', taskId: 'task-active' });
    const orphan = persistedAccepted({ requestId: 'orphan', taskId: 'task-orphan' });
    const terminal = persistedAccepted({
      requestId: 'terminal',
      taskId: 'task-terminal',
      status: 'completed',
      terminalAt: 1_000,
    });
    const harness = createHarness({ mediaRequests: {
      [claimed.key]: claimed,
      [active.key]: active,
      [orphan.key]: orphan,
      [terminal.key]: terminal,
    } });

    expect(harness.service.getRecoveryPlan(['task-active'])).toEqual({
      claimed: [claimed],
      activeAccepted: [active],
      orphanAccepted: [orphan],
      terminalLinked: [terminal],
    });
  });

  it.each([
    ['mismatched storage key', () => {
      const record = persistedClaim();
      return { wrong: record };
    }],
    ['mismatched embedded key', () => {
      const record = persistedClaim();
      return { [record.key]: { ...record, key: 'wrong' } };
    }],
    ['unknown status', () => {
      const record = persistedClaim({ status: 'running' });
      return { [record.key]: record };
    }],
    ['invalid timestamp order', () => {
      const record = persistedClaim({ createdAt: 2_000, updatedAt: 1_000 });
      return { [record.key]: record };
    }],
    ['accepted record without links', () => {
      const record = persistedClaim({ status: 'accepted', acceptedAt: 1_000 });
      return { [record.key]: record };
    }],
    ['duplicate task link', () => {
      const first = persistedAccepted({ requestId: 'first', taskId: 'duplicate-task' });
      const second = persistedAccepted({ requestId: 'second', taskId: 'duplicate-task' });
      return { [first.key]: first, [second.key]: second };
    }],
  ])('fails closed on invalid persisted media requests: %s', (_label, buildRecords) => {
    expect(() => createHarness({ mediaRequests: buildRecords() })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PERSISTED_MEDIA_REQUESTS' }),
    );
  });

  it.each([
    ['an array', []],
    ['a scalar', 'corrupted'],
  ])('fails closed when the persisted media request registry is %s', (_label, mediaRequests) => {
    expect(() => createHarness({ mediaRequests })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PERSISTED_MEDIA_REQUESTS' }),
    );
  });

  it('rejects a new claim at the hard limit rather than deleting active records', () => {
    const activeRecords = Object.fromEntries(Array.from(
      { length: MAX_MEDIA_REQUEST_RECORDS },
      (_, index) => {
        const record = persistedAccepted({
          requestId: `active-${index}`,
          taskId: `active-task-${index}`,
        });
        return [record.key, record];
      },
    ));
    const harness = createHarness({ mediaRequests: activeRecords });
    const before = { ...activeRecords };

    expect(() => harness.service.claim(imageClaim())).toThrowError(
      expect.objectContaining({ code: 'MEDIA_REQUEST_CAPACITY_REACHED', status: 503 }),
    );
    expect(harness.data.mediaRequests).toEqual(before);
    expect(harness.saveData).not.toHaveBeenCalled();
  });

  it('uses an expired terminal slot for a new claim without exceeding the hard limit', () => {
    const currentTime = MEDIA_REQUEST_RETENTION_MS + 10_000;
    const records = Object.fromEntries(Array.from(
      { length: MAX_MEDIA_REQUEST_RECORDS - 1 },
      (_, index) => {
        const record = persistedAccepted({
          requestId: `active-${index}`,
          taskId: `active-task-${index}`,
        });
        return [record.key, record];
      },
    ));
    const expired = persistedAccepted({
      requestId: 'expired',
      taskId: 'expired-task',
      status: 'failed',
      acceptedAt: 1_000,
      terminalAt: currentTime - MEDIA_REQUEST_RETENTION_MS,
      updatedAt: currentTime - MEDIA_REQUEST_RETENTION_MS,
    });
    records[expired.key] = expired;
    const harness = createHarness({ mediaRequests: records, now: () => currentTime });

    expect(harness.service.claim(imageClaim()).created).toBe(true);
    expect(harness.data.mediaRequests[expired.key]).toBeUndefined();
    expect(Object.keys(harness.data.mediaRequests)).toHaveLength(MAX_MEDIA_REQUEST_RECORDS);
    expect(harness.saveData).toHaveBeenCalledOnce();
  });

  it('rolls back a failed claim save in place', () => {
    const existing = persistedAccepted({ requestId: 'existing', taskId: 'existing-task' });
    const mediaRequests = { [existing.key]: existing };
    const persistenceError = new Error('disk full');
    const harness = createHarness({
      mediaRequests,
      saveData: vi.fn(() => { throw persistenceError; }),
    });
    const collectionReference = harness.data.mediaRequests;
    const before = { ...mediaRequests };

    expect(() => harness.service.claim(imageClaim())).toThrow(persistenceError);
    expect(harness.data.mediaRequests).toBe(collectionReference);
    expect(harness.data.mediaRequests).toEqual(before);
  });

  it.each(['accept', 'abort', 'terminal'])('rolls back a failed %s save in place', operation => {
    const harness = createHarness();
    const claimed = harness.service.claim(imageClaim()).record;
    if (operation === 'terminal') {
      harness.service.accept(claimed.key, {
        taskId: 'task-1',
        sessionId: 'session-1',
        messageId: 'message-1',
      });
    }
    const collectionReference = harness.data.mediaRequests;
    const before = { ...harness.data.mediaRequests };
    const persistenceError = new Error('disk full');
    harness.saveData.mockImplementation(() => { throw persistenceError; });

    const action = operation === 'accept'
      ? () => harness.service.accept(claimed.key, {
          taskId: 'task-1',
          sessionId: 'session-1',
          messageId: 'message-1',
        })
      : operation === 'abort'
        ? () => harness.service.abort(claimed.key)
        : () => harness.service.terminal(claimed.key, 'completed');

    expect(action).toThrow(persistenceError);
    expect(harness.data.mediaRequests).toBe(collectionReference);
    expect(harness.data.mediaRequests).toEqual(before);
  });

  it('rolls back failed pruning without reverting unrelated data changes', () => {
    const currentTime = MEDIA_REQUEST_RETENTION_MS + 2_000;
    const expired = persistedAccepted({
      requestId: 'expired',
      taskId: 'expired-task',
      status: 'completed',
      terminalAt: 1_000,
    });
    const mediaRequests = { [expired.key]: expired };
    const data = { mediaRequests, aiSessions: {} };
    const persistenceError = new Error('disk full');
    const saveData = vi.fn(() => {
      data.aiSessions.concurrent = [{ id: 'session-during-save' }];
      throw persistenceError;
    });
    const service = createMediaRequestService({ data, saveData, now: () => currentTime });
    const collectionReference = data.mediaRequests;

    expect(() => service.prune()).toThrow(persistenceError);
    expect(data.mediaRequests).toBe(collectionReference);
    expect(data.mediaRequests).toEqual(mediaRequests);
    expect(data.aiSessions.concurrent).toEqual([{ id: 'session-during-save' }]);
  });
});
