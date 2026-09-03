import type { Category, ClipStatus } from "@/lib/cliproom/shared";

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

export type SeedClip = {
  id: string;
  url: string;
  title: string;
  category: Category;
  status: ClipStatus;
  priority: boolean;
  assignee: string;
  notes: string;
  createdAt: string;
  claimedAt?: string | null;
  postedAt?: string | null;
};

export const seedClips: SeedClip[] = [
  {
    id: "rawdogmoon-brainy-bold-swan",
    url: "https://www.twitch.tv/rawdogmoon/clip/BrainyBoldSwanANELE-KvDAGOwztNAVPYGB",
    title:
      "Rawdogmoon & aishahsofey get interviewed by a nightcrawler after getting swatted",
    category: "other",
    status: "Prioritised",
    priority: true,
    assignee: "Unclaimed",
    notes: "prioritise this",
    createdAt: "2026-09-03T05:37:00.000Z",
  },
  {
    id: "rawdogmoon-determined-aggressive-donut",
    url: "https://www.twitch.tv/rawdogmoon/clip/DeterminedAggressiveDonutAllenHuhu-YcG0TUYXbY_CIPwi",
    title: "rdm test clip 9",
    category: "gameplay",
    status: "New",
    priority: false,
    assignee: "Unclaimed",
    notes: "rdm AURA ace or some shit idk sob",
    createdAt: "2026-09-03T05:36:00.000Z",
  },
  {
    id: "rawdogmoon-witty-rocky-rutabaga",
    url: "https://www.twitch.tv/rawdogmoon/clip/WittyRockyRutabagaImGlitch-7R_uDIfLBnBbt_ch",
    title: "rdm test clip 2",
    category: "social",
    status: "Claimed",
    priority: false,
    assignee: "Assigned",
    notes: "note for editor 1",
    createdAt: "2026-09-03T05:34:00.000Z",
    claimedAt: "2026-09-03T05:34:00.000Z",
  },
];
