import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';

export function createAuthRouter(deps) {
  const {
    authLimiter,
    requireAuth,
    track,
    ph,
    stmt,
    validate,
    schemas,
    BCRYPT_ROUNDS,
    JWT_SECRET,
    PORT,
    revokeCurrentToken,
  } = deps;

  const {
    RegisterSchema,
    LoginSchema,
    ChangePasswordSchema,
    DeleteAccountSchema,
    ForgotPasswordSchema,
    ResetPasswordSchema,
  } = schemas;

  const router = express.Router();

  router.post('/logout', requireAuth, (req, res) => {
    revokeCurrentToken(req.user);
    track(req.user.id, 'user_logged_out');
    res.json({ ok: true });
  });

  router.post('/guest', authLimiter, (_req, res) => {
    const token = jwt.sign(
      { id: 'guest', name: 'Guest', email: '', isGuest: true, jti: randomBytes(16).toString('hex') },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    track('guest', 'guest_session_started');
    res.json({ token, user: { id: 'guest', name: 'Guest', email: '', isGuest: true } });
  });

  router.post('/register', authLimiter, async (req, res) => {
    const body = validate(RegisterSchema, req.body, res);
    if (!body) return;
    const { email, password, name } = body;
    const em = email.toLowerCase().trim();
    if (stmt.userByEmail.get(em)) return res.status(409).json({ error: 'Email already registered' });
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const id = `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const uname = name.slice(0, 80).trim();
    stmt.insertUser.run(id, em, uname, hashedPassword, new Date().toISOString());
    const token = jwt.sign({ id, email: em, name: uname, jti: randomBytes(16).toString('hex') }, JWT_SECRET, { expiresIn: '7d' });
    if (ph) ph.identify({ distinctId: id, properties: { email: em, name: uname } });
    track(id, 'user_registered', { email: em, name: uname });
    res.json({ token, user: { id, email: em, name: uname } });
  });

  router.post('/login', authLimiter, async (req, res) => {
    const body = validate(LoginSchema, req.body, res);
    if (!body) return;
    const { email, password } = body;
    const em = email.toLowerCase().trim();
    const user = stmt.userByEmail.get(em);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const match = await bcrypt.compare(password, user.hashed_password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, jti: randomBytes(16).toString('hex') }, JWT_SECRET, { expiresIn: '7d' });
    track(user.id, 'user_logged_in', { email: user.email });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  });

  router.get('/me', requireAuth, (req, res) => {
    if (req.user?.isGuest) {
      return res.json({ id: 'guest', name: 'Guest', email: '', isGuest: true });
    }

    if (req.user?.isClerkUser) {
      return res.json({ id: req.user.id, email: req.user.email || '', name: req.user.name || 'User' });
    }

    const user = stmt.userById.get(req.user.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    return res.json(user);
  });

  router.get('/usage', requireAuth, (req, res) => {
    const user = stmt.userById.get(req.user.id);
    const rows = stmt.sessionMessages.all(req.user.id);
    const sessionCount = rows.length;
    const messageCount = rows.reduce((sum, row) => {
      try {
        const msgs = JSON.parse(row.messages);
        if (!Array.isArray(msgs)) return sum;
        return sum + msgs.filter((m) => m && m.role === 'user').length;
      } catch {
        return sum;
      }
    }, 0);
    const memberSince = user?.created_at
      || (req.user?.iat ? new Date(req.user.iat * 1000).toISOString() : new Date().toISOString());

    return res.json({ sessionCount, messageCount, memberSince });
  });

  router.patch('/password', requireAuth, authLimiter, async (req, res) => {
    if (req.user?.isClerkUser) {
      return res.status(400).json({ error: 'Password is managed by Clerk. Update it from account settings.' });
    }

    const body = validate(ChangePasswordSchema, req.body, res);
    if (!body) return;
    const { currentPassword, newPassword } = body;
    const user = stmt.userByIdFull.get(req.user.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const match = await bcrypt.compare(currentPassword, user.hashed_password);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
    const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    stmt.updatePassword.run(hashed, req.user.id);
    revokeCurrentToken(req.user);
    res.json({ ok: true });
  });

  router.delete('/account', requireAuth, authLimiter, async (req, res) => {
    if (req.user?.isClerkUser) {
      return res.status(400).json({ error: 'Account deletion is managed by Clerk. Use account settings.' });
    }

    const body = validate(DeleteAccountSchema, req.body, res);
    if (!body) return;
    const { password } = body;
    const user = stmt.userByIdFull.get(req.user.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const match = await bcrypt.compare(password, user.hashed_password);
    if (!match) return res.status(401).json({ error: 'Password is incorrect' });
    revokeCurrentToken(req.user);
    stmt.deleteUser.run(req.user.id);
    res.json({ ok: true });
  });

  router.post('/forgot-password', authLimiter, async (req, res) => {
    const body = validate(ForgotPasswordSchema, req.body, res);
    if (!body) return;
    const em = body.email.toLowerCase().trim();

    stmt.deleteExpiredResetTokens.run(Date.now());

    const user = stmt.userByEmail.get(em);
    if (!user) return res.json({ ok: true });

    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 60 * 60 * 1000;
    stmt.insertResetToken.run(token, user.id, expiresAt);

    const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
    const resetUrl = `${APP_URL}/?reset=${token}`;

    const smtpHost = process.env.SMTP_HOST;
    if (smtpHost) {
      try {
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.default.createTransport({
          host: smtpHost,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === 'true',
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        await transporter.sendMail({
          from: process.env.SMTP_FROM || `"EconChart" <noreply@${smtpHost}>`,
          to: em,
          subject: 'Reset your EconChart password',
          text: `Click the link below to reset your password (valid for 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
          html: `<p>Click the link below to reset your password (valid for 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
        });
        return res.json({ ok: true });
      } catch (err) {
        console.error('Failed to send reset email:', err);
        return res.status(500).json({ error: 'Failed to send reset email' });
      }
    }

    res.json({ ok: true, resetUrl });
  });

  router.post('/reset-password', authLimiter, async (req, res) => {
    const body = validate(ResetPasswordSchema, req.body, res);
    if (!body) return;
    const { token, newPassword } = body;

    const row = stmt.getResetToken.get(token);
    if (!row) return res.status(400).json({ error: 'Invalid or already-used reset link' });
    if (row.expires_at < Date.now()) return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });

    const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    stmt.updatePassword.run(hashed, row.user_id);
    stmt.markResetTokenUsed.run(token);
    res.json({ ok: true });
  });

  return router;
}
