-- V3.0 Migration: Add referral system + email tracking

-- Add referral columns to submissions
ALTER TABLE submissions ADD COLUMN referral_code TEXT;
ALTER TABLE submissions ADD COLUMN referred_by TEXT;

-- Referrals tracking table
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inviter_code TEXT NOT NULL,
  inviter_name TEXT,
  inviter_archetype TEXT,
  invitee_code TEXT,
  invitee_name TEXT,
  invitee_archetype TEXT,
  compatibility_score INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_ref_inviter ON referrals(inviter_code);

-- Email sends tracking (rate limiting)
CREATE TABLE IF NOT EXISTS email_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_sends ON email_sends(email, sent_at);
