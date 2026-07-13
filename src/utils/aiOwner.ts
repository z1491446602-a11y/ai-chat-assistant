import type { AiTaskOwner } from '@/services/aiTasksApi';
import { getGuestAiId } from './guestAi';

const AI_OWNER_STORAGE_KEY = 'ai-owner-v1';
const SERVER_GUEST_ID = 'guest_server';
const LEGACY_GUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/u;
let browserFallbackGuestId: string | null = null;

function normalizeOwner(value: unknown): AiTaskOwner | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const hasUserId = Object.prototype.hasOwnProperty.call(candidate, 'userId');
  const hasGuestId = Object.prototype.hasOwnProperty.call(candidate, 'guestId');

  if (hasUserId || !hasGuestId) {
    return null;
  }

  if (hasGuestId && typeof candidate.guestId === 'string') {
    const guestId = candidate.guestId.trim();
    return guestId ? { guestId } : null;
  }

  return null;
}

function normalizeLegacyUserOwner(value: unknown): AiTaskOwner | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.length !== 1 || keys[0] !== 'userId' || typeof candidate.userId !== 'string') {
    return null;
  }

  const guestId = candidate.userId.trim();
  return LEGACY_GUEST_ID_PATTERN.test(guestId) ? { guestId } : null;
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

  const persistedValue = parseJson(readStorage(AI_OWNER_STORAGE_KEY));
  const persistedOwner = normalizeOwner(persistedValue);
  if (persistedOwner) {
    return persistedOwner;
  }

  const migratedOwner = normalizeLegacyUserOwner(persistedValue);
  if (migratedOwner) {
    persistOwner(migratedOwner);
    return migratedOwner;
  }

  const owner: AiTaskOwner = { guestId: getSafeGuestId(true) };
  persistOwner(owner);
  return owner;
}
