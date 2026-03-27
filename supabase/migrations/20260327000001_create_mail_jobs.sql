-- supabase/migrations/20260327000001_create_mail_jobs.sql
CREATE TABLE mail_jobs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  subject          TEXT        NOT NULL,
  body             TEXT        NOT NULL,
  recipients       TEXT[]      NOT NULL DEFAULT '{}',
  sender           TEXT        NOT NULL CHECK (sender IN ('gmail', 'ms')),
  interval_minutes INTEGER     NOT NULL CHECK (interval_minutes >= 1),
  is_active        BOOLEAN     NOT NULL DEFAULT false,
  last_sent_at     TIMESTAMPTZ,
  send_count       INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
