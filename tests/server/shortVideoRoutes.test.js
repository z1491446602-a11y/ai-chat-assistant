import { createServer } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { registerShortVideoRoutes } from '../../server/shortVideoRoutes.js';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  })));
});

async function startFixture({ parserData } = {}) {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  registerShortVideoRoutes(app, {
    parserBaseUrl: 'http://127.0.0.1:5201',
    rateLimitWindowMs: 60_000,
    rateLimitMax: 12,
    fetchImpl: async (url) => {
      if (String(url).startsWith('http://127.0.0.1:5201/')) {
        return new Response(JSON.stringify({
          code: 200,
          data: parserData || {
            type: 'image',
            title: '图文作品',
            images: ['https://media.example.com/original.jpg'],
          },
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://media.example.com/original.jpg') {
        return new Response(Buffer.from('original-image'), {
          headers: { 'content-type': 'image/jpeg', 'content-length': '14' },
        });
      }
      if (url === 'https://media.example.com/original.mp4') {
        return new Response(Buffer.from('original-video'), {
          headers: { 'content-type': 'video/mp4', 'content-length': '14' },
        });
      }
      return new Response('', { status: 404 });
    },
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

describe('short video public tool', () => {
  it('allows anonymous parsing and issues a downloadable original-image URL', async () => {
    const baseUrl = await startFixture();
    const parsed = await fetch(`${baseUrl}/api/short-videos/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'douyin',
        url: 'https://v.douyin.com/avBIcUW1jZ4/',
      }),
    });

    expect(parsed.status).toBe(200);
    const payload = await parsed.json();
    expect(payload.result.images).toEqual(['https://media.example.com/original.jpg']);
    expect(payload.result.imageDownloads).toHaveLength(1);

    const downloaded = await fetch(`${baseUrl}${payload.result.imageDownloads[0]}`);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-type')).toContain('image/jpeg');
    expect(downloaded.headers.get('content-disposition')).toMatch(/^attachment;/u);
    expect(Buffer.from(await downloaded.arrayBuffer()).toString()).toBe('original-image');
  });

  it('rejects unsigned image download URLs', async () => {
    const baseUrl = await startFixture();
    const response = await fetch(`${baseUrl}/api/short-videos/download?url=https%3A%2F%2Fmedia.example.com%2Foriginal.jpg`);

    expect(response.status).toBe(403);
  });

  it('issues a signed video download URL that returns an attachment', async () => {
    const baseUrl = await startFixture({
      parserData: {
        type: 'video',
        title: 'Video post',
        url: 'https://media.example.com/original.mp4',
      },
    });
    const parsed = await fetch(`${baseUrl}/api/short-videos/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'bilibili',
        url: 'https://www.bilibili.com/video/BV1xx411c7mD/',
      }),
    });

    expect(parsed.status).toBe(200);
    const payload = await parsed.json();
    expect(payload.result.videoDownloads).toHaveLength(1);

    const downloaded = await fetch(`${baseUrl}${payload.result.videoDownloads[0]}`);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-type')).toContain('video/mp4');
    expect(downloaded.headers.get('content-disposition')).toMatch(/^attachment;/u);
    expect(Buffer.from(await downloaded.arrayBuffer()).toString()).toBe('original-video');
  });
});
