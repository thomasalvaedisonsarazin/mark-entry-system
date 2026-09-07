import express from 'express';
import { pool } from '../db.js';
import {
  verifyPassword, hashPassword, checkRateLimit, recordFailedLogin, clearFailedLogins,
  createSession, destroySession, requireAuth, isTriviallyGuessedPassword,
} from '../auth.js';

export const router = express.Router();

// Login response bundles everything the first screen needs — no second
// "now go fetch my own profile" round trip (per spec's silent-failure/racing lesson).
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    await checkRateLimit(username);
  } catch (err) {
    return res.status(err.status || 429).json({ error: err.message });
  }

  const { rows } = await pool.query(
    'SELECT * FROM teachers WHERE username = $1 AND is_deleted = false', [username]
  );
  const teacher = rows[0];
  const ok = teacher && await verifyPassword(password, teacher.password_hash);

  if (!ok) {
    if (teacher) await recordFailedLogin(username);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  await clearFailedLogins(username);
  const { sessionId, expiresAt } = await createSession(teacher.emp_id);

  const { rows: accessRows } = await pool.query(
    'SELECT class, sec, subject FROM teacher_access WHERE emp_id = $1', [teacher.emp_id]
  );

  res.json({
    sessionId,
    expiresAt,
    user: {
      empId: teacher.emp_id,
      name: teacher.name,
      username: teacher.username,
      isAdmin: teacher.is_admin,
      isAhm: teacher.is_ahm,
      isSuperAdmin: teacher.is_super_admin,
      mustChangePassword: teacher.must_change_password,
    },
    access: accessRows,
  });
});

router.post('/logout', requireAuth, async (req, res) => {
  await destroySession(req.headers['x-session-id']);
  res.json({ ok: true });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (isTriviallyGuessedPassword(newPassword)) {
    return res.status(400).json({ error: 'That password is too easy to guess. Choose another.' });
  }
  const hash = await hashPassword(newPassword);
  await pool.query(
    'UPDATE teachers SET password_hash = $1, must_change_password = false WHERE emp_id = $2',
    [hash, req.user.emp_id]
  );
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT class, sec, subject FROM teacher_access WHERE emp_id = $1', [req.user.emp_id]
  );
  res.json({
    user: {
      empId: req.user.emp_id, name: req.user.name, username: req.user.username,
      isAdmin: req.user.is_admin, isAhm: req.user.is_ahm, isSuperAdmin: req.user.is_super_admin,
      mustChangePassword: req.user.must_change_password,
    },
    access: rows,
  });
});
