import express from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole, hashPassword, randomTempPassword, verifyPassword, isTriviallyGuessedPassword } from '../auth.js';

export const router = express.Router();
router.use(requireAuth);

router.get('/', requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT emp_id, name, username, is_admin, is_ahm, is_super_admin, must_change_password, email
     FROM teachers WHERE is_deleted = false ORDER BY name`
  );
  res.json(rows);
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { name, username, isAdmin, isAhm } = req.body || {};
  if (!name || !username) return res.status(400).json({ error: 'name and username required' });

  const tempPassword = randomTempPassword();
  const hash = await hashPassword(tempPassword);
  try {
    const { rows } = await pool.query(
      `INSERT INTO teachers (name, username, password_hash, is_admin, is_ahm, must_change_password)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING emp_id`,
      [name, username, hash, !!isAdmin, !!isAhm]
    );
    // Temp password returned once, here, for the admin to hand to the teacher — never logged, never stored plaintext.
    res.json({ empId: rows[0].emp_id, tempPassword });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    res.status(500).json({ error: err.message });
  }
});

router.post('/:empId/reset-password', requireRole('admin'), async (req, res) => {
  const { empId } = req.params;
  const tempPassword = randomTempPassword();
  const hash = await hashPassword(tempPassword);
  const { rowCount } = await pool.query(
    'UPDATE teachers SET password_hash=$1, must_change_password=true WHERE emp_id=$2 AND is_deleted=false',
    [hash, empId]
  );
  if (!rowCount) return res.status(404).json({ error: 'Teacher not found' });
  res.json({ tempPassword });
});

router.put('/:empId/roles', requireRole('admin'), async (req, res) => {
  const { empId } = req.params;
  const { isAdmin, isAhm } = req.body || {};
  // is_super_admin is deliberately never settable through the API — DB-only promotion.
  await pool.query('UPDATE teachers SET is_admin=$1, is_ahm=$2 WHERE emp_id=$3', [!!isAdmin, !!isAhm, empId]);
  res.json({ ok: true });
});

router.delete('/:empId', requireRole('admin'), async (req, res) => {
  await pool.query('UPDATE teachers SET is_deleted = true WHERE emp_id = $1', [req.params.empId]);
  res.json({ ok: true });
});

router.get('/:empId/access', requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM teacher_access WHERE emp_id = $1', [req.params.empId]);
  res.json(rows);
});

router.post('/:empId/access', requireRole('admin'), async (req, res) => {
  const { class: cls, sec, subject } = req.body || {};
  if (!cls || !sec || !subject) return res.status(400).json({ error: 'class, sec, subject required' });
  await pool.query(
    `INSERT INTO teacher_access (emp_id, class, sec, subject) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [req.params.empId, cls, sec, subject]
  );
  res.json({ ok: true });
});

router.delete('/:empId/access/:accessId', requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM teacher_access WHERE id = $1 AND emp_id = $2', [req.params.accessId, req.params.empId]);
  res.json({ ok: true });
});
