import { reportSessionExpiredResponse } from './http';

export interface AuthUser {
  id: string;
  phone: string;
  realName: string;
  role: 'user' | 'admin';
  mediaPermissions: {
    imageGeneration: boolean;
    videoGeneration: boolean;
  };
}

export interface LoginInput {
  phone: string;
  password: string;
}

export interface RegisterInput extends LoginInput {
  realName: string;
}

export interface AdminResetPasswordInput {
  phone: string;
  realName: string;
  newPassword: string;
}

export interface AdminResetPasswordResult {
  ok: true;
  user: {
    id: string;
    phone: string;
    realName: string;
    role: 'user' | 'admin';
  };
}

export type AdminUser = AuthUser;

const JSON_ACCEPT_HEADER = { Accept: 'application/json' } as const;
const JSON_REQUEST_HEADERS = {
  ...JSON_ACCEPT_HEADER,
  'Content-Type': 'application/json',
} as const;

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  reportUnauthorized = !['/api/auth/login', '/api/auth/register', '/api/auth/me'].includes(path),
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: JSON_ACCEPT_HEADER,
      ...init,
    });
  } catch {
    throw new Error('网络连接失败，请检查网络后重试');
  }

  if (reportUnauthorized) {
    reportSessionExpiredResponse(response);
  }

  let result: unknown = {};
  try {
    result = await response.json();
  } catch {
    // The status-based fallback below handles empty and non-JSON error bodies.
  }

  if (!response.ok) {
    const error = typeof result === 'object' && result !== null && 'error' in result
      ? (result as { error?: unknown }).error
      : null;
    throw new Error(
      typeof error === 'string' && error.trim()
        ? error
        : '请求失败，请稍后重试',
    );
  }

  return result as T;
}

function postJson<T>(path: string, body?: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    headers: JSON_REQUEST_HEADERS,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export async function fetchCurrentUser(
  options: { reportUnauthorized?: boolean } = {},
): Promise<AuthUser | null> {
  const result = await requestJson<{ user: AuthUser | null }>(
    '/api/auth/me',
    undefined,
    options.reportUnauthorized === true,
  );
  return result.user;
}

export async function login(input: LoginInput): Promise<AuthUser> {
  const result = await postJson<{ user: AuthUser }>('/api/auth/login', input);
  return result.user;
}

export async function register(input: RegisterInput): Promise<AuthUser> {
  const result = await postJson<{ user: AuthUser }>('/api/auth/register', input);
  return result.user;
}

export async function logout(): Promise<void> {
  await postJson('/api/auth/logout');
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const result = await requestJson<{ users: AdminUser[] }>('/api/admin/users');
  return result.users;
}

export async function updateMediaPermissions(
  userId: string,
  mediaPermissions: AuthUser['mediaPermissions'],
): Promise<AdminUser> {
  const result = await postJson<{ user: AdminUser }>(
    `/api/admin/users/${encodeURIComponent(userId)}/media-permissions`,
    mediaPermissions,
  );
  return result.user;
}

export function adminResetPassword(
  phone: string,
  realName: string,
  newPassword: string,
): Promise<AdminResetPasswordResult> {
  return postJson<AdminResetPasswordResult>('/api/admin/users/reset-password', {
    phone,
    realName,
    newPassword,
  });
}

export type AuthStatus = 'loading' | 'authenticated' | 'guest' | 'error';
