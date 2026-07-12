import fs from 'node:fs';
import { createServer, request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import compression from 'compression';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as staticDelivery from '../../server/staticDelivery.js';
import {
  createCompressionFilter,
  getCompatibilityFallbackCacheControl,
  getDocumentCacheControl,
  getStaticFileCacheControl,
} from '../../server/staticDelivery.js';

describe('hashed asset compatibility', () => {
  it('extracts a prefix when an eight-character Vite hash ends in a dash', () => {
    expect(staticDelivery.getViteHashedAssetPrefix('index-Bpslr01-.css')).toBe('index');
    expect(staticDelivery.getViteHashedAssetPrefix('Friend-Chat-DEMrhC5P.js')).toBe('Friend-Chat');
  });

  it.each([
    'index-Bpslr01.css',
    'index-Bpslr0123.css',
    'index-Bpslr0$2.css',
  ])('rejects %s when the trailing hash is not exactly eight URL-safe characters', fileName => {
    expect(staticDelivery.getViteHashedAssetPrefix(fileName)).toBe('');
  });
});

function createResponse(contentType, contentEncoding = '') {
  const headers = new Map([
    ['content-type', contentType],
    ['content-encoding', contentEncoding],
  ]);

  return {
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
  };
}

const tempDirs = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function createStaticFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-delivery-'));
  tempDirs.push(rootDir);
  const directories = {
    distDir: path.join(rootDir, 'dist'),
    audioDir: path.join(rootDir, 'audio'),
    legacyAudioDir: path.join(rootDir, 'legacy-audio'),
    uploadDir: path.join(rootDir, 'uploads'),
    videoDir: path.join(rootDir, 'videos'),
  };

  for (const directory of Object.values(directories)) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.mkdirSync(path.join(directories.distDir, 'assets'), { recursive: true });

  return directories;
}

