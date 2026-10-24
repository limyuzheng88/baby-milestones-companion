-- Phase 1 schema. Columns ending in _enc hold AES-GCM ciphertext (src/security/crypto.ts).

CREATE TABLE members (
  telegram_user_id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  chat_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_enc TEXT NOT NULL,
  pronoun TEXT NOT NULL CHECK (pronoun IN ('she', 'he', 'they')),
  birth_date TEXT,
  due_date TEXT,
  use_corrected_age INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  band_start_months INTEGER NOT NULL,
  band_end_months INTEGER NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('movement', 'communication', 'social', 'thinking')),
  wording TEXT NOT NULL,
  tip TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('HPB', 'CDC', 'WHO')),
  source_url TEXT NOT NULL,
  library_version TEXT NOT NULL
);

CREATE TABLE milestone_status (
  child_id INTEGER NOT NULL,
  milestone_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('yes', 'not_yet', 'not_sure')),
  achieved_on TEXT,
  answered_by INTEGER NOT NULL,
  answered_at TEXT NOT NULL,
  follow_up_sent INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, milestone_id)
);

CREATE TABLE milestone_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL,
  milestone_id TEXT NOT NULL,
  note_enc TEXT NOT NULL,
  added_by INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE checkups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  place_enc TEXT,
  notes_enc TEXT
);

CREATE TABLE sent_log (
  kind TEXT NOT NULL,
  child_id INTEGER NOT NULL,
  ref TEXT NOT NULL,
  sent_on TEXT NOT NULL,
  PRIMARY KEY (kind, child_id, ref)
);

-- Maps a sent check-in message to its milestone so Telegram replies can be matched.
CREATE TABLE message_refs (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  child_id INTEGER NOT NULL,
  milestone_id TEXT NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);

CREATE TABLE settings (
  key TEXT NOT NULL,
  child_id INTEGER NOT NULL DEFAULT 0,
  value_json TEXT NOT NULL,
  updated_by INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (key, child_id)
);

CREATE TABLE processed_updates (
  update_id INTEGER PRIMARY KEY,
  at TEXT NOT NULL
);

CREATE TABLE ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL
);

CREATE TABLE pending_input (
  telegram_user_id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
