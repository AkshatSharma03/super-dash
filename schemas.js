// ─────────────────────────────────────────────────────────────────────────────
// REQUEST SCHEMAS  —  Zod schemas for every API route that accepts input.
//
// Usage in routes:
//   const body = validate(ChatSchema, req.body, res);
//   if (!body) return;   // validate() already sent 400
// ─────────────────────────────────────────────────────────────────────────────
import { z } from 'zod';

// ── Shared limits (mirror server.js constants) ────────────────────────────────
const MAX_MSG_CHARS     = 12_000;
const MAX_QUERY_CHARS   = 1_000;
const MAX_CSV_COLS      = 50;
const MAX_CSV_ROWS      = 500;
const MAX_CONTEXT_CHARS = 2_000;

// ── Validation helper ─────────────────────────────────────────────────────────
// Returns the parsed value on success; sends a 400 and returns null on failure.
export function validate(schema, data, res) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.errors
      .map(e => `${e.path.join('.') || 'body'}: ${e.message}`)
      .join('; ');
    res.status(400).json({ error: message });
    return null;
  }
  return result.data;
}

// ── AI endpoints ──────────────────────────────────────────────────────────────

export const ChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role:    z.enum(['user', 'assistant']),
        content: z.union([
          z.string().max(MAX_MSG_CHARS),
          z.record(z.unknown()),
        ]),
      })
    )
    .min(1, 'messages must not be empty'),
});

export const SearchSchema = z.object({
  query: z.string().min(1, 'query is required').max(MAX_QUERY_CHARS),
});

export const AnalyzeCsvSchema = z.object({
  headers: z.array(z.string().max(100)).min(1).max(MAX_CSV_COLS),
  rows:    z.array(z.array(z.unknown())).max(MAX_CSV_ROWS),
  context: z.string().max(MAX_CONTEXT_CHARS).optional(),
});

export const AnalyticsSchema = z.object({
  query:   z.string().min(1, 'query is required').max(MAX_MSG_CHARS),
  context: z.string().max(8_000).optional(),
});

// ── Auth endpoints ────────────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  email:    z.string().email('invalid email address'),
  password: z.string().min(8, 'password must be at least 8 characters'),
  name:     z.string().min(1, 'name is required').max(80),
});

export const LoginSchema = z.object({
  email:    z.string().email('invalid email address'),
  password: z.string().min(1, 'password is required'),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'currentPassword is required'),
  newPassword:     z.string().min(8, 'newPassword must be at least 8 characters'),
});

export const DeleteAccountSchema = z.object({
  password: z.string().min(1, 'password is required'),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().email('invalid email address'),
});

export const ResetPasswordSchema = z.object({
  token:       z.string().min(1, 'token is required'),
  newPassword: z.string().min(8, 'newPassword must be at least 8 characters'),
});

// ── Session endpoints ─────────────────────────────────────────────────────────

export const CreateSessionSchema = z.object({
  title: z.string().max(100).optional(),
});

export const UpdateSessionSchema = z.object({
  messages: z.array(z.unknown()).optional(),
  title:    z.string().max(100).optional(),
});

// ── Country search query param ────────────────────────────────────────────────

export const CountrySearchQuerySchema = z.object({
  q: z.string().min(2, 'q must be at least 2 characters').max(100),
});
