-- V6.0 Migration: Meaning-discovery layer (Act II + Act III)
-- Adds value clarification (ACT Bull's-Eye), signature strengths (VIA),
-- Best Possible Self text, persistent magic-token link, and weekly commitments.
--
-- Pure additive: no existing column changed, no row touched. Safe to run on live.

-- Act II artifacts persisted on the lead (one row per email/session)
ALTER TABLE leads ADD COLUMN values_json TEXT;     -- {core: ["责任","原则",...], domains: {修身:4, 齐家:2, 处世:3, 闲居:5}}
ALTER TABLE leads ADD COLUMN strengths_json TEXT;  -- ["笃行","明辨","慎独"] (3 chosen from archetype's 6 candidates)
ALTER TABLE leads ADD COLUMN bps_text TEXT;        -- Best Possible Self free-write (work / relationships / inner)
ALTER TABLE leads ADD COLUMN magic_token TEXT;     -- /me?token= persistent return link (V2)

CREATE INDEX IF NOT EXISTS idx_leads_token ON leads(magic_token);

-- Act III: weekly commitments + reflections
CREATE TABLE IF NOT EXISTS commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  email TEXT NOT NULL,
  archetype_code TEXT NOT NULL,
  week_start INTEGER NOT NULL,        -- unix ts of Monday 00:00 Beijing for this week
  practice_text TEXT NOT NULL,        -- the chosen seed (from archetype.practices or custom)
  smart_when TEXT,                    -- 什么时候做 (e.g. "每天通勤路上")
  smart_freq TEXT,                    -- 多久一次 (e.g. "5天/周")
  smart_signal TEXT,                  -- 怎么知道做到了 (e.g. "记一句话在备忘录")
  status TEXT NOT NULL DEFAULT 'active',  -- active | done | skipped | replaced
  reflection_text TEXT,               -- user's weekly reflection back
  created_at INTEGER NOT NULL,
  reminded_at INTEGER,                -- next cron-fire time; cleared when reflected
  reflected_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_commit_email ON commitments(email, week_start);
CREATE INDEX IF NOT EXISTS idx_commit_remind ON commitments(status, reminded_at);
