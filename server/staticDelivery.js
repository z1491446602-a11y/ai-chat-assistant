import fs from 'fs';
import path from 'path';
import express from 'express';

const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const DOCUMENT_CACHE_CONTROL = 'no-store, no-cache, must-revalidate';
const COMPATIBILITY_FALLBACK_CACHE_CONTROL = 'no-cache, must-revalidate';
const VITE_HASHED_ASSET_PATTERN = /\/assets\/(?:[^/]+\/)*[^/]+-[a-z0-9_-]{8}\.[^./]+$/i;
const SPA_EXCLUDED_NAMESPACES = ['/api', '/assets', '/audios', '/socket.io', '/uploads', '/videos'];
const MAX_PATH_DECODE_PASSES = 3;

const EXCLUDED_COMPRESSION_TYPES = new Set([
  'application/gzip',
  'application/pdf',
  'application/vnd.ms-fontobject',
  'application/x-7z-compressed',
  'application/x-bzip2',
  'application/x-gzip',
  'application/x-rar-compressed',
  'application/zip',
]);

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function normalizeContentType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function decodeRequestPath(value) {
  let unresolvedPath = normalizePath(String(value || ''))
    .replace(/\/+/g, '/')
    .toLowerCase();
  let laterDecodeFailed = false;

  for (let pass = 0; pass < MAX_PATH_DECODE_PASSES; pass += 1) {
    try {
      const decodedPath = normalizePath(decodeURIComponent(unresolvedPath))
        .replace(/\/+/g, '/')
        .toLowerCase();
      if (decodedPath === unresolvedPath) {
        break;
      }
      unresolvedPath = decodedPath;
    } catch {
      if (pass === 0) {
        return null;
      }
      laterDecodeFailed = true;
      break;
    }
  }

  if (!laterDecodeFailed && /%[0-9a-f]{2}/i.test(unresolvedPath)) {
    return null;
  }

  return {
    unresolvedPath,
    normalizedPath: path.posix.normalize(unresolvedPath),
  };
}

function isSpaExcludedNamespace(requestPath) {
  return SPA_EXCLUDED_NAMESPACES.some(namespace => (
    requestPath === namespace || requestPath.startsWith(`${namespace}/`)
  ));
}

function isExcludedCompressionType(contentType) {
  if (!contentType || contentType === 'image/svg+xml') {
    return false;
  }

  return contentType === 'text/event-stream'
    || contentType.startsWith('audio/')
    || contentType.startsWith('font/')
    || contentType.startsWith('image/')
    || contentType.startsWith('video/')
    || EXCLUDED_COMPRESSION_TYPES.has(contentType);
}

export function getViteHashedAssetPrefix(assetFileName) {
  const extension = path.extname(String(assetFileName || ''));
  const baseName = path.basename(String(assetFileName || ''), extension);
  const match = baseName.match(/^(.+)-([A-Za-z0-9_-]{8})$/);
  return match?.[1] || '';
}

export function findCurrentHashedAsset(assetsDir, assetFileName) {
  const extension = path.extname(String(assetFileName || '')).toLowerCase();
  const prefix = getViteHashedAssetPrefix(assetFileName);

  if (!prefix || !['.js', '.css'].includes(extension) || !fs.existsSync(assetsDir)) {
    return '';
  }

  const candidates = fs.readdirSync(assetsDir)
    .filter(fileName => fileName !== assetFileName)
    .filter(fileName => path.extname(fileName).toLowerCase() === extension)
    .filter(fileName => getViteHashedAssetPrefix(fileName) === prefix)
    .sort((a, b) => {
      const aTime = fs.statSync(path.join(assetsDir, a)).mtimeMs;
      const bTime = fs.statSync(path.join(assetsDir, b)).mtimeMs;
      return bTime - aTime;
    });

  return candidates[0] ? path.join(assetsDir, candidates[0]) : '';
}

