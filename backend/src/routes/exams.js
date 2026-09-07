import express from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { getSubjectsFor } from '../subjects.js';

export const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.id, e.exam_name, e.created_at, ay.year_label, ay.id as academic_year_id
     FROM exams e JOIN academic_years ay ON ay.id = e.academic_year_id
     ORDER BY e.created_at DESC`
  );
  res.json(rows);
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { examName, academicYearId } = req.body || {};
  if (!examName) return res.status(400).json({ error: 'examName required' });

  let yearId = academicYearId;
  if (!yearId) {
    const { rows } = await pool.query('SELECT id FROM academic_years WHERE is_current = true');
    if (!rows[0]) return res.status(400).json({ error: 'No current academic year set. Create one first.' });
    yearId = rows[0].id;
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO exams (academic_year_id, exam_name) VALUES ($1,$2) RETURNING id',
      [yearId, examName]
    );
    res.json({ examId: rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An exam with this name already exists for this academic year' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/academic-years', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM academic_years ORDER BY created_at DESC');
  res.json(rows);
});

router.post('/academic-years', requireRole('superadmin'), async (req, res) => {
  const { yearLabel, makeCurrent } = req.body || {};
  if (!yearLabel) return res.status(400).json({ error: 'yearLabel required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (makeCurrent) await client.query('UPDATE academic_years SET is_current = false WHERE is_current = true');
    const { rows } = await client.query(
      'INSERT INTO academic_years (year_label, is_current) VALUES ($1, $2) RETURNING id',
      [yearLabel, !!makeCurrent]
    );
    await client.query('COMMIT');
    res.json({ academicYearId: rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Subjects for a class+section (drives both config screen and mark entry screen).
router.get('/subjects', (req, res) => {
  const { class: cls, sec } = req.query;
  if (!cls || !sec) return res.status(400).json({ error: 'class and sec required' });
  try {
    res.json(getSubjectsFor(cls, sec));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Max/pass config per exam+class+subject.
router.get('/:examId/config', async (req, res) => {
  const { examId } = req.params;
  const { class: cls } = req.query;
  const params = [examId];
  let where = 'exam_id = $1';
  if (cls) { params.push(cls); where += ' AND class = $2'; }
  const { rows } = await pool.query(`SELECT * FROM exam_config WHERE ${where}`, params);
  res.json(rows);
});

router.put('/:examId/config', requireRole('admin'), async (req, res) => {
  const { examId } = req.params;
  const { class: cls, subject, maxTheory, passTheory, maxInternal, passInternal, maxPractical, passPractical } = req.body || {};
  if (!cls || !subject) return res.status(400).json({ error: 'class and subject required' });

  await pool.query(
    `INSERT INTO exam_config (exam_id, class, subject, max_theory, pass_theory, max_internal, pass_internal, max_practical, pass_practical)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (exam_id, class, subject) DO UPDATE SET
       max_theory=$4, pass_theory=$5, max_internal=$6, pass_internal=$7, max_practical=$8, pass_practical=$9`,
    [examId, cls, subject, maxTheory || 0, passTheory || 0, maxInternal || 0, passInternal || 0, maxPractical || 0, passPractical || 0]
  );
  res.json({ ok: true });
});
