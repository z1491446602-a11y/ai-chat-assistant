// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAiOwner } from './aiOwner';

const mocks = vi.hoisted(() => ({
  getGuestAiId: vi.fn(() => 'guest-stable'),
}));

vi.mock('./guestAi', () => ({ getGuestAiId: mocks.getGuestAiId }));

const AI_OWNER_KEY = 'ai-owner-v1';
const LEGACY_SOCIAL_KEY = 'social-store-v4';

describe('getAiOwner', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.getGuestAiId.mockReset();
    mocks.getGuestAiId.mockReturnValue('guest-stable');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns a normalized persisted user owner before considering legacy state', () => {
    window.localStorage.setItem(AI_OWNER_KEY, JSON.stringify({ userId: '  user-42  ' }));
    window.localStorage.setItem(
      LEGACY_SOCIAL_KEY,
      JSON.stringify({ state: { currentUser: { id: 'legacy-user' } } }),
    );

    expect(getAiOwner()).toEqual({ userId: 'user-42' });
    expect(mocks.getGuestAiId).not.toHaveBeenCalled();
  });

  it('returns a normalized persisted guest owner', () => {
    window.localStorage.setItem(AI_OWNER_KEY, JSON.stringify({ guestId: '  guest-42  ' }));

    expect(getAiOwner()).toEqual({ guestId: 'guest-42' });
    expect(mocks.getGuestAiId).not.toHaveBeenCalled();
  });

  it('strips unrelated persisted fields from the returned owner', () => {
    window.localStorage.setItem(
      AI_OWNER_KEY,
      JSON.stringify({ userId: 'user-42', nickname: 'Do not retain', friends: ['friend-1'] }),
    );

    expect(getAiOwner()).toEqual({ userId: 'user-42' });
  });

  it.each([
    ['both owner fields', JSON.stringify({ userId: 'user-1', guestId: 'guest-1' })],
    ['a blank user id', JSON.stringify({ userId: '   ' })],
    ['a blank guest id', JSON.stringify({ guestId: '\t' })],
    ['malformed JSON', '{not-json'],
  ])('rejects %s and falls back to a guest owner', (_description, persistedValue) => {
    window.localStorage.setItem(AI_OWNER_KEY, persistedValue);

    expect(getAiOwner()).toEqual({ guestId: 'guest-stable' });
    expect(window.localStorage.getItem(AI_OWNER_KEY)).toBe(
      JSON.stringify({ guestId: 'guest-stable' }),
    );
  });

  it('migrates a valid legacy user when the dedicated owner is invalid', () => {
    window.localStorage.setItem(
      AI_OWNER_KEY,
      JSON.stringify({ userId: 'invalid-user', guestId: 'invalid-guest' }),
    );
    window.localStorage.setItem(
      LEGACY_SOCIAL_KEY,
      JSON.stringify({ state: { currentUser: { id: 'legacy-user' } } }),
    );

    expect(getAiOwner()).toEqual({ userId: 'legacy-user' });
    expect(window.localStorage.getItem(AI_OWNER_KEY)).toBe(
      JSON.stringify({ userId: 'legacy-user' }),
    );
  });

  it('migrates only the legacy current user id into the dedicated owner key', () => {
    window.localStorage.setItem(
      LEGACY_SOCIAL_KEY,
      JSON.stringify({
        state: {
          currentUser: {
            id: '  deployed-user  ',
            nickname: 'Must not migrate',
            avatar: '/private/avatar.png',
          },
          friends: [{ id: 'friend-1' }],
        },
      }),
    );

    expect(getAiOwner()).toEqual({ userId: 'deployed-user' });
    expect(window.localStorage.getItem(AI_OWNER_KEY)).toBe(
      JSON.stringify({ userId: 'deployed-user' }),
    );
    expect(mocks.getGuestAiId).not.toHaveBeenCalled();
  });

  it('persists a stable guest owner when there is no legacy user', () => {
    expect(getAiOwner()).toEqual({ guestId: 'guest-stable' });
    expect(getAiOwner()).toEqual({ guestId: 'guest-stable' });

    expect(mocks.getGuestAiId).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(AI_OWNER_KEY)).toBe(
      JSON.stringify({ guestId: 'guest-stable' }),
    );
  });

  it('does not crash when localStorage reads throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage read denied');
    });

    expect(getAiOwner()).toEqual({ guestId: 'guest-stable' });
  });

  it('does not crash when localStorage writes throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage write denied');
    });

    expect(getAiOwner()).toEqual({ guestId: 'guest-stable' });
  });

  it('uses a stable isolated browser guest when getGuestAiId throws', () => {
    mocks.getGuestAiId.mockImplementation(() => {
      throw new Error('guest storage denied');
    });

    const firstOwner = getAiOwner();
    const secondOwner = getAiOwner();

    expect(firstOwner).toEqual(secondOwner);
    expect(firstOwner).toHaveProperty('guestId');
    expect('guestId' in firstOwner ? firstOwner.guestId : '').toMatch(/^guest_/);
    expect(firstOwner).not.toEqual({ guestId: 'guest_server' });
  });

  it('keeps an isolated browser guest stable when storage and getGuestAiId throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage read denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage write denied');
    });
    mocks.getGuestAiId.mockImplementation(() => {
      throw new Error('guest storage denied');
    });

    const firstOwner = getAiOwner();
    const secondOwner = getAiOwner();

    expect(firstOwner).toEqual(secondOwner);
    expect('guestId' in firstOwner ? firstOwner.guestId : '').toMatch(/^guest_/);
    expect(firstOwner).not.toEqual({ guestId: 'guest_server' });
  });

  it('uses the server guest fallback when window is unavailable', () => {
    mocks.getGuestAiId.mockReturnValue('guest_server');
    vi.stubGlobal('window', undefined);

    expect(getAiOwner()).toEqual({ guestId: 'guest_server' });
  });
});
