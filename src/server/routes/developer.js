import { Router } from 'express';
import { createHash, randomBytes } from 'crypto';

function monthBucket(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function mapApiKeyRow(row, userPlanLimit) {
  const configuredLimit = Number.isFinite(row.rate_limit) && row.rate_limit > 0 ? row.rate_limit : userPlanLimit;
  const effectiveLimit = Math.min(userPlanLimit, configuredLimit);
  const monthKey = row.month_key || monthBucket();
  const callsThisMonth = row.month_key === monthKey ? row.calls_this_month || 0 : 0;

  return {
    id: row.id,
    name: row.name,
    keyPreview: row.key_preview,
    rateLimit: Number.isFinite(effectiveLimit) ? effectiveLimit : null,
    callsThisMonth,
    callsRemaining: Number.isFinite(effectiveLimit) ? Math.max(effectiveLimit - callsThisMonth, 0) : null,
    monthKey,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    createdAt: row.created_at,
  };
}

export function createDeveloperRouter(deps) {
  const {
    requireAuth,
    stmt,
    getApiMonthlyLimitForUser,
    validate,
    ApiKeyCreateSchema,
    ApiKeyDeleteSchema,
  } = deps;

  const router = Router();

  router.get('/keys', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot manage API keys' });

    const userLimit = getApiMonthlyLimitForUser(req.user.id);
    const rows = stmt.apiKeysByUser.all(req.user.id).map(row => mapApiKeyRow(row, userLimit));

    res.json({
      planLimit: Number.isFinite(userLimit) ? userLimit : null,
      keys: rows,
    });
  });

  router.post('/keys', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot create API keys' });

    const body = validate(ApiKeyCreateSchema, req.body, res);
    if (!body) return;

    const userLimit = getApiMonthlyLimitForUser(req.user.id);
    const name = (body.name || '').trim() || `API Key ${Date.now()}`;
    const storedLimit = Number.isFinite(userLimit) && userLimit > 0 ? userLimit : 0;
    const raw = `ec_${randomBytes(24).toString('hex')}`;
    const hash = createHash('sha256').update(raw).digest('hex');
    const preview = `${raw.slice(0, 6)}...${raw.slice(-4)}`;
    const id = `key_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const monthKey = monthBucket();

    stmt.insertApiKey.run(id, req.user.id, hash, preview, name, storedLimit, 0, monthKey, null, now);

    res.status(201).json({
      id,
      name,
      key: raw,
      keyPreview: preview,
      rateLimit: userLimit,
      callsThisMonth: 0,
      callsRemaining: userLimit,
      createdAt: now,
    });
  });

  router.delete('/keys/:id', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot delete API keys' });

    const params = validate(ApiKeyDeleteSchema, { id: req.params.id }, res);
    if (!params) return;

    const existing = stmt.apiKeyByIdAndUser.get(params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'API key not found' });

    stmt.deleteApiKey.run(params.id, req.user.id);
    res.json({ ok: true });
  });

  return router;
}
