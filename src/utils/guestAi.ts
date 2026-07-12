const GUEST_AI_ID_STORAGE_KEY = 'chatkitty-guest-ai-id';

function generateGuestAiId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `guest_${crypto.randomUUID().replace(/-/g, '')}`;
  }

  return `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getGuestAiId() {
  if (typeof window === 'undefined') {
    return 'guest_server';
  }

  const existingId = window.localStorage.getItem(GUEST_AI_ID_STORAGE_KEY);
  if (existingId) {
    return existingId;
  }

  const nextId = generateGuestAiId();
  window.localStorage.setItem(GUEST_AI_ID_STORAGE_KEY, nextId);
  return nextId;
}
