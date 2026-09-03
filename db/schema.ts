export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('Admin', 'Clipper')),
    status TEXT NOT NULL DEFAULT 'active',
    invite_code_hash TEXT,
    invited_by TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    session_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('social', 'news', 'gameplay', 'other')),
    status TEXT NOT NULL CHECK (status IN ('New', 'Prioritised', 'Claimed', 'Editing', 'Posted')),
    priority INTEGER NOT NULL DEFAULT 0,
    assignee TEXT NOT NULL DEFAULT 'Unclaimed',
    assignee_member_id TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by TEXT,
    claimed_at TEXT,
    posted_at TEXT,
    FOREIGN KEY (created_by) REFERENCES members(id),
    FOREIGN KEY (assignee_member_id) REFERENCES members(id)
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_members_email_status
    ON members (email, status)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_hash_expires
    ON sessions (session_hash, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_clips_queue
    ON clips (priority DESC, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_clips_category
    ON clips (category, created_at DESC)`,
];
