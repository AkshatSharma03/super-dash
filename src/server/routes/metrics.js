import { Router } from 'express';
import { randomBytes } from 'crypto';

export function createMetricsRouter(deps) {
  const {
    requireAuth,
    stmt,
    checkPlanLimit,
  } = deps;

  const router = Router();

  router.get('/', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.json([]);
    res.json(stmt.metricsByUser.all(req.user.id).map(m => ({
      id: m.id, name: m.name, expression: m.expression, description: m.description,
      createdAt: m.created_at, updatedAt: m.updated_at,
    })));
  });

  router.post('/', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot create custom metrics' });
    const { name, expression, description } = req.body;
    if (!name || !expression) return res.status(400).json({ error: 'Name and expression are required' });
    if (expression.length > 200) return res.status(400).json({ error: 'Expression too long (max 200 chars)' });

    const limit = checkPlanLimit(req.user.id, 'customMetrics');
    const currentCount = stmt.metricsByUser.all(req.user.id).length;
    if (currentCount >= limit.limit) {
      return res.status(402).json({ error: `Custom metric limit reached (${limit.limit}). Upgrade your plan for more.` });
    }

    const id = `metric_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    stmt.insertMetric.run(id, req.user.id, name.trim(), expression.trim(), (description || '').trim(), now, now);
    res.status(201).json({ id, name, expression, description: description || '', createdAt: now, updatedAt: now });
  });

  router.patch('/:id', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot modify custom metrics' });
    const { name, expression, description } = req.body;
    const existing = stmt.metricById.get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Metric not found' });
    const now = new Date().toISOString();
    stmt.updateMetric.run(
      name?.trim() ?? existing.name,
      expression?.trim() ?? existing.expression,
      description?.trim() ?? existing.description,
      now, req.params.id, req.user.id,
    );
    res.json({ id: existing.id, name: name?.trim() ?? existing.name, expression: expression?.trim() ?? existing.expression, updatedAt: now });
  });

  router.delete('/:id', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot delete custom metrics' });
    stmt.deleteMetric.run(req.params.id, req.user.id);
    res.json({ ok: true });
  });

  return router;
}
