import express from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { getSubjectsFor } from '../subjects.js';
import { computeRankList } from '../rankCompute.js';

export const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin')); // Rank lists/cards are admin-only, same as the old system.

async function loadStudents(cls, sec) {
  const { rows } = await pool.query(
    `SELECT student_id, admission_no, exam_no, name FROM students
     WHERE class=$1 AND sec=$2 AND is_deleted=false ORDER BY name`,
    [cls, sec]
  );
  return rows;
}

async function loadExamConfig(examId, cls) {
  const { rows } = await pool.query(
    'SELECT * FROM exam_config WHERE exam_id=$1 AND class=$2', [examId, cls]
  );
  return rows;
}

async function loadMarks(examId, cls, sec) {
  const { rows } = await pool.query(
    'SELECT student_id, subject, theory, internal, practical, is_absent FROM marks WHERE exam_id=$1 AND class=$2 AND sec=$3',
    [examId, cls, sec]
  );
  return rows;
}

// Rank list for ONE exam + class + section.
router.get('/list', async (req, res) => {
  const { examId, class: cls, sec } = req.query;
  if (!examId || !cls || !sec) return res.status(400).json({ error: 'examId, class, sec required' });
  let subjects;
  try { subjects = getSubjectsFor(cls, sec); } catch (err) { return res.status(400).json({ error: err.message }); }

  const { rows: examRows } = await pool.query('SELECT exam_name FROM exams WHERE id=$1', [examId]);
  if (!examRows[0]) return res.status(404).json({ error: 'Exam not found' });

  const [students, cfgRows, markRows] = await Promise.all([
    loadStudents(cls, sec), loadExamConfig(examId, cls), loadMarks(examId, cls, sec),
  ]);
  const results = computeRankList(examRows[0].exam_name, students, subjects, cfgRows, markRows);
  res.json(results);
});

// Whether every exam/subject for this class+section is locked — gates bulk
// Rank Card generation, exactly like the old getRankCardLockStatus.
// Pass examId to scope the check to just that one exam instead of every
// exam in the current academic year (used when generating a single-exam
// Rank Card instead of the full multi-exam progress report).
router.get('/lock-status', async (req, res) => {
  const { class: cls, sec, examId } = req.query;
  if (!cls || !sec) return res.status(400).json({ error: 'class, sec required' });
  let subjects;
  try { subjects = getSubjectsFor(cls, sec); } catch (err) { return res.status(400).json({ error: err.message }); }

  const { rows: allExams } = await pool.query(
    `SELECT e.id, e.exam_name FROM exams e JOIN academic_years ay ON ay.id = e.academic_year_id
     WHERE ay.is_current = true ORDER BY e.created_at`
  );
  const exams = examId ? allExams.filter((e) => e.id === examId) : allExams;
  if (examId && !exams.length) return res.status(404).json({ error: 'Exam not found' });

  const { rows: lockRows } = await pool.query(
    `SELECT l.exam_id, l.subject, l.locked FROM locks l
     JOIN exams e ON e.id = l.exam_id JOIN academic_years ay ON ay.id = e.academic_year_id
     WHERE ay.is_current = true AND l.class=$1 AND l.sec=$2`,
    [cls, sec]
  );
  const lockedSet = new Set(lockRows.filter((r) => r.locked).map((r) => `${r.exam_id}|${r.subject}`));

  const unlocked = [];
  for (const ex of exams) {
    for (const subj of subjects) {
      if (!lockedSet.has(`${ex.id}|${subj}`)) unlocked.push({ examName: ex.exam_name, subject: subj });
    }
  }
  res.json({ fullyLocked: unlocked.length === 0, unlocked, examCount: exams.length });
});

// Rank card data — by default every exam in the current academic year, side
// by side (the full progress-report card). Pass examId to scope the card to
// just that one exam instead.
router.get('/cards', async (req, res) => {
  const { class: cls, sec, examId } = req.query;
  if (!cls || !sec) return res.status(400).json({ error: 'class, sec required' });
  let subjects;
  try { subjects = getSubjectsFor(cls, sec); } catch (err) { return res.status(400).json({ error: err.message }); }

  const students = await loadStudents(cls, sec);
  const { rows: allExams } = await pool.query(
    `SELECT e.id, e.exam_name FROM exams e JOIN academic_years ay ON ay.id = e.academic_year_id
     WHERE ay.is_current = true ORDER BY e.created_at`
  );
  const exams = examId ? allExams.filter((e) => e.id === examId) : allExams;
  if (examId && !exams.length) return res.status(404).json({ error: 'Exam not found' });

  const cards = {};
  for (const s of students) {
    cards[s.student_id] = { admissionNo: s.admission_no, name: s.name, class: cls, sec, examNo: s.exam_no, exams: [] };
  }

  for (const ex of exams) {
    const [cfgRows, markRows] = await Promise.all([loadExamConfig(ex.id, cls), loadMarks(ex.id, cls, sec)]);
    const rankList = computeRankList(ex.exam_name, students, subjects, cfgRows, markRows);
    for (const r of rankList) {
      if (cards[r.studentId]) {
        cards[r.studentId].exams.push({
          examName: ex.exam_name, subjects: r.subjects, grandTotal: r.grandTotal,
          grandMax: r.grandMax, percentage: r.percentage, rank: r.rank, result: r.result, complete: r.complete,
        });
      }
    }
  }

  res.json(Object.values(cards).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
});

// One student's card (same shape as one entry of /cards). Pass examId to
// scope it to just that one exam.
router.get('/cards/:admissionNo', async (req, res) => {
  const { class: cls, sec, examId } = req.query;
  const { admissionNo } = req.params;
  if (!cls || !sec) return res.status(400).json({ error: 'class, sec required' });

  const { rows: studentRows } = await pool.query(
    `SELECT student_id, admission_no, exam_no, name FROM students
     WHERE class=$1 AND sec=$2 AND admission_no=$3 AND is_deleted=false`,
    [cls, sec, admissionNo]
  );
  if (!studentRows[0]) return res.status(404).json({ error: 'Student not found in this class/section' });

  let subjects;
  try { subjects = getSubjectsFor(cls, sec); } catch (err) { return res.status(400).json({ error: err.message }); }
  const { rows: allExams } = await pool.query(
    `SELECT e.id, e.exam_name FROM exams e JOIN academic_years ay ON ay.id = e.academic_year_id
     WHERE ay.is_current = true ORDER BY e.created_at`
  );
  const exams = examId ? allExams.filter((e) => e.id === examId) : allExams;
  if (examId && !exams.length) return res.status(404).json({ error: 'Exam not found' });

  const student = studentRows[0];
  const card = { admissionNo: student.admission_no, name: student.name, class: cls, sec, examNo: student.exam_no, exams: [] };
  for (const ex of exams) {
    const [cfgRows, markRows] = await Promise.all([loadExamConfig(ex.id, cls), loadMarks(ex.id, cls, sec)]);
    const rankList = computeRankList(ex.exam_name, [student], subjects, cfgRows, markRows);
    const r = rankList[0];
    card.exams.push({
      examName: ex.exam_name, subjects: r.subjects, grandTotal: r.grandTotal,
      grandMax: r.grandMax, percentage: r.percentage, rank: r.rank, result: r.result, complete: r.complete,
    });
  }
  res.json(card);
});
