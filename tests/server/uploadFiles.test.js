import fs from 'node:fs';
import { createServer, request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServerConfig } from '../../server/config.js';
import * as uploadFiles from '../../server/uploadFiles.js';

const tempDirs = [];
const uploadEnvKeys = [
  'UPLOAD_MAX_TOTAL_BYTES',
  'UPLOAD_MAX_FILE_COUNT',
  'UPLOAD_RATE_LIMIT_WINDOW_MS',
  'UPLOAD_RATE_LIMIT_MAX',
];
const originalUploadEnv = Object.fromEntries(uploadEnvKeys.map(key => [key, process.env[key]]));

beforeEach(() => {
  for (const key of uploadEnvKeys) delete process.env[key];
});

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  for (const key of uploadEnvKeys) delete process.env[key];
});

afterAll(() => {
  for (const key of uploadEnvKeys) {
    const originalValue = originalUploadEnv[key];
    if (originalValue === undefined) delete process.env[key];
    else process.env[key] = originalValue;
  }
});

function createFixture(overrides = {}) {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-files-'));
  tempDirs.push(uploadDir);
  const store = uploadFiles.createUploadFileStore({
    uploadDir,
    maxUploadSize: 20,
    maxTotalBytes: 10,
    maxFileCount: 5_000,
    allowedFileExtensions: new Set(['.txt']),
    ...overrides,
  });
  return { uploadDir, store };
}

function dataUrl(value) {
  return `data:text/plain;base64,${Buffer.from(value).toString('base64')}`;
}

describe('upload aggregate quota', () => {
  it('rejects a file before writing when regular files would exceed the quota', () => {
    const { uploadDir, store } = createFixture();
    fs.writeFileSync(path.join(uploadDir, 'existing.txt'), '12345678');

    expect(() => store.saveUploadedFile({
      fileName: 'new.txt',
      fileData: dataUrl('123'),
      mimeType: 'text/plain',
    })).toThrowError(expect.objectContaining({ code: 'UPLOAD_QUOTA_EXCEEDED' }));

    expect(fs.readdirSync(uploadDir)).toEqual(['existing.txt']);
  });

  it('ignores directories and symbolic links while calculating usage', () => {
    const { uploadDir, store } = createFixture();
    fs.mkdirSync(path.join(uploadDir, 'nested'));
    fs.writeFileSync(path.join(uploadDir, 'nested', 'large.txt'), 'x'.repeat(100));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-outside-'));
    tempDirs.push(outsideDir);
    fs.writeFileSync(path.join(outsideDir, 'large.txt'), 'x'.repeat(100));
    try {
      fs.symlinkSync(outsideDir, path.join(uploadDir, 'linked'), 'junction');

      expect(() => store.saveUploadedFile({
        fileName: 'new.txt',
        fileData: dataUrl('123'),
        mimeType: 'text/plain',
      })).not.toThrow();
    } finally {
      fs.rmSync(path.join(uploadDir, 'linked'), { force: true });
    }
  });

  it('rejects new files when the regular-file count reaches the configured limit', () => {
    const { uploadDir, store } = createFixture({ maxFileCount: 1 });
    fs.writeFileSync(path.join(uploadDir, 'existing.txt'), '1');

    expect(() => store.saveUploadedFile({
      fileName: 'new.txt',
      fileData: dataUrl('2'),
      mimeType: 'text/plain',
    })).toThrowError(expect.objectContaining({ code: 'UPLOAD_QUOTA_EXCEEDED' }));
  });

  it('reuses a directory usage snapshot between refresh intervals', () => {
    const scanUploadUsage = vi.fn(() => ({ totalBytes: 0, fileCount: 0 }));
    const { store } = createFixture({
      maxTotalBytes: 100,
      scanUploadUsage,
      usageCacheTtlMs: 60_000,
    });

    store.saveUploadedFile({ fileName: 'one.txt', fileData: dataUrl('1') });
    store.saveUploadedFile({ fileName: 'two.txt', fileData: dataUrl('2') });

    expect(scanUploadUsage).toHaveBeenCalledTimes(1);
  });
});

