-- Mark Entry & Rank Card System — Postgres schema
-- Translated from MARK_ENTRY_SYSTEM_SPEC.md section 4, cross-checked against
-- the live Apps Script implementation (Code.gs) for exact field/behavior parity.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Academic Years / Exams
-- ---------------------------------------------------------------------------
CREATE TABLE academic_years (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_label    text NOT NULL UNIQUE,          -- e.g. '2026-2027'
  is_current    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Exactly one academic year may be current at a time.
CREATE UNIQUE INDEX one_current_academic_year ON academic_years (is_current) WHERE is_current;

CREATE TABLE exams (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  exam_name         text NOT NULL,             -- e.g. 'Weekly Test 1', 'Mid Term', 'Quarterly'
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Exam names are unique per academic year, not globally (per spec's Supabase improvement).
  UNIQUE (academic_year_id, exam_name)
);

-- ---------------------------------------------------------------------------
-- Students
-- ---------------------------------------------------------------------------
CREATE TABLE students (
  student_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- permanent, survives transfers
  class           text NOT NULL,               -- 'VI'..'XII'
  sec             text NOT NULL,               -- section letter
  admission_no    text NOT NULL,
  exam_no         text,
  name            text NOT NULL,
  is_deleted      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX students_active_admission_no
  ON students (admission_no) WHERE NOT is_deleted;
CREATE INDEX students_class_sec ON students (class, sec) WHERE NOT is_deleted;

-- Every add/edit/transfer/delete — revertible.
CREATE TABLE student_audit (
  change_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES students(student_id),
  changed_by      uuid NOT NULL,               -- teachers.emp_id (FK added below after teachers table)
  action          text NOT NULL CHECK (action IN ('ADD','EDIT','TRANSFER','DELETE','REVERT')),
  old_class       text, old_sec text, old_admission_no text, old_exam_no text, old_name text,
  new_class       text, new_sec text, new_admission_no text, new_exam_no text, new_name text,
  reverted        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Teachers / Auth
-- ---------------------------------------------------------------------------
CREATE TABLE teachers (
  emp_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  username              text NOT NULL UNIQUE,
  password_hash         text NOT NULL,         -- bcrypt hash (includes its own salt)
  is_admin              boolean NOT NULL DEFAULT false,
  is_ahm                boolean NOT NULL DEFAULT false,
  is_super_admin        boolean NOT NULL DEFAULT false,  -- no UI ever sets this; promoted directly in DB
  must_change_password  boolean NOT NULL DEFAULT true,
  email                 text UNIQUE,           -- linked Google account, nullable
  is_deleted            boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE student_audit
  ADD CONSTRAINT student_audit_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES teachers(emp_id);

-- Login rate limiting — tracked per username, not globally.
CREATE TABLE login_attempts (
  username        text PRIMARY KEY,
  failed_count    integer NOT NULL DEFAULT 0,
  locked_until    timestamptz
);

-- Durable, non-evictable sessions. Never share this with any general-purpose cache.
CREATE TABLE sessions (
  session_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emp_id          uuid NOT NULL REFERENCES teachers(emp_id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL          -- explicit expiry baked into the row itself
);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

-- Which class+section+subject combos a teacher may enter marks for.
CREATE TABLE teacher_access (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emp_id      uuid NOT NULL REFERENCES teachers(emp_id) ON DELETE CASCADE,
  class       text NOT NULL,
  sec         text NOT NULL,
  subject     text NOT NULL,       -- internal key, e.g. 'Language' not 'Tamil'
  UNIQUE (emp_id, class, sec, subject)
);

-- ---------------------------------------------------------------------------
-- Exam configuration & marks
-- ---------------------------------------------------------------------------
CREATE TABLE exam_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id         uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  class           text NOT NULL,
  subject         text NOT NULL,       -- internal key
  max_theory      numeric NOT NULL DEFAULT 0,
  pass_theory     numeric NOT NULL DEFAULT 0,
  max_internal    numeric NOT NULL DEFAULT 0,
  pass_internal   numeric NOT NULL DEFAULT 0,
  max_practical   numeric NOT NULL DEFAULT 0,
  pass_practical  numeric NOT NULL DEFAULT 0,
  UNIQUE (exam_id, class, subject)
);

CREATE TABLE marks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id         uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  class           text NOT NULL,
  sec             text NOT NULL,
  subject         text NOT NULL,
  student_id      uuid NOT NULL REFERENCES students(student_id),
  theory          numeric,
  internal        numeric,
  practical       numeric,
  is_absent       boolean NOT NULL DEFAULT false,
  updated_by      uuid REFERENCES teachers(emp_id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, class, sec, subject, student_id)
);
CREATE INDEX marks_lookup ON marks (exam_id, class, sec, subject);

-- Per exam+class+section+subject. Locked = read-only for everyone, including admins.
CREATE TABLE locks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id         uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  class           text NOT NULL,
  sec             text NOT NULL,
  subject         text NOT NULL,
  locked          boolean NOT NULL DEFAULT false,
  locked_by       uuid REFERENCES teachers(emp_id),
  locked_at       timestamptz,
  UNIQUE (exam_id, class, sec, subject)
);

-- ---------------------------------------------------------------------------
-- Settings & display config
-- ---------------------------------------------------------------------------
CREATE TABLE school_settings (
  id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),   -- single global row
  block           text,
  udise_code      text,
  school_name     text,
  school_type     text,
  phone           text,
  academic_year_id uuid REFERENCES academic_years(id)
);

CREATE TABLE subject_order (
  class     text NOT NULL,
  sec       text NOT NULL,
  order_json jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (class, sec)
);

CREATE TABLE section_settings (
  class         text NOT NULL,
  sec           text NOT NULL,
  medium        text CHECK (medium IN ('T/M','E/M')),
  type          text CHECK (type IN ('Aided','Self-Finance')),
  has_practical boolean,
  PRIMARY KEY (class, sec)
);

CREATE TABLE section_order (
  key         text PRIMARY KEY DEFAULT 'global',
  order_json  jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE rank_card_design (
  key         text PRIMARY KEY DEFAULT 'global',
  design_json jsonb NOT NULL DEFAULT '{}'
);
