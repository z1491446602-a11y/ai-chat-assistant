import { MAX_REDEEM_CODE_UNITS } from './pointsService.js';

const DEFAULT_COOKIE_NAME = 'chat_auth';
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const DEFAULT_RATE_LIMIT_MAX = 10;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const REDEEM_CODE_PATTERN = /^[A-Za-z0-9]{8}$/u;
const JSON_API_PATHS = ['/api/auth', '/api/points', '/api/admin'];
const PUBLIC_CACHEABLE_API_PATHS = new Set(['/api/daily-suggestions']);

const PUBLIC_ERRORS = Object.freeze({
  INVALID_PHONE: { status: 422, message: '手机号格式不正确' },
  INVALID_PASSWORD: { status: 422, message: '密码需为 8-72 位，且同时包含字母和数字' },
  INVALID_REAL_NAME: { status: 422, message: '真实姓名格式不正确' },
  PHONE_ALREADY_REGISTERED: { status: 409, message: '该手机号已注册' },
  INVALID_CREDENTIALS: { status: 401, message: '手机号或密码错误' },
  INVALID_REDEEM_CODE: { status: 422, message: '兑换码无效' },
  REDEEM_CODE_ALREADY_USED: { status: 409, message: '兑换码已被使用' },
  REDEEM_CODE_LIMIT_REACHED: { status: 409, message: '未使用兑换码数量已达上限，请先使用现有码' },
  REDEEM_CODE_POINT_LIMIT_EXCEEDED: {
    status: 422,
    message: '积分必须为 0.1 至 1000000，且最多保留一位小数',
  },
  INVALID_POINT_UNITS: {
    status: 422,
    message: '积分必须为 0.1 至 1000000，且最多保留一位小数',
  },
  POINT_BALANCE_LIMIT_EXCEEDED: { status: 409, message: '积分余额已达上限' },
  INSUFFICIENT_POINTS: { status: 402, message: '积分不足' },
  USER_NOT_FOUND: { status: 401, message: '登录状态已失效，请重新登录' },
  ACCOUNT_IDENTITY_MISMATCH: { status: 404, message: '手机号或真实姓名不匹配' },
});

function positiveNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
}

