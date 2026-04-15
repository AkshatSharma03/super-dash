import express from 'express';
import { randomBytes } from 'crypto';

export function createSessionsRouter(deps) {
  const {
    requireAuth,
    stmt,
    db,
    validate,
    schemas,
    normalizeSessionTitle,
    MAX_SEARCH_HISTORY,
  } = deps;

  const {
    SearchHistorySchema,
    CreateSearchSessionSchema,
    UpdateSearchSessionSchema,
    CreateSessionSchema,
    UpdateSessionSchema,
  } = schemas;

  const router = express.Router();

  router.get('/search/history', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.json([]);
    const rows = stmt.searchHistoryByUser.all(req.user.id, MAX_SEARCH_HISTORY);
    res.json(rows);
  });

  router.post('/search/history', requireAuth, (req, res) => {
    const body = validate(SearchHistorySchema, req.body, res);
    if (!body) return;

    if (req.user.isGuest) {
      const now = new Date().toISOString();
      return res.json({
        id: `guest_${Date.now()}`,
        query: body.query.trim(),
        createdAt: now,
        updatedAt: now,
      });
    }

    const query = body.query.trim();
    const now = new Date().toISOString();
    const existing = stmt.searchHistoryByQuery.get(req.user.id, query);

    if (existing) {
      stmt.updateSearchHistory.run(query, now, existing.id, req.user.id);
      return res.json({
        id: existing.id,
        query,
        createdAt: existing.created_at,
        updatedAt: now,
      });
    }

    const id = `sh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    stmt.insertSearchHistory.run(id, req.user.id, query, now, now);
    res.json({ id, query, createdAt: now, updatedAt: now });
  });

  router.delete('/search/history', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.json({ ok: true });
    stmt.clearSearchHistory.run(req.user.id);
    res.json({ ok: true });
  });

  router.get('/search/sessions', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.json([]);
    const rows = stmt.searchSessionsByUser.all(req.user.id);
    const sessions = rows.map((row) => {
      let turns = [];
      try {
        const parsed = JSON.parse(row.turns);
        turns = Array.isArray(parsed) ? parsed : [];
      } catch {
        turns = [];
      }
      return {
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        turns,
      };
    });
    res.json(sessions);
  });

  router.post('/search/sessions', requireAuth, (req, res) => {
    const body = validate(CreateSearchSessionSchema, req.body, res);
    if (!body) return;
    const title = normalizeSessionTitle(body.title, 'New Search');
    const id = `ss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    if (!req.user.isGuest) stmt.insertSearchSession.run(id, req.user.id, title, '[]', now, now);
    res.json({ id, title, turns: [], createdAt: now, updatedAt: now });
  });

  router.patch('/search/sessions/:id', requireAuth, (req, res) => {
    const body = validate(UpdateSearchSessionSchema, req.body, res);
    if (!body) return;

    if (req.user.isGuest) {
      return res.json({
        id: req.params.id,
        title: body.title !== undefined ? normalizeSessionTitle(body.title, 'New Search') : 'New Search',
        updatedAt: new Date().toISOString(),
      });
    }

    const row = stmt.searchSessionById.get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    const newTurns = body.turns !== undefined ? JSON.stringify(body.turns) : row.turns;
    const newTitle = body.title !== undefined ? normalizeSessionTitle(body.title, row.title) : row.title;
    const now = new Date().toISOString();
    stmt.updateSearchSession.run(newTurns, newTitle, now, req.params.id, req.user.id);
    res.json({ id: row.id, title: newTitle, updatedAt: now });
  });

  router.delete('/search/sessions/:id', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.json({ ok: true });

    const row = stmt.searchSessionById.get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    stmt.deleteSearchSession.run(req.params.id, req.user.id);
    res.json({ ok: true });
  });

  router.get('/sessions', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.json([]);
    res.json(stmt.sessionsByUser.all(req.user.id));
  });

  router.post('/sessions', requireAuth, (req, res) => {
    const body = validate(CreateSessionSchema, req.body, res);
    if (!body) return;
    const title = normalizeSessionTitle(body.title, 'New Chat');
    const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    if (!req.user.isGuest) stmt.insertSession.run(id, req.user.id, title, '[]', now, now);
    res.json({ id, userId: req.user.id, title, messages: [], createdAt: now, updatedAt: now });
  });

  router.get('/sessions/:id', requireAuth, (req, res) => {
    if (req.user.isGuest) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const row = stmt.sessionById.get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Session not found' });

    try {
      const parsedMessages = JSON.parse(row.messages);
      return res.json({ ...row, messages: Array.isArray(parsedMessages) ? parsedMessages : [] });
    } catch {
      return res.json({ ...row, messages: [] });
    }
  });

  router.patch('/sessions/:id', requireAuth, (req, res) => {
    const body = validate(UpdateSessionSchema, req.body, res);
    if (!body) return;

    if (req.user.isGuest) {
      return res.json({
        id: req.params.id,
        title: body.title !== undefined ? normalizeSessionTitle(body.title) : 'New Chat',
        updatedAt: new Date().toISOString(),
      });
    }

    const row = stmt.sessionById.get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    const newMessages = body.messages !== undefined ? JSON.stringify(body.messages) : row.messages;
    const newTitle = body.title !== undefined ? normalizeSessionTitle(body.title, row.title) : row.title;
    const now = new Date().toISOString();
    stmt.updateSession.run(newMessages, newTitle, now, req.params.id, req.user.id);
    res.json({ id: row.id, title: newTitle, updatedAt: now });
  });

  router.delete('/sessions/:id', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.json({ ok: true });

    const row = stmt.sessionById.get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    stmt.deleteSession.run(req.params.id, req.user.id);
    res.json({ ok: true });
  });

  router.post('/sessions/:id/share', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot share sessions' });

    const session = stmt.sessionById.get(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const shareToken = randomBytes(16).toString('hex');
    const id = `sh_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const expiresAt = null;

    stmt.insertShare.run(id, req.params.id, shareToken, now, expiresAt);

    res.json({ id, shareToken, url: `${req.protocol}://${req.get('host')}/share/${shareToken}`, createdAt: now });
  });

  router.get('/sessions/:id/shares', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.json([]);
    const session = stmt.sessionById.get(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(stmt.sharesBySession.all(req.params.id));
  });

  router.delete('/sessions/:id/shares/:shareId', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot manage shares' });
    stmt.deleteShare.run(req.params.shareId, req.user.id);
    res.json({ ok: true });
  });

  router.get('/share/:token', (req, res) => {
    const share = stmt.shareByToken.get(req.params.token);
    if (!share) return res.status(404).json({ error: 'Share not found' });

    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    const session = db.prepare('SELECT id, title, messages, created_at, updated_at FROM chat_sessions WHERE id = ?').get(share.session_id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    stmt.incrementViewCount.run(req.params.token);

    let messages = [];
    try {
      messages = JSON.parse(session.messages);
    } catch {
      messages = [];
    }

    res.json({
      title: session.title,
      messages: Array.isArray(messages) ? messages : [],
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      viewCount: share.view_count + 1,
    });
  });

  return router;
}
