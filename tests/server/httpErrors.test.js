import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTerminalErrorHandler } from '../../server/httpErrors.js';

const openServers = [];
const serverSource = readFileSync(
  fileURLToPath(new URL('../../server.js', import.meta.url)),
  'utf8',
);

async function startApp() {
  const app = express();
  const uploadHandler = vi.fn((_req, res) => res.json({ ok: true }));
  const globalHandler = vi.fn((_req, res) => res.json({ ok: true }));
  const logger = vi.fn();

  app.post('/api/upload-test', express.json({ limit: '1kb' }), uploadHandler);
  app.use(express.json({ limit: '2kb' }));
  app.post('/api/global-test', globalHandler);
  app.get('/api/fail', (_req, _res, next) => {
    next(Object.assign(new Error('private failure at C:\\secret\\server.js'), { status: 418 }));
  });
  registerTerminalErrorHandler(app, { logger });

  const server = createServer(app);
  openServers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    globalHandler,
    logger,
    uploadHandler,
    request(path, options = {}) {
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
      return fetch(`http://127.0.0.1:${address.port}${path}`, { ...options, headers });
    },
  };
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(server => new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  })));
  vi.restoreAllMocks();
});

describe('terminal HTTP error handling', () => {
  it.each([
    ['/api/upload-test', 'x'.repeat(2 * 1_024)],
    ['/api/global-test', 'x'.repeat(3 * 1_024)],
  ])('returns fixed JSON 413 for oversized JSON on %s', async (path, payload) => {
    const harness = await startApp();
    const response = await harness.request(path, {
      method: 'POST',
      body: JSON.stringify({ payload }),
    });

    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: '请求内容过大' });
    expect(harness.uploadHandler).not.toHaveBeenCalled();
    expect(harness.globalHandler).not.toHaveBeenCalled();
  });

  it.each([
    '/api/upload-test',
    '/api/global-test',
  ])('returns fixed JSON 400 for malformed JSON on %s', async path => {
    const harness = await startApp();
    const response = await harness.request(path, {
      method: 'POST',
      body: '{"invalidJson":',
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: '请求内容格式错误' });
    expect(harness.uploadHandler).not.toHaveBeenCalled();
    expect(harness.globalHandler).not.toHaveBeenCalled();
  });

  it('returns a safe JSON 500 for unexpected errors without leaking details', async () => {
    const harness = await startApp();
    const response = await harness.request('/api/fail', {
      method: 'GET',
      headers: { Accept: 'text/html' },
    });
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(body)).toEqual({ error: '服务器暂时繁忙，请稍后重试' });
    expect(body).not.toContain('private failure');
    expect(body).not.toContain('C:\\secret');
    expect(body).not.toContain('<pre>');
    expect(harness.logger).toHaveBeenCalledOnce();
  });

  it('registers the terminal handler after routes and the SPA fallback', () => {
    const fallbackIndex = serverSource.indexOf('registerSpaFallback(app');
    const errorHandlerIndex = serverSource.indexOf('registerTerminalErrorHandler(app');
    const serverIndex = serverSource.indexOf('const server = createServer(app)');

    expect(fallbackIndex).toBeGreaterThan(-1);
    expect(errorHandlerIndex).toBeGreaterThan(fallbackIndex);
    expect(serverIndex).toBeGreaterThan(errorHandlerIndex);
  });
});
