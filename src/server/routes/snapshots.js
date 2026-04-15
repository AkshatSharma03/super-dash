import { Router } from 'express';
import { randomBytes } from 'crypto';

function normalizeSnapshotCountry(normalizeCountryCode, toISO2, countries, rawCountryCode) {
  const normalized = normalizeCountryCode(String(rawCountryCode || '').trim());
  if (!normalized) return '';
  const iso2 = toISO2(normalized);
  if (!countries.isValid(iso2)) return '';
  return iso2;
}

function parseSnapshotPayload(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mapSnapshotRow(row, opts = {}) {
  const includePayload = Boolean(opts.includePayload);
  const parsedPayload = includePayload ? parseSnapshotPayload(row.data_payload) : null;

  return {
    id: row.id,
    countryCode: row.country_code,
    sessionId: row.session_id || null,
    title: row.title,
    description: row.description || '',
    isPublic: Number(row.is_public) === 1,
    shareToken: row.share_token || null,
    dataVersion: Number(row.data_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(includePayload ? { dataPayload: parsedPayload } : {}),
  };
}

function buildSnapshotCitation(snapshot, payload) {
  const name = (payload && typeof payload.name === 'string' && payload.name.trim()) || snapshot.countryCode;
  const version = Number(snapshot.data_version) || Date.now();
  const publishedYear = new Date(snapshot.created_at || Date.now()).getFullYear();
  const title = snapshot.title || `Snapshot of ${snapshot.country_code}`;
  return `${name}. (${publishedYear}). ${title} [Data set]. EconChart. Data version ${version}.`;
}

function buildSnapshotDiff(previousPayload, nextPayload) {
  const sections = [
    'code', 'name', 'flag', 'region', 'gdpData', 'exportData', 'importData',
    'exportSectors', 'importPartners', 'kpis', 'pieExports', 'pieImports', '_meta',
  ];
  const changedSections = [];
  for (const key of sections) {
    const before = previousPayload?.[key];
    const after = nextPayload?.[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changedSections.push(key);
    }
  }
  return { changedSections, changed: changedSections.length > 0 };
}

export function createSnapshotsRouter(deps) {
  const {
    requireAuth,
    stmt,
    validate,
    SnapshotCreateSchema,
    SnapshotRegenerateSchema,
    normalizeCountryCode,
    toISO2,
    countries,
    checkPlanLimit,
    buildCountryDataset,
    errorMessage,
  } = deps;

  const router = Router();

  router.get('/', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.json([]);
    const rows = stmt.snapshotsByUser.all(req.user.id);
    res.json(rows.map((row) => mapSnapshotRow(row)));
  });

  router.post('/', requireAuth, async (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot create snapshots' });

    const body = validate(SnapshotCreateSchema, req.body, res);
    if (!body) return;

    const countryCode = normalizeSnapshotCountry(normalizeCountryCode, toISO2, countries, body.countryCode);
    if (!countryCode) {
      return res.status(400).json({ error: `Invalid country code: ${body.countryCode}` });
    }

    const limit = checkPlanLimit(req.user.id, 'snapshots');
    const currentCount = stmt.snapshotsByUser.all(req.user.id).length;
    if (limit.limit !== Number.POSITIVE_INFINITY && currentCount >= limit.limit) {
      return res.status(402).json({ error: `Snapshot limit reached (${limit.limit}). Upgrade your plan for more.` });
    }

    const isPublic = body.isPublic ?? true;
    const payload = body.dataPayload ?? null;
    const title = (body.title || `Snapshot ${countryCode}`).slice(0, 160);
    const description = (body.description || '').trim().slice(0, 1000);
    const now = new Date().toISOString();
    const dataVersion = Number.isFinite(body.dataVersion) ? body.dataVersion : Date.now();
    const id = `snap_${Date.now()}_${randomBytes(4).toString('hex')}`;

    const finalPayload = payload ?? await buildCountryDataset(countryCode).catch((err) => {
      throw err;
    });

    const shareToken = Number(isPublic) === 1 ? randomBytes(8).toString('hex') : null;

    stmt.insertSnapshot.run(
      id, req.user.id, countryCode, null, title, description,
      JSON.stringify(finalPayload), now, now, dataVersion, Number(isPublic) ? 1 : 0, shareToken,
    );

    const result = {
      ...mapSnapshotRow({
        id, country_code: countryCode, session_id: null, title, description,
        is_public: Number(isPublic) ? 1 : 0, share_token: shareToken,
        data_version: dataVersion, created_at: now, updated_at: now,
        data_payload: JSON.stringify(finalPayload),
      }, { includePayload: true }),
      citation: buildSnapshotCitation({ country_code: countryCode, title, data_version: dataVersion, created_at: now }, finalPayload),
    };

    res.status(201).json(result);
  });

  router.get('/:id', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot view snapshots' });

    const row = stmt.snapshotById.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Snapshot not found' });
    if (row.user_id !== req.user.id) return res.status(404).json({ error: 'Snapshot not found' });

    const payload = parseSnapshotPayload(row.data_payload);
    res.json({
      ...mapSnapshotRow(row, { includePayload: true }),
      citation: buildSnapshotCitation(row, payload),
    });
  });

  router.post('/:id/regenerate', requireAuth, async (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guest users cannot regenerate snapshots' });

    const body = validate(SnapshotRegenerateSchema, req.body, res);
    if (!body) return;

    const row = stmt.snapshotById.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Snapshot not found' });
    if (row.user_id !== req.user.id) return res.status(404).json({ error: 'Snapshot not found' });

    const previousPayload = parseSnapshotPayload(row.data_payload);
    const countryCode = normalizeSnapshotCountry(normalizeCountryCode, toISO2, countries, row.country_code);
    if (!countryCode) return res.status(400).json({ error: `Invalid country code: ${row.country_code}` });

    try {
      const nextPayload = await buildCountryDataset(countryCode);
      const now = new Date().toISOString();
      const nextVersion = Date.now();
      const nextPayloadText = JSON.stringify(nextPayload);

      stmt.updateSnapshotPayload.run(nextPayloadText, nextVersion, now, row.id, req.user.id);

      const diff = {
        beforeVersion: Number(row.data_version),
        afterVersion: nextVersion,
        forceRefresh: Boolean(body.forceRefresh),
        ...buildSnapshotDiff(previousPayload, nextPayload),
      };

      const updatedRow = { ...row, data_payload: nextPayloadText, data_version: nextVersion, updated_at: now };

      res.json({
        snapshot: {
          ...mapSnapshotRow(updatedRow, { includePayload: true }),
          citation: buildSnapshotCitation(updatedRow, nextPayload),
        },
        diff,
      });
    } catch (err) {
      const message = errorMessage(err, `Failed to regenerate snapshot ${req.params.id}`);
      console.error(`/api/snapshots/${req.params.id}/regenerate:`, message);
      res.status(502).json({ error: message });
    }
  });

  return router;
}

export function createPublicSnapshotRouter(deps) {
  const { stmt } = deps;

  const router = Router();

  router.get('/:token', (req, res) => {
    const row = stmt.snapshotByShareToken.get(req.params.token);
    if (!row) return res.status(404).json({ error: 'Snapshot not found' });
    if (Number(row.is_public) !== 1) return res.status(404).json({ error: 'Snapshot is not public' });

    const payload = parseSnapshotPayload(row.data_payload);
    res.json({
      ...mapSnapshotRow(row, { includePayload: true }),
      citation: buildSnapshotCitation(row, payload),
    });
  });

  return router;
}