describe('upload HTTP protection', () => {
  it('loads upload protection defaults and environment overrides', () => {
    const defaults = createServerConfig('example-root');
    expect(defaults.UPLOAD_MAX_TOTAL_BYTES).toBe(1_073_741_824);
    expect(defaults.UPLOAD_MAX_FILE_COUNT).toBe(5_000);
    expect(defaults.UPLOAD_RATE_LIMIT_WINDOW_MS).toBe(600_000);
    expect(defaults.UPLOAD_RATE_LIMIT_MAX).toBe(30);

    process.env.UPLOAD_MAX_TOTAL_BYTES = '2048';
    process.env.UPLOAD_MAX_FILE_COUNT = '20';
    process.env.UPLOAD_RATE_LIMIT_WINDOW_MS = '3000';
    process.env.UPLOAD_RATE_LIMIT_MAX = '4';
    const configured = createServerConfig('example-root');
    expect(configured.UPLOAD_MAX_TOTAL_BYTES).toBe(2048);
    expect(configured.UPLOAD_MAX_FILE_COUNT).toBe(20);
    expect(configured.UPLOAD_RATE_LIMIT_WINDOW_MS).toBe(3000);
    expect(configured.UPLOAD_RATE_LIMIT_MAX).toBe(4);
  });

  it.each([
    ['UPLOAD_MAX_TOTAL_BYTES', 'NaN'],
    ['UPLOAD_MAX_FILE_COUNT', '0'],
    ['UPLOAD_RATE_LIMIT_WINDOW_MS', '0'],
    ['UPLOAD_RATE_LIMIT_MAX', '-1'],
    ['UPLOAD_RATE_LIMIT_MAX', 'Infinity'],
    ['UPLOAD_RATE_LIMIT_MAX', '1.5'],
    ['UPLOAD_RATE_LIMIT_MAX', '1e3'],
  ])(
    'rejects unsafe upload protection config %s=%s',
    (name, value) => {
      process.env[name] = value;
      expect(() => createServerConfig('example-root')).toThrow(new RegExp(name));
    },
  );

  it('exports a request limiter that returns 429 after the configured count', () => {
    expect(uploadFiles.createUploadRateLimiter).toBeTypeOf('function');
    const limiter = uploadFiles.createUploadRateLimiter({ windowMs: 60_000, maxRequests: 2 });
    const req = { ip: '127.0.0.1' };
    const responses = [];
    const createResponse = () => ({
      status(code) {
        responses.push(code);
        return this;
      },
      json() {
        return this;
      },
    });

    expect(limiter(req, createResponse(), () => true)).toBe(true);
    expect(limiter(req, createResponse(), () => true)).toBe(true);
    expect(limiter(req, createResponse(), () => true)).toBeUndefined();
    expect(responses).toEqual([429]);
  });

  it('maps aggregate quota errors to HTTP 413', () => {
    expect(uploadFiles.createUploadHandler).toBeTypeOf('function');
    const handler = uploadFiles.createUploadHandler(() => {
      const error = new Error('上传空间已满');
      error.code = 'UPLOAD_QUOTA_EXCEEDED';
      throw error;
    });
    const response = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };

    handler({ body: { fileName: 'file.txt', fileData: dataUrl('1') } }, response);

    expect(response.statusCode).toBe(413);
    expect(response.body).toEqual({ error: '上传空间已满' });
  });

  it('preserves validation failures as HTTP 400 responses', () => {
    const handler = uploadFiles.createUploadHandler(() => {
      const error = new Error('暂不支持这种文件格式');
      error.code = 'UPLOAD_VALIDATION_ERROR';
      throw error;
    });
    const response = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };

    handler({ body: { fileName: 'file.txt', fileData: dataUrl('1') } }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: '暂不支持这种文件格式' });
  });

  it('maps unexpected filesystem errors to a generic HTTP 500 response', () => {
    const handler = uploadFiles.createUploadHandler(() => {
      const error = new Error('EACCES: C:\\private\\uploads');
      error.code = 'EACCES';
      throw error;
    });
    const response = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };

    handler({ body: { fileName: 'file.txt', fileData: dataUrl('1') } }, response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: '文件上传失败，请稍后重试' });
  });

  it('registers rate limiting before JSON parsing on the real Express route', async () => {
    expect(uploadFiles.registerUploadEndpoint).toBeTypeOf('function');
    const app = express();
    uploadFiles.registerUploadEndpoint(app, {
      rateLimiter: uploadFiles.createUploadRateLimiter({ windowMs: 60_000, maxRequests: 1 }),
      jsonParser: express.json({ limit: '50mb' }),
      handler: (_req, res) => res.json({ ok: true }),
    });
    const server = createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const send = body => new Promise((resolve, reject) => {
      const req = request({
        host: '127.0.0.1',
        port: server.address().port,
        path: '/api/upload-file',
        method: 'POST',
        headers: { 'content-type': 'application/json', connection: 'close' },
      }, res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end(body);
    });

    try {
      expect(await send('{}')).toBe(200);
      expect(await send('{')).toBe(429);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    }
  });

  it.each([
    ['an empty request body', '', {}],
    ['JSON null', 'null', { 'content-type': 'application/json' }],
  ])('returns HTTP 400 for %s on the real Express route', async (_label, body, headers) => {
    const app = express();
    uploadFiles.registerUploadEndpoint(app, {
      rateLimiter: (_req, _res, next) => next(),
      jsonParser: express.json({ limit: '50mb' }),
      handler: uploadFiles.createUploadHandler(() => ({ ok: true })),
    });
    const server = createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const statusCode = await new Promise((resolve, reject) => {
        const req = request({
          host: '127.0.0.1',
          port: server.address().port,
          path: '/api/upload-file',
          method: 'POST',
          headers: { connection: 'close', ...headers },
        }, res => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
        req.end(body);
      });
      expect(statusCode).toBe(400);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    }
  });
});
