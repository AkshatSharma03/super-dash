#!/usr/bin/env node

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const email = process.argv[2] || process.env.SUBSCRIPTION_EMAIL;
if (!email) {
  console.error('Usage: node scripts/upgrade-user-enterprise.mjs <email> [DB_PATH]');
  console.error('Set SUBSCRIPTION_EMAIL env var or pass email as first arg.');
  process.exit(1);
}

const dbPath = resolve(process.argv[3] || process.env.DB_PATH || join(process.cwd(), 'data', 'econChart.db'));
if (!existsSync(dbPath)) {
  console.error(`Database file not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);
const now = new Date().toISOString();

const tx = db.transaction(() => {
  let user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

  if (!user) {
    const userId = `usr_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const name = email.split('@')[0] || 'User';
    db.prepare(
      'INSERT INTO users (id, email, name, hashed_password, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(userId, email, name, 'hash', now);
    user = { id: userId };
  }

  const existingSub = db
    .prepare('SELECT id FROM subscriptions WHERE user_id = ?')
    .get(user.id);

  if (existingSub) {
    db.prepare(
      'UPDATE subscriptions SET plan = ?, status = ?, current_period_end = ?, updated_at = ? WHERE user_id = ?',
    ).run('enterprise', 'active', null, now, user.id);
  } else {
    const subId = `sub_ent_${Date.now()}_${randomUUID().slice(0, 10)}`;
    const customerId = `cus_${randomUUID().slice(0, 16)}`;
    db.prepare(
      `INSERT INTO subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(subId, user.id, customerId, subId, 'enterprise', 'active', null, now, now);
  }

  return db.prepare(
    `SELECT s.id, s.plan, s.status, s.updated_at, u.email
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE u.email = ?`,
  ).get(email);
});

try {
  const row = tx();
  console.log('Updated subscription:', JSON.stringify(row, null, 2));
  process.exit(0);
} catch (err) {
  console.error('Failed to update subscription:', err?.message || err);
  process.exit(1);
} finally {
  db.close();
}
