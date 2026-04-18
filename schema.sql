-- Soul Map D1 Database Schema
DROP TABLE IF EXISTS submissions;

CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  name TEXT NOT NULL,
  age INTEGER,
  gender TEXT,
  email TEXT,
  archetype_code TEXT NOT NULL,
  display_code TEXT,
  poetic_name TEXT,
  rarity_tier TEXT,
  rarity_pct INTEGER,
  scores_json TEXT,
  intensities_json TEXT,
  i_score INTEGER,
  hesitations INTEGER,
  resonances INTEGER,
  user_agent TEXT,
  referrer TEXT
);

-- Index for analytics queries
CREATE INDEX idx_archetype ON submissions(archetype_code);
CREATE INDEX idx_display_code ON submissions(display_code);
CREATE INDEX idx_created ON submissions(created_at);

-- Archetype count cache (for real-time rarity display)
DROP TABLE IF EXISTS archetype_counts;
CREATE TABLE archetype_counts (
  display_code TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0
);

-- Pre-populate 16 archetypes
INSERT INTO archetype_counts (display_code, count) VALUES
  ('OREI', 0), ('ORSI', 0), ('OREW', 0), ('ORSW', 0),
  ('FREI', 0), ('FRSI', 0), ('FREW', 0), ('FRSW', 0),
  ('OVEI', 0), ('OVSI', 0), ('OVEW', 0), ('OVSW', 0),
  ('FVEI', 0), ('FVSI', 0), ('FVEW', 0), ('FVSW', 0);

-- V5.0: leads table for early lead capture + progress tracking
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  referred_by TEXT,
  status TEXT NOT NULL DEFAULT 'started',
  progress INTEGER NOT NULL DEFAULT 0,
  partial_scores TEXT,
  archetype_code TEXT,
  display_code TEXT,
  poetic_name TEXT,
  ip_hint TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  reminded_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_leads_session ON leads(session_id);
