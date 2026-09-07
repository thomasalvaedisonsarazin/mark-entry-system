import express from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { getSubjectsFor } from '../subjects.js';

export const router = express.Router();
router.use(requireAuth);

export async function isLocked(examId, cls, sec, subject) {
  const { rows } = await pool.query(
    'SELECT locked FROM locks WHERE exam_id=$1 AND class=$2 AND sec=$3 AND subject=$4',
    [examId, cls, sec, subject]
  );
  return rows[0]?.locked || false;
}

router.get('/', async (req, res) => {
  const { examId, class: cls, sec } = req.query;
  const conds = ['exam_id = $1']; const params = [examId];
  if (cls) { params.push(cls); conds.push(`class = $${params.length}`); }
  if (sec) { params.push(sec); conds.push(`sec = $${params.length}`); }
  const { rows } = await pool.query(`SELECT * FROM locks WHERE ${conds.join(' AND ')}`, params);
  res.json(rows);
});

router.post('/toggle', requireRole('admin'), async (req, res) => {
  const { examId, class: cls, sec, subject, locked } = req.body || {};
  if (!examId || !cls || !sec || !subject) return res.status(400).json({ error: 'examId, class, sec, subject required' });
  await pool.query(
    `INSERT INTO locks (exam_id, class, sec, subject, locked, locked_by, locked_at)
     VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $5 THEN now() ELSE NULL END)
     ON CONFLICT (exam_id, class, sec, subject) DO UPDATE SET
       locked = $5, locked_by = $6, locked_at = CASE WHEN $5 THEN now() ELSE NULL END`,
    [examId, cls, sec, subject, !!locked, req.user.emp_id]
  );
  res.json({ ok: true });
});

// Batch "lock all subjects" for a class+section.
router.post('/lock-all', requireRole('admin'), async (req, res) => {
  const { examId, class: cls, sec, locked } = req.body || {};
  if (!examId || !cls || !sec) return res.status(400).json({ error: 'examId, class, sec required' });
  const subjects = getSubjectsFor(cls, sec);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const subject of subjects) {
      await client.query(
        `INSERT INTO locks (exam_id, class, sec, subject, locked, locked_by, locked_at)
         VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $5 THEN now() ELSE NULL END)
         ON CONFLICT (exam_id, class, sec, subject) DO UPDATE SET
           locked = $5, locked_by = $6, locked_at = CASE WHEN $5 THEN now() ELSE NULL END`,
        [examId, cls, sec, subject, !!locked, req.user.emp_id]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, subjects });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Whether an entire class+section is fully locked (gates Rank Card generation).
router.get('/section-fully-locked', async (req, res) => {
  const { examId, class: cls, sec } = req.query;
  if (!examId || !cls || !sec) return res.status(400).json({ error: 'examId, class, sec required' });
  let subjects;
  try {
    subjects = getSubjectsFor(cls, sec);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const { rows } = await pool.query(
    'SELECT subject, locked FROM locks WHERE exam_id=$1 AND class=$2 AND sec=$3',
    [examId, cls, sec]
  );
  const lockedSet = new Set(rows.filter((r) => r.locked).map((r) => r.subject));
  const fullyLocked = subjects.every((s) => lockedSet.has(s));
  res.json({ fullyLocked, subjects, lockedSubjects: [...lockedSet] });
});
