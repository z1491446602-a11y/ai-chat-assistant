import type { AiTaskOwner } from '@/services/aiTasksApi';
import { getGuestAiId } from './guestAi';

const AI_OWNER_STORAGE_KEY = 'ai-owner-v1';
const LEGACY_SOCIAL_STORAGE_KEY = 'social-store-v4';
const SERVER_GUEST_ID = 'guest_server';
let browserFallbackGuestId: string | null = null;

function normalizeOwner(value: unknown): AiTaskOwner | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const hasUserId = Object.prototype.hasOwnProperty.call(candidate, 'userId');
  const hasGuestId = Object.prototype.hasOwnProperty.call(candidate, 'guestId');

  if (hasUserId === hasGuestId) {
    return null;
  }

  if (hasUserId && typeof candidate.userId === 'string') {
    const userId = candidate.userId.trim();
    return userId ? { userId } : null;
  }

  if (hasGuestId && typeof candidate.guestId === 'string') {
    const guestId = candidate.guestId.trim();
    return guestId ? { guestId } : null;
  }

  return null;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseJson(value: string | null): unknown {
  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function persistOwner(owner: AiTaskOwner) {
  try {
    window.localStorage.setItem(AI_OWNER_STORAGE_KEY, JSON.stringify(owner));
  } catch {
    // Storage may be unavailable in privacy modes; the in-memory caller can still proceed.
  }
}

function readLegacyUserId(): string | null {
  const legacyState = parseJson(readStorage(LEGACY_SOCIAL_STORAGE_KEY));
  if (!legacyState || typeof legacyState !== 'object') {
    return null;
  }

  const state = (legacyState as Record<string, unknown>).state;
  if (!state || typeof state !== 'object') {
    return null;
  }

  const currentUser = (state as Record<string, unknown>).currentUser;
  if (!currentUser || typeof currentUser !== 'object') {
    return null;
  }

  const id = (currentUser as Record<string, unknown>).id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function getBrowserFallbackGuestId() {
  if (browserFallbackGuestId) {
    return browserFallbackGuestId;
  }

  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      browserFallbackGuestId = `guest_${crypto.randomUUID().replace(/-/g, '')}`;
      return browserFallbackGuestId;
    }
  } catch {
    // Fall through to the page-scoped random fallback.
  }

  browserFallbackGuestId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return browserFallbackGuestId;
}

function getSafeGuestId(isBrowser: boolean) {
  try {
    const guestId = getGuestAiId().trim();
    if (guestId && (!isBrowser || guestId !== SERVER_GUEST_ID)) {
      return guestId;
    }
  } catch {
    // Use an isolated in-memory identity when browser storage is unavailable.
  }

  return isBrowser ? getBrowserFallbackGuestId() : SERVER_GUEST_ID;
}

export function getAiOwner(): AiTaskOwner {
  if (typeof window === 'undefined') {
    return { guestId: getSafeGuestId(false) };
  }

  const persistedOwner = normalizeOwner(parseJson(readStorage(AI_OWNER_STORAGE_KEY)));
  if (persistedOwner) {
    return persistedOwner;
  }

  const legacyUserId = readLegacyUserId();
  if (legacyUserId) {
    const owner: AiTaskOwner = { userId: legacyUserId };
    persistOwner(owner);
    return owner;
  }

  const owner: AiTaskOwner = { guestId: getSafeGuestId(true) };
  persistOwner(owner);
  return owner;
}
