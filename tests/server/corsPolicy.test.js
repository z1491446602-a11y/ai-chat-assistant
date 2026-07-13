import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { registerTerminalErrorHandler } from '../../server/httpErrors.js';

async function loadPolicy() {
  return import('../../server/corsPolicy.js');
}

function evaluate(delegate, { origin, host = 'chat.example.com', protocol = 'https' } = {}) {
  const headers = new Map([
    ['origin', origin],
    ['host', host],
  ]);
  const req = {
    protocol,
    get: name => headers.get(String(name).toLowerCase()),
  };
  return new Promise(resolve => {
    delegate(req, (error, options) => resolve({ error, options }));
  });
}

describe('same-origin CORS policy', () => {
  it('allows same-origin browser requests with credentials', async () => {
    const { createSameOriginCorsOptionsDelegate } = await loadPolicy();
    const result = await evaluate(createSameOriginCorsOptionsDelegate(), {
      origin: 'https://chat.example.com',
    });

    expect(result.error).toBeNull();
    expect(result.options).toMatchObject({ origin: true, credentials: true });
  });

  it('allows requests without Origin but emits no cross-origin permission', async () => {
    const { createSameOriginCorsOptionsDelegate } = await loadPolicy();
    const result = await evaluate(createSameOriginCorsOptionsDelegate());

    expect(result.error).toBeNull();
    expect(result.options).toMatchObject({ origin: false });
  });

  it('allows only the explicitly configured loopback Vite origin in development', async () => {
    const { createSameOriginCorsOptionsDelegate } = await loadPolicy();
    const delegate = createSameOriginCorsOptionsDelegate({
      allowedOrigins: ['http://localhost:3001', 'http://127.0.0.1:3001'],
    });

    const viteResult = await evaluate(delegate, {
      origin: 'http://localhost:3001',
      host: 'localhost:3000',
      protocol: 'http',
    });
    const remoteResult = await evaluate(delegate, {
      origin: 'http://192.168.1.20:3001',
      host: 'localhost:3000',
      protocol: 'http',
    });

    expect(viteResult.error).toBeNull();
    expect(viteResult.options).toMatchObject({ origin: true, credentials: true });
    expect(remoteResult.error).toMatchObject({ code: 'CORS_ORIGIN_DENIED' });
  });

  it('rejects a different browser origin before protected routes execute', async () => {
    const { createSameOriginCorsOptionsDelegate } = await loadPolicy();
    const result = await evaluate(createSameOriginCorsOptionsDelegate(), {
      origin: 'https://attacker.example',
    });

    expect(result.error).toMatchObject({ status: 403, statusCode: 403, code: 'CORS_ORIGIN_DENIED' });
    expect(result.options).toBeUndefined();
  });

  it('returns a fixed Chinese 403 response for a denied browser origin', async () => {
    const { applySameOriginCorsPolicy } = await loadPolicy();
    const app = express();
    applySameOriginCorsPolicy(app, cors);
    app.get('/api/private', (_req, res) => res.json({ private: true }));
    registerTerminalErrorHandler(app, { logger: () => {} });
    const server = createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const response = await fetch(`http://127.0.0.1:${address.port}/api/private`, {
        headers: { Origin: 'https://attacker.example' },
      });

      expect(response.status).toBe(403);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({ error: '不允许跨域访问' });
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('removes the Express disclosure header from actual responses', async () => {
    const { applySameOriginCorsPolicy } = await loadPolicy();
    const app = express();
    applySameOriginCorsPolicy(app, cors);
    app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
    const server = createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
      expect(response.headers.has('x-powered-by')).toBe(false);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
