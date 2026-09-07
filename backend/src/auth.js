import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { pool } from './db.js';

const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const COMMON_PASSWORDS = new Set([
  'password', 'password123', '12345678', '123456789', 'qwerty123',
  'letmein', 'admin123', 'welcome123', 'password1', '11111111',
]);

export function isTriviallyGuessedPassword(pw) {
  return COMMON_PASSWORDS.has(String(pw).toLowerCase());
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function randomTempPassword() {
  // Non-guessable temp password: 10 random alphanumeric chars, no predictable pattern.
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** Checks and updates per-username rate limiting. Throws if locked out. */
export async function checkRateLimit(username) {
  const { rows } = await pool.query('SELECT * FROM login_attempts WHERE username = $1', [username]);
  const row = rows[0];
  if (row && row.locked_until && new Date(row.locked_until) > new Date()) {
    const err = new Error('Too many failed attempts. Try again later.');
    err.status = 429;
    throw err;
  }
}

export async function recordFailedLogin(username) {
  const { rows } = await pool.query('SELECT * FROM login_attempts WHERE username = $1', [username]);
  const row = rows[0];
  const failedCount = (row?.failed_count || 0) + 1;
  const lockedUntil = failedCount >= MAX_FAILED_ATTEMPTS
    ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
    : null;
  await pool.query(
    `INSERT INTO login_attempts (username, failed_count, locked_until)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET failed_count = $2, locked_until = $3`,
    [username, failedCount, lockedUntil]
  );
}

export async function clearFailedLogins(username) {
  await pool.query('DELETE FROM login_attempts WHERE username = $1', [username]);
}

/** Creates a durable session row. Never store sessions in a shared/general-purpose cache. */
export async function createSession(empId) {
  const sessionId = uuidv4();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO sessions (session_id, emp_id, expires_at) VALUES ($1, $2, $3)',
    [sessionId, empId, expiresAt]
  );
  return { sessionId, expiresAt };
}

export async function getSession(sessionId) {
  const { rows } = await pool.query(
    `SELECT s.*, t.emp_id, t.name, t.username, t.is_admin, t.is_ahm, t.is_super_admin, t.must_change_password
     FROM sessions s JOIN teachers t ON t.emp_id = s.emp_id
     WHERE s.session_id = $1 AND s.expires_at > now() AND t.is_deleted = false`,
    [sessionId]
  );
  return rows[0] || null;
}

export async function destroySession(sessionId) {
  await pool.query('DELETE FROM sessions WHERE session_id = $1', [sessionId]);
}

/** Express middleware: requires a valid session, attaches req.user. */
export async function requireAuth(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) return res.status(401).json({ error: 'Not authenticated' });
  const session = await getSession(sessionId);
  if (!session) return res.status(401).json({ error: 'Session expired or invalid' });
  req.user = session;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const u = req.user;
    const has = roles.some((r) => {
      if (r === 'admin') return u.is_admin || u.is_super_admin;
      if (r === 'ahm') return u.is_ahm || u.is_admin || u.is_super_admin;
      if (r === 'superadmin') return u.is_super_admin;
      return false;
    });
    if (!has) return res.status(403).json({ error: 'Not permitted' });
    next();
  };
}
