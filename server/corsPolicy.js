function createCorsError() {
  return Object.assign(
    new Error('Cross-origin request is not allowed'),
    { code: 'CORS_ORIGIN_DENIED', status: 403, statusCode: 403 },
  );
}

function normalizeOrigin(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

export function createSameOriginCorsOptionsDelegate({ allowedOrigins = [] } = {}) {
  const normalizedAllowedOrigins = new Set(
    (Array.isArray(allowedOrigins) ? allowedOrigins : [])
      .map(normalizeOrigin)
      .filter(Boolean),
  );
  return (req, callback) => {
    const origin = String(req.get('origin') || '').trim();
    if (!origin) {
      callback(null, { origin: false });
      return;
    }

    const requestOrigin = normalizeOrigin(`${req.protocol}://${req.get('host') || ''}`);
    const normalizedOrigin = normalizeOrigin(origin);
    if (
      !requestOrigin
      || (!normalizedAllowedOrigins.has(normalizedOrigin) && normalizedOrigin !== requestOrigin)
    ) {
      callback(createCorsError());
      return;
    }

    callback(null, {
      origin: true,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    });
  };
}

export function applySameOriginCorsPolicy(app, corsMiddleware, options) {
  if (!app || typeof app.disable !== 'function' || typeof app.use !== 'function') {
    throw new TypeError('An Express application is required');
  }
  if (typeof corsMiddleware !== 'function') {
    throw new TypeError('CORS middleware is required');
  }
  app.disable('x-powered-by');
  app.use(corsMiddleware(createSameOriginCorsOptionsDelegate(options)));
}
