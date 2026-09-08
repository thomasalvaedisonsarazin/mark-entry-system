import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';

export const router = express.Router();
router.use(requireAuth);

// Read-only for now — every logged-in user can read it (needed to print a
// Rank Card header); there's no edit screen yet (tracked in README's scope list).
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ss.block, ss.udise_code, ss.school_name, ss.school_type, ss.phone, ay.year_label AS academic_year
     FROM school_settings ss LEFT JOIN academic_years ay ON ay.id = ss.academic_year_id
     WHERE ss.id = 1`
  );
  res.json(rows[0] || {});
});
