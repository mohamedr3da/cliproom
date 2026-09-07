export const collectionSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
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
    deleted_at TEXT,
    deleted_by_member_id TEXT,
    FOREIGN KEY (created_by) REFERENCES members(id),
    FOREIGN KEY (deleted_by_member_id) REFERENCES members(id),
    FOREIGN KEY (assignee_member_id) REFERENCES members(id)
  )`,
  `CREATE TABLE IF NOT EXISTS collection_clips (
    collection_id TEXT NOT NULL,
    clip_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (collection_id, clip_id),
    UNIQUE (clip_id),
    UNIQUE (collection_id, position),
    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
    FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_collections_queue
    ON collections (priority DESC, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_collections_category
    ON collections (category, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_collection_clips_collection_position
    ON collection_clips (collection_id, position)`,
];

export const auditSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    actor_member_id TEXT,
    actor_username TEXT NOT NULL,
    actor_role TEXT CHECK (actor_role IN ('Admin', 'Clipper')),
    target_kind TEXT NOT NULL CHECK (target_kind IN ('clip', 'collection', 'member', 'room')),
    target_id TEXT,
    target_title TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (actor_member_id) REFERENCES members(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON audit_logs (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_target
    ON audit_logs (target_kind, target_id, created_at DESC)`,
  `CREATE TRIGGER IF NOT EXISTS audit_logs_prune_after_insert
    AFTER INSERT ON audit_logs
    BEGIN
      DELETE FROM audit_logs
      WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days');
    END`,
];

export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    twitch_user_id TEXT,
    twitch_login TEXT,
    twitch_display_name TEXT,
    twitch_avatar_url TEXT,
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
  `CREATE TABLE IF NOT EXISTS member_invite_codes (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    code_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    created_by TEXT,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES members(id)
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_states (
    id TEXT PRIMARY KEY,
    state_hash TEXT NOT NULL UNIQUE,
    bootstrap INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('social', 'news', 'gameplay', 'other')),
    intake_source TEXT NOT NULL DEFAULT 'manual' CHECK (intake_source IN ('manual', 'trusted_sync')),
    twitch_creator_login TEXT,
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
    deleted_at TEXT,
    deleted_by_member_id TEXT,
    FOREIGN KEY (created_by) REFERENCES members(id),
    FOREIGN KEY (deleted_by_member_id) REFERENCES members(id),
    FOREIGN KEY (assignee_member_id) REFERENCES members(id)
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_members_username_status ON members (username, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_members_twitch_user_id
    ON members (twitch_user_id) WHERE twitch_user_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_members_twitch_login_status
    ON members (twitch_login, status)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_hash_expires ON sessions (session_hash, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_oauth_states_hash_expires ON oauth_states (state_hash, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_member_invite_codes_member
    ON member_invite_codes (member_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_member_invite_codes_hash ON member_invite_codes (code_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_clips_queue
    ON clips (priority DESC, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_clips_category ON clips (category, created_at DESC)`,
  ...collectionSchemaStatements,
  ...auditSchemaStatements,
];