export function parseCookies(cookieHeader) {
  const cookies = Object.create(null);
  if (typeof cookieHeader !== 'string' || !cookieHeader) return cookies;

  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) continue;
    const name = part.slice(0, separatorIndex).trim();
    if (!name || Object.hasOwn(cookies, name)) continue;
    const rawValue = part.slice(separatorIndex + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

function serializeCookie(name, value, { maxAgeSeconds, secure, clear = false }) {
  if (!COOKIE_NAME_PATTERN.test(name)) {
    throw new TypeError('Invalid authentication cookie name');
  }

  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${clear ? 0 : maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Lax',
  ];
  if (clear) attributes.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  return attributes.join('; ');
}

export function parsePointUnits(points) {
  const normalized = typeof points === 'number' || typeof points === 'string'
    ? String(points).trim()
    : '';
  if (!/^(?:0\.[1-9]|[1-9]\d*(?:\.\d)?)$/u.test(normalized)) return null;

  const units = Number(normalized) * 10;
  return Number.isSafeInteger(units) && units > 0 && units <= MAX_REDEEM_CODE_UNITS
    ? units
    : null;
}

export function createIpRateLimiter({
  now = Date.now,
  windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
  maxRequests = DEFAULT_RATE_LIMIT_MAX,
} = {}) {
  const getNow = typeof now === 'function' ? now : Date.now;
  const duration = positiveNumber(windowMs, DEFAULT_RATE_LIMIT_WINDOW_MS);
  const limit = Math.max(1, Math.floor(positiveNumber(maxRequests, DEFAULT_RATE_LIMIT_MAX)));
  const buckets = new Map();

  function consume(key) {
    const timestamp = Number(getNow());
    for (const [storedKey, bucket] of buckets) {
      if (timestamp - bucket.windowStartedAt >= duration) buckets.delete(storedKey);
    }

    const normalizedKey = String(key || 'unknown');
    let bucket = buckets.get(normalizedKey);
    if (!bucket) {
      bucket = { windowStartedAt: timestamp, count: 0 };
      buckets.set(normalizedKey, bucket);
    }

    if (bucket.count >= limit) {
      return {
        allowed: false,
        retryAfterMs: Math.max(1, bucket.windowStartedAt + duration - timestamp),
      };
    }

    bucket.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  return { consume };
}

export function privateApiNoStore(req, res, next) {
  const requestPath = typeof req?.path === 'string' ? req.path : '';
  if (
    (requestPath === '/api' || requestPath.startsWith('/api/'))
    && !PUBLIC_CACHEABLE_API_PATHS.has(requestPath)
  ) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
}

function publicError(error) {
  return PUBLIC_ERRORS[error?.code] || {
    status: 500,
    message: '服务器暂时繁忙，请稍后重试',
  };
}

export function registerAuthRoutes(app, dependencies = {}) {
  const {
    authService,
    pointsService,
    cookieName = DEFAULT_COOKIE_NAME,
    cookieSecure = false,
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
    rateLimitWindowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
    rateLimitMax = DEFAULT_RATE_LIMIT_MAX,
    now = Date.now,
    jsonParser,
  } = dependencies;

  if (!app || typeof app.use !== 'function') {
    throw new TypeError('registerAuthRoutes requires an Express app');
  }
  if (!authService || !pointsService) {
    throw new TypeError('registerAuthRoutes requires authService and pointsService');
  }
  if (typeof jsonParser !== 'function') {
    throw new TypeError('registerAuthRoutes requires a JSON parser');
  }
  if (!COOKIE_NAME_PATTERN.test(cookieName)) {
    throw new TypeError('Invalid authentication cookie name');
  }

  const maxAgeSeconds = Math.max(1, Math.floor(
    positiveNumber(sessionTtlMs, DEFAULT_SESSION_TTL_MS) / 1_000,
  ));
  const rateLimiter = createIpRateLimiter({
    now,
    windowMs: rateLimitWindowMs,
    maxRequests: rateLimitMax,
  });

  function setSessionCookie(res, token) {
    res.setHeader('Set-Cookie', serializeCookie(cookieName, token, {
      maxAgeSeconds,
      secure: Boolean(cookieSecure),
    }));
  }

  function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', serializeCookie(cookieName, '', {
      maxAgeSeconds,
      secure: Boolean(cookieSecure),
      clear: true,
    }));
  }

  function withPoints(user) {
    if (!user) return null;
    const { balanceUnits, availableUnits } = pointsService.getBalance(user.id);
    return {
      ...user,
      points: balanceUnits / 10,
      availablePoints: availableUnits / 10,
    };
  }

  function sendError(res, error) {
    const { status, message } = publicError(error);
    res.status(status).json({ error: message });
  }

  function asyncRoute(handler) {
    return (req, res) => {
      Promise.resolve(handler(req, res)).catch(error => sendError(res, error));
    };
  }

  function rateLimitAuth(req, res, next) {
    const result = rateLimiter.consume(req.ip || req.socket?.remoteAddress || 'unknown');
    if (result.allowed) {
      next();
      return;
    }
    res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1_000)));
    res.status(429).json({ error: '请求过于频繁，请稍后重试' });
  }

  function handleJsonBodyError(error, _req, res, next) {
    if (error?.type === 'entity.too.large' || error?.status === 413) {
      res.status(413).json({ error: '请求内容过大' });
      return;
    }
    if (error?.type === 'entity.parse.failed' || error?.status === 400) {
      res.status(400).json({ error: '请求内容格式错误' });
      return;
    }
    next(error);
  }

  function requireLogin(req, res, next) {
    if (req.authUser) {
      next();
      return;
    }
    res.status(401).json({ error: '请先登录' });
  }

  function requireAdmin(req, res, next) {
    if (!req.authUser) {
      res.status(401).json({ error: '请先登录' });
      return;
    }
    if (req.authUser.role !== 'admin') {
      res.status(403).json({ error: '无管理员权限' });
      return;
    }
    next();
  }

  app.use(JSON_API_PATHS, jsonParser, handleJsonBodyError);

  app.use((req, _res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[cookieName] || '';
    req.authToken = token;
    Promise.resolve(authService.getUserByToken(token))
      .then(user => {
        req.authUser = user || null;
        next();
      })
      .catch(() => {
        req.authUser = null;
        next();
      });
  });

  app.use(JSON_API_PATHS, (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.post('/api/auth/register', rateLimitAuth, asyncRoute(async (req, res) => {
    const credentials = {
      phone: req.body?.phone,
      password: req.body?.password,
      realName: req.body?.realName,
    };
    await authService.register(credentials);
    const login = await authService.login(credentials);
    setSessionCookie(res, login.token);
    res.status(201).json({ user: withPoints(login.user) });
  }));

  app.post('/api/auth/login', rateLimitAuth, asyncRoute(async (req, res) => {
    const login = await authService.login({
      phone: req.body?.phone,
      password: req.body?.password,
    });
    setSessionCookie(res, login.token);
    res.json({ user: withPoints(login.user) });
  }));

  app.post('/api/auth/logout', asyncRoute(async (req, res) => {
    await authService.logout(req.authToken);
    clearSessionCookie(res);
    res.json({ ok: true });
  }));

  app.get('/api/auth/me', asyncRoute(async (req, res) => {
    res.json({ user: withPoints(req.authUser) });
  }));

  app.post('/api/points/redeem', requireLogin, asyncRoute(async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!REDEEM_CODE_PATTERN.test(code)) {
      throw Object.assign(new Error('Invalid redeem code'), { code: 'INVALID_REDEEM_CODE' });
    }
    pointsService.redeemCode(req.authUser.id, code);
    res.json({ user: withPoints(req.authUser) });
  }));

  app.post('/api/admin/redeem-codes', requireAdmin, asyncRoute(async (req, res) => {
    const units = parsePointUnits(req.body?.points);
    if (units === null) {
      throw Object.assign(new Error('Invalid point units'), { code: 'INVALID_POINT_UNITS' });
    }
    const generated = pointsService.generateRedeemCode(units);
    res.status(201).json({ code: generated.code, points: generated.units / 10 });
  }));

  app.post('/api/admin/users/reset-password', requireAdmin, asyncRoute(async (req, res) => {
    const user = await authService.resetPasswordByAdmin({
      phone: req.body?.phone,
      realName: req.body?.realName,
      newPassword: req.body?.newPassword,
    });
    if (user.id === req.authUser.id) clearSessionCookie(res);
    res.json({ ok: true, user });
  }));

  app.get('/api/admin/redeem-codes', requireAdmin, asyncRoute(async (_req, res) => {
    const codes = pointsService.listMaskedCodes().map(record => ({
      id: record.id,
      maskedCode: record.maskedCode,
      points: record.units / 10,
      createdAt: record.createdAt,
      used: Boolean(record.used),
      usedBy: record.usedBy ?? null,
      usedAt: record.usedAt ?? null,
    }));
    res.json({ codes });
  }));
}