async function listen(app) {
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

function requestBuffer(server, requestPath, options = {}) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: address.port,
      path: requestPath,
      method: options.method || 'GET',
      headers: {
        'Accept-Encoding': 'gzip',
        Connection: 'close',
        ...options.headers,
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('static resource routing', () => {
  it('serves configured audio first, falls back to legacy audio, and blocks dist copies', async () => {
    const dirs = createStaticFixture();
    fs.writeFileSync(path.join(dirs.audioDir, 'current.webm'), 'current audio');
    fs.writeFileSync(path.join(dirs.audioDir, 'shared.webm'), 'primary audio');
    fs.writeFileSync(path.join(dirs.legacyAudioDir, 'legacy.webm'), 'legacy audio');
    fs.writeFileSync(path.join(dirs.legacyAudioDir, 'shared.webm'), 'legacy shadow');
    fs.mkdirSync(path.join(dirs.distDir, 'audios'), { recursive: true });
    fs.writeFileSync(path.join(dirs.distDir, 'audios', 'history.webm'), 'dist history');

    const app = express();
    staticDelivery.registerStaticResourceRoutes(app, dirs);
    const server = await listen(app);

    try {
      expect((await requestBuffer(server, '/audios/current.webm')).body.toString()).toBe('current audio');
      expect((await requestBuffer(server, '/audios/shared.webm')).body.toString()).toBe('primary audio');
      expect((await requestBuffer(server, '/audios/legacy.webm')).body.toString()).toBe('legacy audio');
      expect((await requestBuffer(server, '/audios/history.webm')).statusCode).toBe(404);
    } finally {
      await close(server);
    }
  });

  it('preserves upload and video headers while blocking dist runtime copies', async () => {
    const dirs = createStaticFixture();
    fs.writeFileSync(path.join(dirs.uploadDir, 'stored.txt'), 'stored upload');
    fs.writeFileSync(path.join(dirs.videoDir, 'stored.mp4'), 'stored video');
    for (const mediaDir of ['uploads', 'videos']) {
      fs.mkdirSync(path.join(dirs.distDir, mediaDir), { recursive: true });
      fs.writeFileSync(path.join(dirs.distDir, mediaDir, 'history.bin'), 'dist history');
    }

    const app = express();
    staticDelivery.registerStaticResourceRoutes(app, dirs);
    const server = await listen(app);

    try {
      const upload = await requestBuffer(server, '/uploads/stored.txt');
      expect(upload.statusCode).toBe(200);
      expect(upload.headers['content-disposition']).toBe('attachment');
      expect(upload.headers['x-content-type-options']).toBe('nosniff');

      const video = await requestBuffer(server, '/videos/stored.mp4');
      expect(video.statusCode).toBe(200);
      expect(video.headers['content-disposition']).toBe('inline');
      expect(video.headers['x-content-type-options']).toBe('nosniff');

      expect((await requestBuffer(server, '/uploads/history.bin')).statusCode).toBe(404);
      expect((await requestBuffer(server, '/videos/history.bin')).statusCode).toBe(404);
    } finally {
      await close(server);
    }
  });

  it('serves the current hashed asset for an old hash ending in a dash and otherwise returns 404', async () => {
    const dirs = createStaticFixture();
    fs.writeFileSync(path.join(dirs.distDir, 'assets', 'index-ABCDEFGH.js'), 'current asset');

    const app = express();
    staticDelivery.registerStaticResourceRoutes(app, dirs);
    const server = await listen(app);

    try {
      const compatible = await requestBuffer(server, '/assets/index-Bpslr01-.js');
      expect(compatible.statusCode).toBe(200);
      expect(compatible.body.toString()).toBe('current asset');
      expect(compatible.headers['cache-control']).toBe('no-cache, must-revalidate');
      expect((await requestBuffer(server, '/assets/missing.js')).statusCode).toBe(404);
    } finally {
      await close(server);
    }
  });
});

describe('SPA fallback routing', () => {
  it('serves only HTML navigation GET and HEAD requests without extensions', async () => {
    const dirs = createStaticFixture();
    fs.writeFileSync(path.join(dirs.distDir, 'index.html'), '<!doctype html><title>app shell</title>');
    const app = express();
    staticDelivery.registerStaticResourceRoutes(app, dirs);
    app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
    staticDelivery.registerSpaFallback(app, { indexPath: path.join(dirs.distDir, 'index.html') });
    const server = await listen(app);

    try {
      const navigation = await requestBuffer(server, '/chat/session-1', {
        headers: { Accept: 'text/html' },
      });
      expect(navigation.statusCode).toBe(200);
      expect(navigation.body.toString()).toContain('<title>app shell</title>');
      expect(navigation.headers['cache-control']).toBe('no-store, no-cache, must-revalidate');

      const headNavigation = await requestBuffer(server, '/chat/session-1', {
        method: 'HEAD',
        headers: { Accept: 'text/html' },
      });
      expect(headNavigation.statusCode).toBe(200);
      expect(headNavigation.body).toHaveLength(0);

      const clientRoute = await requestBuffer(server, '/client-route', {
        headers: { Accept: 'text/html' },
      });
      expect(clientRoute.statusCode).toBe(200);
      expect(clientRoute.body.toString()).toContain('<title>app shell</title>');

      const encodedPercentNavigation = await requestBuffer(server, '/discount%25', {
        headers: { Accept: 'text/html' },
      });
      expect(encodedPercentNavigation.statusCode).toBe(200);
      expect(encodedPercentNavigation.body.toString()).toContain('<title>app shell</title>');

      const nestedMalformedNavigation = await requestBuffer(server, '/%25E0%25A4%25A', {
        headers: { Accept: 'text/html' },
      });
      expect(nestedMalformedNavigation.statusCode).toBe(200);
      expect(nestedMalformedNavigation.body.toString()).toContain('<title>app shell</title>');

      const api = await requestBuffer(server, '/api/health', {
        headers: { Accept: 'text/html' },
      });
      expect(api.statusCode).toBe(200);
      expect(JSON.parse(api.body.toString())).toEqual({ status: 'ok' });
    } finally {
      await close(server);
    }
  });

  it.each([
    { requestPath: '/api/missing', method: 'GET', accept: 'text/html' },
    { requestPath: '/API/missing', method: 'GET', accept: 'text/html' },
    { requestPath: '/api%2Fmissing', method: 'GET', accept: 'text/html' },
    { requestPath: '/api/../client-route', method: 'GET', accept: 'text/html' },
    { requestPath: '/api%2F..%2Fclient-route', method: 'GET', accept: 'text/html' },
    { requestPath: '/assets', method: 'GET', accept: 'text/html' },
    { requestPath: '/assets%2Fmissing', method: 'GET', accept: 'text/html' },
    { requestPath: '/socket.io', method: 'GET', accept: 'text/html' },
    { requestPath: '/socket.io/', method: 'GET', accept: 'text/html' },
    { requestPath: '/socket%2eio', method: 'GET', accept: 'text/html' },
    { requestPath: '/socket%252eio', method: 'GET', accept: 'text/html' },
    { requestPath: '/SOCKET.IO/missing', method: 'GET', accept: 'text/html' },
    { requestPath: '/socket.io%2Fmissing', method: 'GET', accept: 'text/html' },
    { requestPath: '/socket%252eio%252fmissing', method: 'GET', accept: 'text/html' },
    { requestPath: '/socket.io/../client-route', method: 'GET', accept: 'text/html' },
    { requestPath: '/socket.io%2F..%2Fclient-route', method: 'GET', accept: 'text/html' },
    { requestPath: '/socket%252eio%252f..%252fclient-route', method: 'GET', accept: 'text/html' },
    { requestPath: '/socket%252eio%252f%252e%252e%252fclient-route', method: 'GET', accept: 'text/html' },
    { requestPath: '/audios', method: 'GET', accept: 'text/html' },
    { requestPath: '/audios%2Fmissing', method: 'GET', accept: 'text/html' },
    { requestPath: '/uploads', method: 'GET', accept: 'text/html' },
    { requestPath: '/videos', method: 'GET', accept: 'text/html' },
    { requestPath: '/audios/missing', method: 'GET', accept: 'text/html' },
    { requestPath: '/uploads/missing', method: 'GET', accept: 'text/html' },
    { requestPath: '/videos/missing', method: 'GET', accept: 'text/html' },
    { requestPath: '/missing.json', method: 'GET', accept: 'text/html' },
    { requestPath: '/client-route', method: 'GET', accept: 'application/json' },
    { requestPath: '/client-route', method: 'POST', accept: 'text/html' },
    { requestPath: '/%E0%A4%A', method: 'GET', accept: 'text/html' },
  ])('returns 404 for $method $requestPath with Accept: $accept', async ({ requestPath, method, accept }) => {
    const dirs = createStaticFixture();
    fs.writeFileSync(path.join(dirs.distDir, 'index.html'), '<!doctype html><title>app shell</title>');
    const app = express();
    staticDelivery.registerStaticResourceRoutes(app, dirs);
    staticDelivery.registerSpaFallback(app, { indexPath: path.join(dirs.distDir, 'index.html') });
    const server = await listen(app);

    try {
      const response = await requestBuffer(server, requestPath, {
        method,
        headers: { Accept: accept },
      });
      expect(response.statusCode).toBe(404);
      expect(response.body.toString()).not.toContain('<title>app shell</title>');
    } finally {
      await close(server);
    }
  });
});

describe('static cache policy', () => {
  it('uses a one-year immutable cache for built Vite assets', () => {
    expect(getStaticFileCacheControl('/srv/app/dist/assets/FriendChat-DEMrhC5P.js'))
      .toBe('public, max-age=31536000, immutable');
    expect(getStaticFileCacheControl('C:\\app\\dist\\assets\\index-Bpslr01-.css'))
      .toBe('public, max-age=31536000, immutable');
  });

  it.each([
    '/srv/app/dist/assets/config.js',
    '/srv/app/dist/assets/not-hashed-file.js',
  ])('does not give unhashed asset %s an immutable cache', filePath => {
    expect(getStaticFileCacheControl(filePath)).toBe('');
  });

  it('keeps root and HTML documents out of browser caches', () => {
    expect(getDocumentCacheControl('/')).toBe('no-store, no-cache, must-revalidate');
    expect(getDocumentCacheControl('/index.html')).toBe('no-store, no-cache, must-revalidate');
    expect(getStaticFileCacheControl('/srv/app/dist/index.html'))
      .toBe('no-store, no-cache, must-revalidate');
  });

  it('keeps compatibility asset fallbacks revalidated', () => {
    expect(getCompatibilityFallbackCacheControl()).toBe('no-cache, must-revalidate');
  });
});

describe('response compression policy', () => {
  it.each([
    'application/json; charset=utf-8',
    'application/javascript',
    'text/javascript; charset=utf-8',
    'text/css',
    'text/plain; charset=utf-8',
    'image/svg+xml',
  ])('allows the default compression filter to compress %s', contentType => {
    const defaultFilter = vi.fn(() => true);
    const filter = createCompressionFilter(defaultFilter);

    expect(filter({ headers: {} }, createResponse(contentType))).toBe(true);
    expect(defaultFilter).toHaveBeenCalledOnce();
  });

  it.each([
    'text/event-stream',
    'text/event-stream; charset=utf-8',
    'image/png',
    'audio/mpeg',
    'video/mp4',
    'application/zip',
    'application/pdf',
    'font/woff2',
  ])('does not compress streaming, media, or already-compressed type %s', contentType => {
    const defaultFilter = vi.fn(() => true);
    const filter = createCompressionFilter(defaultFilter);

    expect(filter({ headers: {} }, createResponse(contentType))).toBe(false);
    expect(defaultFilter).not.toHaveBeenCalled();
  });

  it('does not double-compress an already encoded response', () => {
    const defaultFilter = vi.fn(() => true);
    const filter = createCompressionFilter(defaultFilter);

    expect(filter({ headers: {} }, createResponse('application/json', 'gzip'))).toBe(false);
    expect(defaultFilter).not.toHaveBeenCalled();
  });

  it('leaves range responses uncompressed and otherwise preserves the default filter decision', () => {
    const defaultFilter = vi.fn(() => false);
    const filter = createCompressionFilter(defaultFilter);

    expect(filter({ headers: { range: 'bytes=0-99' } }, createResponse('text/plain'))).toBe(false);
    expect(defaultFilter).not.toHaveBeenCalled();
    expect(filter({ headers: {} }, createResponse('application/octet-stream'))).toBe(false);
    expect(defaultFilter).toHaveBeenCalledOnce();
  });

  it('compresses JSON but does not compress SSE through real Express middleware', async () => {
    const app = express();
    app.use(compression({
      threshold: 0,
      filter: createCompressionFilter(compression.filter),
    }));
    app.get('/json', (_req, res) => res.json({ value: 'x'.repeat(4096) }));
    app.get('/events', (_req, res) => {
      res.type('text/event-stream');
      res.end('data: [DONE]\n\n');
    });

    const server = createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const json = await requestBuffer(server, '/json');
      expect(json.headers['content-encoding']).toBe('gzip');
      expect(JSON.parse(gunzipSync(json.body)).value).toHaveLength(4096);

      const events = await requestBuffer(server, '/events');
      expect(events.headers['content-encoding']).toBeUndefined();
      expect(events.body.toString()).toBe('data: [DONE]\n\n');
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    }
  });
});
