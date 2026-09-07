# Mark Entry & Rank Card System — Standalone Rebuild (MVP)

This is a working slice of the full system described in `MARK_ENTRY_SYSTEM_SPEC.md`,
built as real standalone software: Node/Express + Postgres backend, plain
HTML/JS frontend, no Google Apps Script, no Google Sheets.

## What's actually built and verified (don't take this on faith — it was tested)

- Postgres schema for the full data model (students, exams tied to academic years,
  exam config, marks, locks, teachers, teacher access, student audit trail, settings).
- Auth: bcrypt password hashing (a real stretched hash, not the old "poor man's
  PBKDF2"), per-username rate limiting (5 failed attempts → 15 min lockout),
  durable DB-backed sessions with an explicit expiry (never a shared cache —
  this was the exact bug that caused random "session expired" errors in the old
  system), forced password change on first login, rejection of trivially-guessed
  passwords.
- Subject rules verified line-for-line against the live `Code.gs`: fixed 5
  subjects for VI-X; XI-XII subjects determined entirely by section letter
  (Biology/Computer Science/Commerce/EMR/History groups); the internal
  "Language" key that always displays as "Tamil".
- EMIS conversion table and pass-mark lookup copied verbatim from `Code.gs`'s
  `EMIS_CONVERSION_TO` / `EMIS_PASS_MARK` / `EMIS_BIOLOGY_PASS_MARK` constants,
  including the Bio-Botany/Bio-Zoology → merged "Biology" logic and the
  flat-lookup-by-converted-max pass rule (not a proportional recalculation —
  that was a real shipped bug in the old system).
- Mark entry with per-subject locking: locked subjects are read-only for
  everyone including admins, at both the API and UI layer.
- Every API route returns JSON on both success and failure, and the frontend's
  single `api()` wrapper shows a toast on every failure automatically — this
  is the structural fix for the old system's "call fails silently, screen
  just sits there blank" bug class (spec §3).
- I ran this end-to-end with a real Postgres instance and a headless browser:
  login → forced password change → subject-rule lookup → lock enforcement →
  mark entry → save → reload → mark persisted. All verified, not assumed.
  (One real bug — a disabled-attribute handling issue that silently made mark
  inputs uneditable even when unlocked — was caught this way and fixed before
  delivery.)

## What is NOT built yet — be clear-eyed about this

This is the MVP core loop, not the full spec. Still missing, in the order I'd
build them:

1. **Rank Card generation** (pivot layout, Bio-Botany/Bio-Zoology merge on the
   printed card, PDF export, design customization).
2. **Rank computation** (pass-only ranking within class+section).
3. **Reports**: Pass/Fail/Absent, Exam Analysis (Super Admin, needs to be a
   background job for large classes per the spec's own warning), Strength Report.
4. **Bulk Excel import** for students/teachers/config.
5. **Google Sign-In** (linked-account OAuth, admin-linked not self-service).
6. **School/Section Settings screens, Subject Order, Rank Card design UI.**
7. A Sheets → Postgres data migration script for your real 2,700+ student data set.

None of this is hard given what's already built — the hard, bug-prone parts
(EMIS conversion, subject rules, locking, auth) are done and tested. The rest
is mostly CRUD screens and a PDF template. But don't tell anyone this is
"done" — it isn't.

## Running it locally

```bash
# 1. Postgres — create a database
createdb mark_entry

# 2. Backend
cd backend
cp .env.example .env   # edit DATABASE_URL to point at your database
npm install
npm run migrate        # applies schema.sql
npm run seed            # creates first academic year + Super Admin account
                         # (prints a one-time temp password — change it on first login)
npm start                # listens on :4000

# 3. Frontend — any static file server works, e.g.:
cd ../frontend
python3 -m http.server 5173
# edit config.js if your backend isn't at http://localhost:4000/api
```

Open `http://localhost:5173`, log in with the seeded Super Admin account, and
you'll be forced to set a new password immediately.

## Hosting on a real domain — I can't buy the domain for you

I don't have your payment details and shouldn't touch them. Here's what to
actually do, cheapest-and-boring version:

1. **Buy a domain** from any registrar (Namecheap, GoDaddy, Google Domains'
   successor Squarespace Domains, etc.) — a `.in` or `.com` is fine, expect
   roughly ₹500–1500/year depending on TLD and registrar.
2. **Host the backend + Postgres** somewhere that gives you both — Railway,
   Render, or Fly.io all offer a small free/cheap tier with managed Postgres
   attached. Point `DATABASE_URL` in that service's environment variables at
   the managed Postgres instance, run `npm run migrate` and `npm run seed`
   once against it (most of these platforms let you run a one-off shell
   command against the deployed service).
3. **Host the frontend** as a static site — Netlify, Vercel, or Cloudflare
   Pages, all free for this size of project. Set `config.js`'s `API_BASE` to
   your backend's public URL before deploying.
4. **Point your domain at both**: a CNAME (or the platform's suggested DNS
   record) for e.g. `app.yourschool.in` → the frontend host, and optionally
   `api.yourschool.in` → the backend host. Each platform's dashboard has a
   "custom domain" screen that tells you exactly what DNS record to add —
   follow that, not generic instructions, since it varies by registrar.
5. **HTTPS** is automatic on all of the above (Railway/Render/Fly and
   Netlify/Vercel/Cloudflare Pages all provision free TLS certs once DNS is
   pointed correctly) — don't pay anyone extra for an SSL certificate.

Total realistic cost: domain (~₹500-1500/yr) + hosting (free tier is enough
for one school's traffic; budget ~$5-10/month if you outgrow it). Nobody
needs to sell you more than that for this scale.

## Security notes for whoever deploys this

- Change the seeded Super Admin password immediately (the app forces this).
- `CORS_ORIGIN` in the backend's `.env` must be set to your actual frontend
  domain in production — don't leave it as `*`.
- Never commit `.env` to any repository you push publicly.
- The `is_super_admin` flag is intentionally not settable through any API —
  promote exactly one account directly in the database, per the spec.
