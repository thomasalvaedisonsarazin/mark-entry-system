// Applies schema.sql to whatever DATABASE_URL points at. Safe to re-run only
// on a fresh database (CREATE TABLE has no IF NOT EXISTS here on purpose —
// this is a first-migration script, not a migration framework).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Schema applied.');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
