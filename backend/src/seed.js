// One-time bootstrap: creates the first academic year and the single Super
// Admin account (per spec §2, there is deliberately no UI to grant this role).
// Run once after `npm run migrate`. Change the password immediately after first login.
import 'dotenv/config';
import { pool } from './db.js';
import { hashPassword } from './auth.js';

async function main() {
  const yearLabel = process.env.SEED_YEAR || '2026-2027';
  const username = process.env.SEED_ADMIN_USERNAME || 'superadmin';
  const tempPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe#' + Math.floor(Math.random() * 100000);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: yearRows } = await client.query(
      `INSERT INTO academic_years (year_label, is_current) VALUES ($1, true)
       ON CONFLICT (year_label) DO UPDATE SET year_label = EXCLUDED.year_label
       RETURNING id`,
      [yearLabel]
    );
    const yearId = yearRows[0].id;

    const hash = await hashPassword(tempPassword);
    await client.query(
      `INSERT INTO teachers (name, username, password_hash, is_admin, is_super_admin, must_change_password)
       VALUES ('Super Admin', $1, $2, true, true, true)
       ON CONFLICT (username) DO NOTHING`,
      [username, hash]
    );

    await client.query(
      `INSERT INTO school_settings (id, academic_year_id) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET academic_year_id = $1`,
      [yearId]
    );

    await client.query('COMMIT');
    console.log(`Seeded academic year "${yearLabel}" and super admin.`);
    console.log(`  username: ${username}`);
    console.log(`  temp password: ${tempPassword}`);
    console.log('Log in and change this password immediately.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error('Seed failed:', err); process.exit(1); });
