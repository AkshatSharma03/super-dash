export function initSchema(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS country_cache (
    code       TEXT PRIMARY KEY,
    data_json  TEXT NOT NULL,
    cached_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    hashed_password TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    messages   TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON chat_sessions(user_id);

  CREATE TABLE IF NOT EXISTS search_history (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_search_history_user_id_updated_at
  ON search_history(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS search_sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    turns      TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_search_sessions_user_id
  ON search_sessions(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti        TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_shares (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    share_token TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    view_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_shares_token ON session_shares(share_token);

  CREATE TABLE IF NOT EXISTS subscriptions (
    id                     TEXT PRIMARY KEY,
    user_id                TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id     TEXT UNIQUE NOT NULL,
    stripe_subscription_id TEXT,
    plan                   TEXT NOT NULL DEFAULT 'free',
    status                 TEXT NOT NULL DEFAULT 'active',
    current_period_end     INTEGER,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

  CREATE TABLE IF NOT EXISTS custom_metrics (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    expression  TEXT NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_custom_metrics_user ON custom_metrics(user_id);

  CREATE TABLE IF NOT EXISTS api_keys (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash     TEXT NOT NULL UNIQUE,
    key_preview  TEXT NOT NULL,
    name         TEXT NOT NULL,
    rate_limit   INTEGER NOT NULL,
    calls_this_month INTEGER NOT NULL DEFAULT 0,
    month_key    TEXT,
    last_used_at INTEGER,
    created_at   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

  CREATE TABLE IF NOT EXISTS snapshots (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    country_code TEXT NOT NULL,
    session_id   TEXT,
    title        TEXT NOT NULL,
    description  TEXT,
    data_payload TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    data_version INTEGER NOT NULL,
    is_public    INTEGER NOT NULL DEFAULT 1,
    share_token  TEXT UNIQUE
  );

  CREATE INDEX IF NOT EXISTS idx_snapshots_user ON snapshots(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_snapshots_share_token ON snapshots(share_token);
  `);

  const cols = db.prepare('PRAGMA table_info(api_keys)').all().map((row) => row.name);
  if (!cols.includes('calls_this_month')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN calls_this_month INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('month_key')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN month_key TEXT');
  }
}
