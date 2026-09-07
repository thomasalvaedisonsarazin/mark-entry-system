import express from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

export const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { class: cls, sec } = req.query;
  const conds = ['is_deleted = false'];
  const params = [];
  if (cls) { params.push(cls); conds.push(`class = $${params.length}`); }
  if (sec) { params.push(sec); conds.push(`sec = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT student_id, class, sec, admission_no, exam_no, name FROM students
     WHERE ${conds.join(' AND ')} ORDER BY class, sec, admission_no`, params
  );
  res.json(rows);
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { class: cls, sec, admissionNo, examNo, name } = req.body || {};
  if (!cls || !sec || !admissionNo || !name) return res.status(400).json({ error: 'class, sec, admissionNo, name required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO students (class, sec, admission_no, exam_no, name)
       VALUES ($1,$2,$3,$4,$5) RETURNING student_id`,
      [cls, sec, admissionNo, examNo || null, name]
    );
    const studentId = rows[0].student_id;
    await client.query(
      `INSERT INTO student_audit (student_id, changed_by, action, new_class, new_sec, new_admission_no, new_exam_no, new_name)
       VALUES ($1,$2,'ADD',$3,$4,$5,$6,$7)`,
      [studentId, req.user.emp_id, cls, sec, admissionNo, examNo || null, name]
    );
    await client.query('COMMIT');
    res.json({ studentId });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Edit / transfer — always logs before+after and is revertible.
router.put('/:studentId', requireRole('admin'), async (req, res) => {
  const { studentId } = req.params;
  const { class: cls, sec, admissionNo, examNo, name } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existingRows } = await client.query(
      'SELECT * FROM students WHERE student_id = $1 AND is_deleted = false FOR UPDATE', [studentId]
    );
    const existing = existingRows[0];
    if (!existing) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Student not found' }); }

    const updated = {
      class: cls ?? existing.class, sec: sec ?? existing.sec,
      admission_no: admissionNo ?? existing.admission_no, exam_no: examNo ?? existing.exam_no,
      name: name ?? existing.name,
    };

    await client.query(
      `UPDATE students SET class=$1, sec=$2, admission_no=$3, exam_no=$4, name=$5, updated_at=now() WHERE student_id=$6`,
      [updated.class, updated.sec, updated.admission_no, updated.exam_no, updated.name, studentId]
    );
    const action = (existing.class !== updated.class || existing.sec !== updated.sec || existing.admission_no !== updated.admission_no)
      ? 'TRANSFER' : 'EDIT';
    await client.query(
      `INSERT INTO student_audit (student_id, changed_by, action,
         old_class, old_sec, old_admission_no, old_exam_no, old_name,
         new_class, new_sec, new_admission_no, new_exam_no, new_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [studentId, req.user.emp_id, action,
        existing.class, existing.sec, existing.admission_no, existing.exam_no, existing.name,
        updated.class, updated.sec, updated.admission_no, updated.exam_no, updated.name]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/:studentId', requireRole('admin'), async (req, res) => {
  const { studentId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM students WHERE student_id=$1 AND is_deleted=false FOR UPDATE', [studentId]);
    const existing = rows[0];
    if (!existing) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Student not found' }); }
    await client.query('UPDATE students SET is_deleted = true, updated_at = now() WHERE student_id = $1', [studentId]);
    await client.query(
      `INSERT INTO student_audit (student_id, changed_by, action, old_class, old_sec, old_admission_no, old_exam_no, old_name)
       VALUES ($1,$2,'DELETE',$3,$4,$5,$6,$7)`,
      [studentId, req.user.emp_id, existing.class, existing.sec, existing.admission_no, existing.exam_no, existing.name]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Revert a specific audit change — restores the prior state, marks it reverted.
router.post('/audit/:changeId/revert', requireRole('admin'), async (req, res) => {
  const { changeId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM student_audit WHERE change_id = $1 FOR UPDATE', [changeId]);
    const change = rows[0];
    if (!change) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Change not found' }); }
    if (change.reverted) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Already reverted' }); }

    if (change.action === 'DELETE') {
      await client.query('UPDATE students SET is_deleted = false WHERE student_id = $1', [change.student_id]);
    } else if (change.action === 'ADD') {
      await client.query('UPDATE students SET is_deleted = true WHERE student_id = $1', [change.student_id]);
    } else {
      await client.query(
        `UPDATE students SET class=$1, sec=$2, admission_no=$3, exam_no=$4, name=$5, updated_at=now() WHERE student_id=$6`,
        [change.old_class, change.old_sec, change.old_admission_no, change.old_exam_no, change.old_name, change.student_id]
      );
    }
    await client.query('UPDATE student_audit SET reverted = true WHERE change_id = $1', [changeId]);
    await client.query(
      `INSERT INTO student_audit (student_id, changed_by, action) VALUES ($1,$2,'REVERT')`,
      [change.student_id, req.user.emp_id]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get('/audit', requireRole('admin'), async (req, res) => {
  const { studentId } = req.query;
  const { rows } = await pool.query(
    studentId
      ? 'SELECT * FROM student_audit WHERE student_id = $1 ORDER BY created_at DESC'
      : 'SELECT * FROM student_audit ORDER BY created_at DESC LIMIT 200',
    studentId ? [studentId] : []
  );
  res.json(rows);
});
