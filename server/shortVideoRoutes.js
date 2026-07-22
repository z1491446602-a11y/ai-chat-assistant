import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import path from 'node:path';
import { isPublicHttpUrl, normalizeParserResponse, resolveParserRequest } from './shortVideoParser.js';

const DOWNLOAD_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_IMAGE_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const MAX_DOWNLOAD_REDIRECTS = 3;
const IMAGE_EXTENSION_BY_MIME = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/avif': '.avif',
});
const VIDEO_EXTENSION_BY_MIME = Object.freeze({
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
});

function createRateLimiter({ windowMs, maxRequests }) {
  const records = new Map();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const userKey = req.authUser?.id || req.authUser?.phone || 'anonymous';
    const key = `${userKey}:${req.ip || ''}`;
    const record = records.get(key);
    if (!record || now >= record.resetAt) {
      records.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (record.count >= maxRequests) {
      res.status(429).json({ error: 'Requests are too frequent. Please try again shortly.' });
      return;
    }
    record.count += 1;
    next();
  };
}

async function readJson(response) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Parser returned an invalid response');
  }
}

function createDownloadTokenService({ now = Date.now } = {}) {
  const secret = randomBytes(32);

  function sign(kind, url, expiresAt) {
    return createHmac('sha256', secret)
      .update(`${kind}:${expiresAt}:${url}`)
      .digest('base64url');
  }

  function createDownloadUrl(kind, url) {
    const expiresAt = String(now() + DOWNLOAD_TOKEN_TTL_MS);
    const params = new URLSearchParams({
      kind,
      url,
      expires: expiresAt,
      signature: sign(kind, url, expiresAt),
    });
    return `/api/short-videos/download?${params.toString()}`;
  }

  function verify(kind, url, expiresAt, signature) {
    const expires = Number(expiresAt);
    if (!['image', 'video'].includes(kind) || !isPublicHttpUrl(url) || !Number.isSafeInteger(expires) || expires <= now()) return false;
    const expected = sign(kind, url, String(expires));
    const received = Buffer.from(String(signature || ''));
    const expectedBuffer = Buffer.from(expected);
    return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer);
  }

  return { createDownloadUrl, verify };
}

function getImageFileName(url, contentType) {
  const extension = path.extname(new URL(url).pathname).toLowerCase();
  const safeExtension = /^\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp)$/u.test(extension)
    ? extension
    : (IMAGE_EXTENSION_BY_MIME[contentType] || '.jpg');
  return `original-image${safeExtension}`;
}

function isImageResponse(contentType) {
  return Object.prototype.hasOwnProperty.call(IMAGE_EXTENSION_BY_MIME, contentType);
}

function isVideoResponse(contentType, url) {
  if (contentType.startsWith('video/')) return true;
  if (contentType !== 'application/octet-stream') return false;
  return /\.(?:m4v|mov|mp4|webm)$/iu.test(new URL(url).pathname);
}

function getVideoFileName(url, contentType) {
  const extension = path.extname(new URL(url).pathname).toLowerCase();
  const safeExtension = /^\.(?:m4v|mov|mp4|webm)$/u.test(extension)
    ? extension
    : (VIDEO_EXTENSION_BY_MIME[contentType] || '.mp4');
  return `original-video${safeExtension}`;
}

function createByteLimitStream(maxBytes) {
  let bytes = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        callback(new Error('Media download exceeded the size limit'));
        return;
      }
      callback(null, chunk);
    },
  });
}

