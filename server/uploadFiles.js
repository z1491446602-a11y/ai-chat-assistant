import fs from 'fs';
import path from 'path';
import { getBase64Payload } from './mediaPayload.js';
import { ensureDir } from './storage.js';

function createUploadError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function scanUploadDirectoryUsage(uploadDir) {
  return fs.readdirSync(uploadDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .reduce((usage, entry) => {
      const entryPath = path.join(uploadDir, entry.name);
      try {
        usage.totalBytes += fs.lstatSync(entryPath).size;
        usage.fileCount += 1;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      return usage;
    }, { totalBytes: 0, fileCount: 0 });
}

export function sanitizeUploadFileName(fileName) {
  const baseName = path.basename(String(fileName || 'file'));
  const sanitized = baseName.replace(/[^\w.\-() \u4e00-\u9fa5]/g, '_').trim();
  return sanitized || 'file';
}

export function createUploadFileStore({
  uploadDir,
  maxUploadSize,
  maxTotalBytes,
  maxFileCount,
  allowedFileExtensions,
  scanUploadUsage = scanUploadDirectoryUsage,
  usageCacheTtlMs = 60_000,
  now = Date.now,
}) {
  let cachedUsage = null;
  let lastUsageScanAt = 0;

  function ensureUploadDir() {
    ensureDir(uploadDir);
  }

  function getUploadUsage(forceRefresh = false) {
    const currentTime = now();
    if (forceRefresh || !cachedUsage || currentTime - lastUsageScanAt >= usageCacheTtlMs) {
      cachedUsage = scanUploadUsage(uploadDir);
      lastUsageScanAt = currentTime;
    }
    return cachedUsage;
  }

  function exceedsQuota(usage, nextFileBytes) {
    return (Number.isFinite(maxTotalBytes) && usage.totalBytes + nextFileBytes > maxTotalBytes)
      || (Number.isFinite(maxFileCount) && usage.fileCount >= maxFileCount);
  }

  function saveUploadedFile({ fileName, fileData, mimeType }) {
    const safeFileName = sanitizeUploadFileName(fileName);
    const extension = path.extname(safeFileName).toLowerCase();

    if (!extension || !allowedFileExtensions.has(extension)) {
      throw createUploadError('暂不支持这种文件格式', 'UPLOAD_VALIDATION_ERROR');
    }

    const { mimeType: dataUrlMimeType, base64 } = getBase64Payload(fileData);
    if (!base64) {
      throw createUploadError('文件内容为空或格式不正确', 'UPLOAD_VALIDATION_ERROR');
    }

    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) {
      throw createUploadError('文件内容为空', 'UPLOAD_VALIDATION_ERROR');
    }

    if (buffer.length > maxUploadSize) {
      throw createUploadError('文件过大，请控制在 20MB 以内', 'UPLOAD_VALIDATION_ERROR');
    }

    ensureUploadDir();

    let usage = getUploadUsage();
    if (exceedsQuota(usage, buffer.length)) {
      usage = getUploadUsage(true);
      if (exceedsQuota(usage, buffer.length)) {
        throw createUploadError('上传空间已满，请联系管理员清理后重试', 'UPLOAD_QUOTA_EXCEEDED');
      }
    }

    const storedFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${extension}`;
    fs.writeFileSync(path.join(uploadDir, storedFileName), buffer);
    usage.totalBytes += buffer.length;
    usage.fileCount += 1;

    return {
      fileName: safeFileName,
      fileUrl: `/uploads/${storedFileName}`,
      fileSize: buffer.length,
      mimeType: mimeType || dataUrlMimeType || 'application/octet-stream',
    };
  }

  return {
    ensureUploadDir,
    saveUploadedFile,
  };
}

export function createUploadRateLimiter({ windowMs, maxRequests, maxTrackedClients = 10_000 }) {
  const clients = new Map();
  let nextCleanupAt = Date.now() + windowMs;

  return (req, res, next) => {
    const now = Date.now();
    const clientKey = String(req.ip || req.socket?.remoteAddress || 'unknown');

    if (now >= nextCleanupAt) {
      for (const [key, entry] of clients) {
        if (now >= entry.resetAt) {
          clients.delete(key);
        }
      }
      nextCleanupAt = now + windowMs;
    }

    const current = clients.get(clientKey);

    if (!current || now >= current.resetAt) {
      if (!current && clients.size >= maxTrackedClients) {
        clients.delete(clients.keys().next().value);
      }
      clients.set(clientKey, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= maxRequests) {
      res.status(429).json({ error: '上传请求过于频繁，请稍后重试' });
      return undefined;
    }

    current.count += 1;
    return next();
  };
}

export function createUploadHandler(saveUploadedFile) {
  return (req, res) => {
    try {
      const body = req.body;
      if (!body
        || typeof body !== 'object'
        || Array.isArray(body)
        || typeof body.fileName !== 'string'
        || !body.fileName.trim()
        || typeof body.fileData !== 'string'
        || !body.fileData.trim()) {
        throw createUploadError('文件信息不完整', 'UPLOAD_VALIDATION_ERROR');
      }
      const { fileName, fileData, mimeType } = body;
      const uploadedFile = saveUploadedFile({ fileName, fileData, mimeType });
      res.json(uploadedFile);
    } catch (error) {
      const isQuotaError = error?.code === 'UPLOAD_QUOTA_EXCEEDED';
      const isValidationError = error?.code === 'UPLOAD_VALIDATION_ERROR';
      const statusCode = isQuotaError ? 413 : (isValidationError ? 400 : 500);
      res.status(statusCode).json({
        error: isQuotaError || isValidationError
          ? error.message
          : '文件上传失败，请稍后重试',
      });
    }
  };
}

export function registerUploadEndpoint(app, {
  rateLimiter,
  jsonParser,
  handler,
}) {
  app.post('/api/upload-file', rateLimiter, jsonParser, handler);
}
