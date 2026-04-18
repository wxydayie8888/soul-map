-- V5.0: leads table for early lead capture + progress tracking
-- Captures email+name at Q1 (not Q40), tracks partial progress, supports session resume

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  referred_by TEXT,
  status TEXT NOT NULL DEFAULT 'started',  -- started | q10 | q20 | q30 | completed | emailed
  progress INTEGER NOT NULL DEFAULT 0,     -- 0-40
  partial_scores TEXT,                     -- JSON snapshot of scores every 10Q
  archetype_code TEXT,
  display_code TEXT,
  poetic_name TEXT,
  ip_hint TEXT,                            -- coarse dedup, not for tracking
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  reminded_at INTEGER                      -- placeholder for future cron
);

CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_leads_session ON leads(session_id);