export function registerShortVideoRoutes(app, {
  fetchImpl,
  parserBaseUrl,
  rateLimitWindowMs,
  rateLimitMax,
} = {}) {
  if (!app || typeof app.post !== 'function') {
    throw new TypeError('registerShortVideoRoutes requires an Express app');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('registerShortVideoRoutes requires fetchImpl');
  }

  const rateLimit = createRateLimiter({
    windowMs: Number(rateLimitWindowMs) || 60_000,
    maxRequests: Number(rateLimitMax) || 12,
  });
  const downloadTokens = createDownloadTokenService();

  app.get('/api/short-videos/download', rateLimit, async (req, res) => {
    const kind = String(req.query?.kind || '').trim();
    const url = String(req.query?.url || '').trim();
    const expires = String(req.query?.expires || '').trim();
    const signature = String(req.query?.signature || '').trim();
    if (!downloadTokens.verify(kind, url, expires, signature)) {
      res.status(403).json({ error: 'This download link is invalid or has expired.' });
      return;
    }

    try {
      let targetUrl = url;
      let response;
      for (let redirectCount = 0; redirectCount <= MAX_DOWNLOAD_REDIRECTS; redirectCount += 1) {
        response = await fetchImpl(targetUrl, {
          headers: { Accept: kind === 'video' ? 'video/*,*/*;q=0.8' : 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
          redirect: 'manual',
          signal: globalThis.AbortSignal?.timeout?.(30_000),
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        const nextUrl = location ? new URL(location, targetUrl).toString() : '';
        if (!isPublicHttpUrl(nextUrl) || redirectCount === MAX_DOWNLOAD_REDIRECTS) {
          res.status(502).json({ error: `The original ${kind} is temporarily unavailable.` });
          return;
        }
        targetUrl = nextUrl;
      }

      if (!response?.ok) {
        res.status(502).json({ error: `The original ${kind} is temporarily unavailable.` });
        return;
      }
      const contentType = String(response.headers.get('content-type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      const contentLength = Number(response.headers.get('content-length') || 0);
      const maxBytes = kind === 'video' ? MAX_VIDEO_DOWNLOAD_BYTES : MAX_IMAGE_DOWNLOAD_BYTES;
      const supported = kind === 'video'
        ? isVideoResponse(contentType, targetUrl)
        : isImageResponse(contentType);
      if (!supported || (contentLength && contentLength > maxBytes)) {
        res.status(422).json({ error: `The returned file is not a supported original ${kind}.` });
        return;
      }

      if (kind === 'video') {
        if (!response.body) {
          res.status(502).json({ error: 'The original video is temporarily unavailable.' });
          return;
        }
        res.setHeader('Content-Type', contentType);
        if (contentLength) res.setHeader('Content-Length', contentLength);
        res.setHeader('Content-Disposition', `attachment; filename="${getVideoFileName(targetUrl, contentType)}"`);
        res.setHeader('Cache-Control', 'private, no-store');
        const source = Readable.fromWeb(response.body);
        const limiter = createByteLimitStream(maxBytes);
        source.on('error', () => res.destroy());
        limiter.on('error', () => res.destroy());
        source.pipe(limiter).pipe(res);
        return;
      }

      const image = Buffer.from(await response.arrayBuffer());
      if (!image.length || image.length > MAX_IMAGE_DOWNLOAD_BYTES) {
        res.status(422).json({ error: 'The returned image is unavailable or too large.' });
        return;
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', image.length);
      res.setHeader('Content-Disposition', `attachment; filename="${getImageFileName(targetUrl, contentType)}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(image);
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        res.status(504).json({ error: 'The original image download timed out. Please try again.' });
        return;
      }
      res.status(502).json({ error: `The original ${kind || 'media'} is temporarily unavailable.` });
    }
  });

  app.post('/api/short-videos/parse', rateLimit, async (req, res) => {
    let request;
    try {
      request = resolveParserRequest(req.body?.platform, req.body?.url, parserBaseUrl);
    } catch {
      res.status(400).json({ error: 'Use a valid sharing link for the selected platform.' });
      return;
    }

    try {
      const response = await fetchImpl(request.endpoint, {
        headers: { Accept: 'application/json' },
        signal: globalThis.AbortSignal?.timeout?.(75_000),
      });
      if (!response.ok) {
        res.status(502).json({ error: 'The parsing service is temporarily unavailable. Please try again.' });
        return;
      }

      const payload = await readJson(response);
      if (Number(payload?.code) !== 200) {
        res.status(422).json({ error: 'This link could not be parsed. Check the link and try again.' });
        return;
      }

      const result = normalizeParserResponse(payload, request.platform);
      if (!result.videos.length && !result.images.length && !result.music.length) {
        res.status(422).json({ error: 'No downloadable media was returned for this link.' });
        return;
      }
      res.json({
        result: {
          ...result,
          imageDownloads: result.images.map(url => downloadTokens.createDownloadUrl('image', url)),
          videoDownloads: result.videos.map(url => downloadTokens.createDownloadUrl('video', url)),
        },
      });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        res.status(504).json({ error: 'Parsing timed out. Please try again shortly.' });
        return;
      }
      res.status(502).json({ error: 'The parsing service is temporarily unavailable. Please try again.' });
    }
  });
}