export function registerStaticResourceRoutes(app, {
  distDir,
  audioDir,
  legacyAudioDir,
  uploadDir,
  videoDir,
}) {
  const notFound = (_req, res) => res.sendStatus(404);

  const mediaStaticOptions = { index: false, redirect: false };

  app.use('/audios', express.static(audioDir, mediaStaticOptions));
  if (legacyAudioDir && path.resolve(legacyAudioDir) !== path.resolve(audioDir)) {
    app.use('/audios', express.static(legacyAudioDir, mediaStaticOptions));
  }
  app.use('/audios', notFound);

  app.use('/uploads', express.static(uploadDir, {
    index: false,
    redirect: false,
    setHeaders: (res) => {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }));
  app.use('/uploads', notFound);

  app.use('/videos', express.static(videoDir, {
    index: false,
    redirect: false,
    setHeaders: (res) => {
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }));
  app.use('/videos', notFound);

  app.use(express.static(distDir, {
    redirect: false,
    setHeaders: (res, filePath) => {
      const cacheControl = getStaticFileCacheControl(filePath);
      if (cacheControl) {
        res.setHeader('Cache-Control', cacheControl);
      }
    },
  }));

  const assetsDir = path.join(distDir, 'assets');
  app.get('/assets/:assetFileName', (req, res, next) => {
    const fallbackAssetPath = findCurrentHashedAsset(assetsDir, req.params.assetFileName);
    if (!fallbackAssetPath) {
      return next();
    }

    res.setHeader('Cache-Control', getCompatibilityFallbackCacheControl());
    return res.sendFile(fallbackAssetPath);
  });
  app.use('/assets', notFound);
}

export function registerSpaFallback(app, { indexPath }) {
  app.use((req, res, next) => {
    const isNavigationMethod = req.method === 'GET' || req.method === 'HEAD';
    const requestPaths = decodeRequestPath(req.path);
    const isExcludedNamespace = requestPaths !== null && (
      isSpaExcludedNamespace(requestPaths.unresolvedPath)
      || isSpaExcludedNamespace(requestPaths.normalizedPath)
    );
    const hasExtension = requestPaths !== null && path.posix.extname(requestPaths.normalizedPath) !== '';
    const acceptsHtml = Boolean(req.accepts('html'));

    if (!isNavigationMethod || requestPaths === null || isExcludedNamespace || hasExtension || !acceptsHtml) {
      return next();
    }

    res.setHeader('Cache-Control', getStaticFileCacheControl(indexPath));
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.sendFile(indexPath, error => {
      if (error) {
        res.status(404).json({
          error: 'Frontend not found',
          message: 'Please run npm run build first',
        });
      }
    });
  });
}

export function getDocumentCacheControl(requestPath) {
  const normalizedPath = normalizePath(requestPath).toLowerCase();
  return normalizedPath === '/' || normalizedPath.endsWith('.html')
    ? DOCUMENT_CACHE_CONTROL
    : '';
}

export function getStaticFileCacheControl(filePath) {
  const normalizedPath = normalizePath(filePath).toLowerCase();
  if (VITE_HASHED_ASSET_PATTERN.test(normalizedPath)) {
    return IMMUTABLE_ASSET_CACHE_CONTROL;
  }

  return normalizedPath.endsWith('.html') ? DOCUMENT_CACHE_CONTROL : '';
}

export function getCompatibilityFallbackCacheControl() {
  return COMPATIBILITY_FALLBACK_CACHE_CONTROL;
}

export function createCompressionFilter(defaultFilter) {
  return (req, res) => {
    const contentType = normalizeContentType(res.getHeader('Content-Type'));
    const contentEncoding = String(res.getHeader('Content-Encoding') || '').trim().toLowerCase();

    if (req.headers?.range
      || (contentEncoding && contentEncoding !== 'identity')
      || isExcludedCompressionType(contentType)) {
      return false;
    }

    return defaultFilter(req, res);
  };
}
