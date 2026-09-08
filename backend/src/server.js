import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';

import { router as authRouter } from './routes/auth.js';
import { router as studentsRouter } from './routes/students.js';
import { router as examsRouter } from './routes/exams.js';
import { router as marksRouter } from './routes/marks.js';
import { router as locksRouter } from './routes/locks.js';
import { router as teachersRouter } from './routes/teachers.js';
import { router as ranksRouter } from './routes/ranks.js';
import { router as settingsRouter } from './routes/settings.js';

const app = express();
app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(',') }));
app.use(express.json());

// Global soft ceiling in front of per-username lockout, so the login endpoint
// itself can't be hammered regardless of which username is being tried.
const loginLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30 });
app.use('/api/auth/login', loginLimiter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/students', studentsRouter);
app.use('/api/exams', examsRouter);
app.use('/api/marks', marksRouter);
app.use('/api/locks', locksRouter);
app.use('/api/teachers', teachersRouter);
app.use('/api/ranks', ranksRouter);
app.use('/api/settings', settingsRouter);

// Every route above sends a JSON error on failure — this is the last-resort
// catch so an unhandled exception still returns JSON, never a silent hang
// (the exact bug class §3 of the spec calls out).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Mark entry backend listening on :${port}`));
