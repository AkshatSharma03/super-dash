export function prepareStatements(db) {
  const stmtCountry = {
    get: db.prepare('SELECT data_json, cached_at FROM country_cache WHERE code = ?'),
    upsert: db.prepare('INSERT OR REPLACE INTO country_cache (code, data_json, cached_at) VALUES (?, ?, ?)'),
    del: db.prepare('DELETE FROM country_cache WHERE code = ?'),
  };

  const stmt = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT id, email, name FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (id, email, name, hashed_password, created_at) VALUES (?, ?, ?, ?, ?)'),
    sessionsByUser: db.prepare('SELECT id, title, created_at, updated_at FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC'),
    sessionById: db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?'),
    insertSession: db.prepare('INSERT INTO chat_sessions (id, user_id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
    updateSession: db.prepare('UPDATE chat_sessions SET messages = ?, title = ?, updated_at = ? WHERE id = ? AND user_id = ?'),
    deleteSession: db.prepare('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?'),

    shareByToken: db.prepare('SELECT * FROM session_shares WHERE share_token = ?'),
    sharesBySession: db.prepare('SELECT id, share_token, created_at, view_count FROM session_shares WHERE session_id = ?'),
    insertShare: db.prepare('INSERT INTO session_shares (id, session_id, share_token, created_at, expires_at, view_count) VALUES (?, ?, ?, ?, ?, 0)'),
    deleteShare: db.prepare('DELETE FROM session_shares WHERE id = ? AND session_id IN (SELECT id FROM chat_sessions WHERE user_id = ?)'),
    incrementViewCount: db.prepare('UPDATE session_shares SET view_count = view_count + 1 WHERE share_token = ?'),

    snapshotById: db.prepare('SELECT * FROM snapshots WHERE id = ?'),
    snapshotByShareToken: db.prepare('SELECT * FROM snapshots WHERE share_token = ?'),
    snapshotsByUser: db.prepare('SELECT * FROM snapshots WHERE user_id = ? ORDER BY created_at DESC'),
    insertSnapshot: db.prepare('INSERT INTO snapshots (id, user_id, country_code, session_id, title, description, data_payload, created_at, updated_at, data_version, is_public, share_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    updateSnapshotPayload: db.prepare('UPDATE snapshots SET data_payload = ?, data_version = ?, updated_at = ? WHERE id = ? AND user_id = ?'),
    deleteSnapshotById: db.prepare('DELETE FROM snapshots WHERE id = ? AND user_id = ?'),

    subscriptionByUser: db.prepare('SELECT * FROM subscriptions WHERE user_id = ?'),
    subscriptionByCustomerId: db.prepare('SELECT * FROM subscriptions WHERE stripe_customer_id = ?'),
    subscriptionBySubId: db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?'),
    insertSubscription: db.prepare('INSERT INTO subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    updateSubscription: db.prepare('UPDATE subscriptions SET plan = ?, status = ?, stripe_subscription_id = ?, current_period_end = ?, updated_at = ? WHERE user_id = ?'),
    deleteSubscription: db.prepare('DELETE FROM subscriptions WHERE user_id = ?'),

    metricsByUser: db.prepare('SELECT * FROM custom_metrics WHERE user_id = ? ORDER BY created_at DESC'),
    metricById: db.prepare('SELECT * FROM custom_metrics WHERE id = ? AND user_id = ?'),
    insertMetric: db.prepare('INSERT INTO custom_metrics (id, user_id, name, expression, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    updateMetric: db.prepare('UPDATE custom_metrics SET name = ?, expression = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?'),
    deleteMetric: db.prepare('DELETE FROM custom_metrics WHERE id = ? AND user_id = ?'),

    apiKeysByUser: db.prepare('SELECT id, name, key_preview, rate_limit, calls_this_month, month_key, last_used_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'),
    apiKeyByIdAndUser: db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?'),
    apiKeyByHash: db.prepare('SELECT * FROM api_keys WHERE key_hash = ?'),
    insertApiKey: db.prepare('INSERT INTO api_keys (id, user_id, key_hash, key_preview, name, rate_limit, calls_this_month, month_key, last_used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    updateApiKeyUsage: db.prepare('UPDATE api_keys SET calls_this_month = ?, month_key = ?, last_used_at = ? WHERE id = ?'),
    deleteApiKey: db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?'),

    searchHistoryByUser: db.prepare('SELECT id, query, created_at AS createdAt, updated_at AS updatedAt FROM search_history WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?'),
    searchHistoryByQuery: db.prepare('SELECT * FROM search_history WHERE user_id = ? AND lower(query) = lower(?) LIMIT 1'),
    insertSearchHistory: db.prepare('INSERT INTO search_history (id, user_id, query, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
    updateSearchHistory: db.prepare('UPDATE search_history SET query = ?, updated_at = ? WHERE id = ? AND user_id = ?'),
    clearSearchHistory: db.prepare('DELETE FROM search_history WHERE user_id = ?'),
    searchSessionsByUser: db.prepare('SELECT id, title, turns, created_at AS createdAt, updated_at AS updatedAt FROM search_sessions WHERE user_id = ? ORDER BY updated_at DESC'),
    searchSessionById: db.prepare('SELECT * FROM search_sessions WHERE id = ? AND user_id = ?'),
    insertSearchSession: db.prepare('INSERT INTO search_sessions (id, user_id, title, turns, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
    updateSearchSession: db.prepare('UPDATE search_sessions SET turns = ?, title = ?, updated_at = ? WHERE id = ? AND user_id = ?'),
    deleteSearchSession: db.prepare('DELETE FROM search_sessions WHERE id = ? AND user_id = ?'),

    userByIdFull: db.prepare('SELECT * FROM users WHERE id = ?'),
    updatePassword: db.prepare('UPDATE users SET hashed_password = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    sessionMessages: db.prepare('SELECT messages FROM chat_sessions WHERE user_id = ?'),
    insertResetToken: db.prepare('INSERT INTO password_reset_tokens (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)'),
    getResetToken: db.prepare('SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0'),
    markResetTokenUsed: db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE token = ?'),
    deleteExpiredResetTokens: db.prepare('DELETE FROM password_reset_tokens WHERE expires_at < ?'),
    revokeToken: db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)'),
    isTokenRevoked: db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?'),
    pruneRevokedTokens: db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?'),
  };

  return { stmt, stmtCountry };
}
