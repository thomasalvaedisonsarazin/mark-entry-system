import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { isLocked } from './locks.js';

export const router = express.Router();
router.use(requireAuth);

/** True if the user may enter marks for this class/sec/subject: admins/AHM/superadmin always can (unless locked); a plain teacher only if TeacherAccess grants it. */
async function canEnterMarks(user, cls, sec, subject) {
  if (user.is_admin || user.is_super_admin) return true;
  const { rows } = await pool.query(
    'SELECT 1 FROM teacher_access WHERE emp_id=$1 AND class=$2 AND sec=$3 AND subject=$4',
    [user.emp_id, cls, sec, subject]
  );
  return rows.length > 0;
}

router.get('/', async (req, res) => {
  const { examId, class: cls, sec, subject } = req.query;
  if (!examId || !cls || !sec || !subject) return res.status(400).json({ error: 'examId, class, sec, subject required' });

  if (!(await canEnterMarks(req.user, cls, sec, subject))) {
    return res.status(403).json({ error: 'Not assigned to this class/section/subject' });
  }

  const { rows: students } = await pool.query(
    `SELECT student_id, admission_no, exam_no, name FROM students
     WHERE class=$1 AND sec=$2 AND is_deleted=false ORDER BY admission_no`,
    [cls, sec]
  );
  const { rows: marks } = await pool.query(
    `SELECT student_id, theory, internal, practical, is_absent, updated_at FROM marks
     WHERE exam_id=$1 AND class=$2 AND sec=$3 AND subject=$4`,
    [examId, cls, sec, subject]
  );
  const marksByStudent = Object.fromEntries(marks.map((m) => [m.student_id, m]));
  const locked = await isLocked(examId, cls, sec, subject);

  res.json({
    locked,
    rows: students.map((s) => ({ ...s, ...(marksByStudent[s.student_id] || {}) })),
  });
});

// Per-subject save. Accepts an array of { studentId, theory, internal, practical, isAbsent }.
router.post('/', async (req, res) => {
  const { examId, class: cls, sec, subject, entries } = req.body || {};
  if (!examId || !cls || !sec || !subject || !Array.isArray(entries)) {
    return res.status(400).json({ error: 'examId, class, sec, subject, entries[] required' });
  }

  if (!(await canEnterMarks(req.user, cls, sec, subject))) {
    return res.status(403).json({ error: 'Not assigned to this class/section/subject' });
  }
  if (await isLocked(examId, cls, sec, subject)) {
    return res.status(423).json({ error: 'This subject is locked and cannot be edited' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      await client.query(
        `INSERT INTO marks (exam_id, class, sec, subject, student_id, theory, internal, practical, is_absent, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         ON CONFLICT (exam_id, class, sec, subject, student_id) DO UPDATE SET
           theory=$6, internal=$7, practical=$8, is_absent=$9, updated_by=$10, updated_at=now()`,
        [examId, cls, sec, subject, e.studentId, e.theory ?? null, e.internal ?? null, e.practical ?? null, !!e.isAbsent, req.user.emp_id]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, saved: entries.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
