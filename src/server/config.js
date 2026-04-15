import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = join(CONFIG_DIR, '..', '..');

export const PORT = process.env.PORT || 3000;
export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
export const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
export const KAGI_API_KEY = process.env.KAGI_API_KEY;
export const KAGI_BASE = process.env.KAGI_BASE || 'https://kagi.com/api/v0';
export const IS_DEV = process.env.NODE_ENV !== 'production';
export const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
export const CLERK_JWT_KEY = process.env.CLERK_JWT_KEY;
export const CLERK_AUTH_ENABLED = Boolean(CLERK_SECRET_KEY || CLERK_JWT_KEY);
export const NEWS_API_KEY = process.env.NEWS_API_KEY;
export const TRUSTED_NEWS_DOMAINS = 'reuters.com,bloomberg.com,ft.com,wsj.com,economist.com,apnews.com';

export const KIMI_API_KEY = process.env.KIMI_API_KEY;
export const KIMI_BASE = 'https://api.moonshot.cn/v1/chat/completions';
export const KIMI_MODEL = process.env.KIMI_MODEL || 'moonshot-v1-8k';

export const CACHE_CAP = 200;
export const TTL_SEARCH_MS = 30 * 60 * 1000;

export function chatCacheTtlMs() {
  const now = new Date();
  const flip = Date.UTC(now.getUTCFullYear() + 1, 0, 1);
  return flip - Date.now();
}

export const RL_WINDOW_MS = 15 * 60 * 1000;
export const RL_MAX = 20;

export const MAX_HISTORY = 40;
export const MAX_MSG_CHARS = 12_000;
export const MAX_QUERY_CHARS = 1_000;
export const MAX_CSV_COLS = 50;
export const MAX_CSV_ROWS = 500;
export const MAX_CONTEXT_CHARS = 2_000;
export const CSV_SAMPLE_ROWS = 30;
export const MAX_SEARCH_TURNS = 8;
export const MAX_SEARCH_HISTORY = 20;
export const ANTHROPIC_TIMEOUT_MS = 55_000;
export const ANTHROPIC_STREAM_TIMEOUT_MS = 180_000;
export const KAGI_TIMEOUT_MS = 25_000;

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
export const BCRYPT_ROUNDS = 10;

export const DB_PATH = process.env.DB_PATH || join(ROOT_DIR, 'data', 'econChart.db');

export const COUNTRY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RAW_DATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
