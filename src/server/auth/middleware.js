import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { verifyToken as verifyClerkToken } from '@clerk/backend';

export function createRequireAuth({
  JWT_SECRET,
  CLERK_AUTH_ENABLED,
  CLERK_SECRET_KEY,
  CLERK_JWT_KEY,
  stmt,
  ensureClerkUserRecord,
}) {
  return async function requireAuth(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.jti && stmt.isTokenRevoked.get(payload.jti)) {
        return res.status(401).json({ error: 'Token has been revoked' });
      }
      req.user = payload;
      return next();
    } catch {
      if (!CLERK_AUTH_ENABLED) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      try {
        const verified = await verifyClerkToken(token, {
          ...(CLERK_SECRET_KEY ? { secretKey: CLERK_SECRET_KEY } : {}),
          ...(CLERK_JWT_KEY ? { jwtKey: CLERK_JWT_KEY } : {}),
        });

        req.user = {
          id: verified.sub,
          email: verified.email || '',
          name: verified.name || 'User',
          isGuest: false,
          iat: verified.iat,
          exp: verified.exp,
          isClerkUser: true,
        };

        try {
          ensureClerkUserRecord(req.user);
        } catch (e) {
          console.error('Failed to provision Clerk user record:', e.message);
          return res.status(500).json({ error: 'Unable to initialize user profile' });
        }

        return next();
      } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    }
  };
}

export function createAuthenticateApiKey({
  stmt,
  getApiMonthlyLimitForUser,
  monthBucket,
}) {
  return async function authenticateApiKey(req, res, nextMiddleware) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || !token.startsWith('ec_')) return res.status(401).json({ error: 'Invalid or missing API key' });

    const hashed = createHash('sha256').update(token).digest('hex');
    const row = stmt.apiKeyByHash.get(hashed);
    if (!row) return res.status(401).json({ error: 'Invalid or missing API key' });

    const userPlanLimit = getApiMonthlyLimitForUser(row.user_id);
    const configuredLimit = Number.isFinite(row.rate_limit) ? row.rate_limit : 0;
    const effectiveLimit = Number.isFinite(configuredLimit) && configuredLimit > 0
      ? configuredLimit
      : userPlanLimit;

    const nowBucket = monthBucket();
    const monthBucketForKey = row.month_key === nowBucket ? nowBucket : nowBucket;
    const previousMonthKey = row.month_key || nowBucket;
    const callsUsed = previousMonthKey === nowBucket ? (row.calls_this_month || 0) : 0;

    const limit = Math.min(userPlanLimit, effectiveLimit);

    if (limit !== Number.POSITIVE_INFINITY && callsUsed >= limit) {
      return res.status(429).json({ error: `API rate limit exceeded for this month (${limit} calls).` });
    }

    const nextUsageCount = callsUsed + 1;
    stmt.updateApiKeyUsage.run(nextUsageCount, monthBucketForKey, Date.now(), row.id);

    const remaining = limit === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.max(limit - nextUsageCount, 0);
    req.apiKey = row;
    req.apiKey.callsRemaining = remaining;
    req.apiKey.callsThisMonth = nextUsageCount;
    req.apiKey.month_key = monthBucketForKey;
    req.apiKey.monthlyLimit = limit;
    return nextMiddleware();
  };
}

export function createMcpAuth(MCP_API_KEY) {
  return function mcpAuth(req, res, next) {
    if (!MCP_API_KEY) return next();
    if (req.headers['x-mcp-key'] === MCP_API_KEY) return next();
    return res.status(401).json({ error: 'Invalid MCP API key' });
  };
}
