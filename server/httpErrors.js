function errorStatus(error) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) ? status : 0;
}

function isOversizedBodyError(error) {
  return error?.type === 'entity.too.large' || errorStatus(error) === 413;
}

function isMalformedJsonError(error) {
  return error?.type === 'entity.parse.failed'
    || (errorStatus(error) === 400 && error instanceof SyntaxError);
}

function isCorsOriginDeniedError(error) {
  return error?.code === 'CORS_ORIGIN_DENIED';
}

export function registerTerminalErrorHandler(app, {
  logger = (...args) => console.error(...args),
} = {}) {
  if (!app || typeof app.use !== 'function') {
    throw new TypeError('registerTerminalErrorHandler requires an Express app');
  }
  if (typeof logger !== 'function') {
    throw new TypeError('registerTerminalErrorHandler logger must be a function');
  }

  app.use((error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (isOversizedBodyError(error)) {
      res.status(413).json({ error: '请求内容过大' });
      return;
    }
    if (isMalformedJsonError(error)) {
      res.status(400).json({ error: '请求内容格式错误' });
      return;
    }
    if (isCorsOriginDeniedError(error)) {
      res.status(403).json({ error: '不允许跨域访问' });
      return;
    }

    try {
      logger('Unhandled HTTP request error:', error);
    } catch {
      // A logging failure must not expose Express's default HTML error response.
    }
    res.status(500).json({ error: '服务器暂时繁忙，请稍后重试' });
  });
}
