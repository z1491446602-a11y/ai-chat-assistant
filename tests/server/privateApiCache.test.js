import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { describe, expect, it } from 'vitest';

describe('private API cache policy', () => {
  it('installs the policy globally before API routes are registered', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../server.js', import.meta.url)),
      'utf8',
    );
    const middlewareIndex = source.indexOf('app.use(privateApiNoStore)');
    const firstApiRegistration = Math.min(
      ...[
        source.indexOf('registerUploadEndpoint(app'),
        source.indexOf('registerAuthRoutes(app'),
        source.indexOf('registerAiRoutes(app'),
      ].filter(index => index >= 0),
    );

    expect(middlewareIndex).toBeGreaterThanOrEqual(0);
    expect(middlewareIndex).toBeLessThan(firstApiRegistration);
  });

  it.each([
    ['/api/auth/me', 'GET'],
    ['/api/points/redeem', 'POST'],
    ['/api/admin/redeem-codes', 'GET'],
    ['/api/ai-sessions/user-1', 'GET'],
    ['/api/ai-task/task-1', 'GET'],
    ['/api/image-generation', 'POST'],
    ['/api/chat', 'POST'],
    ['/api/voice/transcribe', 'POST'],
    ['/api/upload-file', 'POST'],
  ])('marks %s responses as no-store', async (requestPath, method) => {
    const authRoutes = await import('../../server/authRoutes.js');
    const middleware = authRoutes.privateApiNoStore;
    const app = express();
    app.use((req, res, next) => (
      typeof middleware === 'function' ? middleware(req, res, next) : next()
    ));
    app.all('*', (_req, res) => res.json({ ok: true }));
    const server = createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    try {
      const address = server.address();
      const response = await fetch(`http://127.0.0.1:${address.port}${requestPath}`, { method });

      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('pragma')).toBe('no-cache');
      expect(response.headers.get('expires')).toBe('0');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('does not override the intentionally public daily-suggestions cache policy', async () => {
    const { privateApiNoStore } = await import('../../server/authRoutes.js');
    const headers = new Map();
    const res = { setHeader: (name, value) => headers.set(name.toLowerCase(), value) };
    const next = () => {};

    if (typeof privateApiNoStore === 'function') {
      privateApiNoStore({ path: '/api/daily-suggestions' }, res, next);
    }

    expect(headers.has('cache-control')).toBe(false);
  });
});
