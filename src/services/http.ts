type SessionExpiredListener = () => void;

const sessionExpiredListeners = new Set<SessionExpiredListener>();

export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function createHttpError(response: Pick<Response, 'status'>, message: string): HttpError {
  return new HttpError(message, response.status);
}

export function isUnauthorizedError(error: unknown): error is Error & { status: 401 } {
  return error instanceof Error
    && 'status' in error
    && error.status === 401;
}

export function subscribeToSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

export function notifySessionExpired(): void {
  sessionExpiredListeners.forEach(listener => listener());
}

export function reportSessionExpiredResponse(response: Response): void {
  if (response.status === 401) {
    notifySessionExpired();
  }
}

export async function readJsonResult(response: Response): Promise<any> {
  reportSessionExpiredResponse(response);
  try {
    return await response.json();
  } catch {
    return {};
  }
}
