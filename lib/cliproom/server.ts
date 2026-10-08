import { env } from "cloudflare:workers";
import { mergeKickMetadata, parseKickChannelClipMetadata, parseKickMetadata } from "@/lib/cliproom/kick-playback";

import { auditSchemaStatements, collectionSchemaStatements, savedTaskSchemaStatements, schemaStatements } from "@/db/schema";
import {
  buildPermanentDeleteStatements,
  buildRetentionStatements,
  buildRestoreStatements,
  buildSoftDeleteStatements,
} from "@/lib/cliproom/retention";
import type { RetentionStatement } from "@/lib/cliproom/retention";
import {
  auditLogRetentionDays,
  cleanClipTitle,
  defaultChannel,
  getKickChannelSlug,
  getKickClipId,
  getTwitchClipSlug,
  getTwitchOAuthRedirectUri,
  isCategory,
  isRole,
  isSupportedClipUrl,
  isValidTwitchLogin,
  maxClipNotesLength,
  maxClipTitleLength,
  maxClipUrlLength,
  maxCollectionNotesLength,
  maxCollectionTitleLength,
  maxMembers,
  maxTrustedClippers,
  maxTrustedClippersTextLength,
  normaliseTaskNotes,
  normaliseTaskTitle,
  normaliseTwitchLogin,
  parseTwitchLogins,
  supportedClipUrlsMatch,
  twitchClipUrlsMatch,
} from "@/lib/cliproom/shared";
import type {
  AuthStatus,
  Category,
  Clip,
  ClipIntakeSource,
  ClipStatus,
  Collection,
  CurrentMember,
  Member,
  MemberRole,
  AuditLogEntry,
  AuditLogResponse,
  RoomMutation,
  RoomState,
} from "@/lib/cliproom/shared";

const sessionDays = 14;
const maxSessionsPerMember = 8;
const oauthStateMinutes = 10;
const trustedClipperSettingKey = "trusted_clipper_logins";
const lastTwitchSyncSettingKey = "last_twitch_sync_at";
const firstTwitchSyncWindowHours = 24;
const schemaVersionSettingKey = "_cliproom_schema_version";
const currentSchemaVersion = "twitch-auth-v1";
const collectionsSchemaVersionSettingKey = "_cliproom_collections_schema_version";
const currentCollectionsSchemaVersion = "collections-v1";
const retentionSchemaVersionSettingKey = "_cliproom_retention_schema_version";
const currentRetentionSchemaVersion = "retention-v2";
const auditSchemaVersionSettingKey = "_cliproom_audit_schema_version";
const currentAuditSchemaVersion = "audit-v2";
const savedSchemaVersionSettingKey = "_cliproom_saved_schema_version";
const currentSavedSchemaVersion = "saved-v1";
const firstAdminClaimSettingKey = "_cliproom_first_admin_claim";
const twitchSyncRoomCooldownMs = 5 * 1000;
const twitchSyncMemberCooldownMs = 5 * 1000;
const twitchSyncRoomRateKey = "_cliproom_twitch_sync_room_rate";
const twitchSyncMemberRatePrefix = "_cliproom_twitch_sync_member_rate:";
const presenceHeartbeatMs = 2 * 60 * 1000;
const onlineWindowMs = 5 * 60 * 1000;
const encoder = new TextEncoder();
let databaseReadyPromise: Promise<void> | null = null;
let cachedAppToken: { token: string; expiresAt: number } | null = null;

type RateLimitBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

type ClipRoomEnv = {
  DB?: D1Database;
  CLIPROOM_ADMIN_CODE?: string;
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  AUTH_RATE_LIMITER?: RateLimitBinding;
  API_RATE_LIMITER?: RateLimitBinding;
  TWITCH_RATE_LIMITER?: RateLimitBinding;
};

type D1CountRow = { count: number };
type D1TableInfoRow = { name: string };

type D1MemberRow = {
  id: string;
  username: string;
  twitch_user_id: string | null;
  twitch_login: string | null;
  twitch_display_name: string | null;
  twitch_avatar_url: string | null;
  role: MemberRole;
  status: string;
  invite_code_hash: string | null;
  created_at: string;
  last_seen_at: string | null;
};

type D1ClipRow = {
  id: string;
  url: string;
  title: string;
  category: Category;
  intake_source?: ClipIntakeSource | null;
  twitch_creator_login?: string | null;
  status: ClipStatus;
  priority: number;
  saved?: number | boolean | null;
  assignee: string;
  assignee_member_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  created_by_display_name?: string | null;
  claimed_at: string | null;
  posted_at: string | null;
  deleted_at: string | null;
  deleted_by_member_id?: string | null;
  deleted_by_username?: string | null;
};

type D1CollectionRow = {
  id: string;
  title: string;
  category: Category;
  status: ClipStatus;
  priority: number;
  saved?: number | boolean | null;
  assignee: string;
  assignee_member_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  created_by_display_name?: string | null;
  claimed_at: string | null;
  posted_at: string | null;
  deleted_at: string | null;
  deleted_by_member_id?: string | null;
  deleted_by_username?: string | null;
};

type D1CollectionClipRow = D1ClipRow & {
  collection_id: string;
  position: number;
};

type D1CollectionMembershipRow = {
  collection_id: string;
  clip_id: string;
  position: number;
};

type D1SessionRow = {
  id: string;
  member_id: string;
  session_hash: string;
  expires_at: string;
  member_status: string;
  twitch_user_id: string | null;
  twitch_login: string | null;
  twitch_display_name: string | null;
  twitch_avatar_url: string | null;
  role: MemberRole;
  last_seen_at: string | null;
};

type OAuthStateRow = {
  id: string;
  state_hash: string;
  bootstrap: number;
  expires_at: string;
};

type TwitchUser = {
  id: string;
  login: string;
  display_name: string;
  profile_image_url?: string;
};

type TwitchClip = {
  id: string;
  url: string;
  title: string;
  created_at: string;
  creator_id?: string;
  creator_name?: string;
};

type D1AuditLogRow = {
  id: string;
  action: string;
  actor_member_id: string | null;
  actor_username: string;
  actor_role: MemberRole | null;
  target_kind: "clip" | "collection" | "member" | "room";
  target_id: string | null;
  target_title: string | null;
  metadata: string | null;
  created_at: string;
};

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getBindings() {
  return env as unknown as ClipRoomEnv;
}

function getDatabase() {
  const db = getBindings().DB;
  if (!db) throw new HttpError(500, "ClipRoom storage is not connected yet.");
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function auditLogRetentionCutoff() {
  return new Date(Date.now() - auditLogRetentionDays * 24 * 60 * 60 * 1000).toISOString();
}

function randomToken(bytes = 32) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secureEqual(left: string, right: string) {
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function getRequestIsSecure(request: Request) {
  return new URL(request.url).protocol === "https:";
}

function sessionCookieName(request: Request) {
  return getRequestIsSecure(request) ? "__Host-cliproom_session" : "cliproom_session";
}

function oauthCookieName(request: Request) {
  return getRequestIsSecure(request) ? "__Host-cliproom_oauth_state" : "cliproom_oauth_state";
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function getSessionToken(request: Request) {
  return readCookie(request, sessionCookieName(request));
}

function makeCookie(name: string, value: string, request: Request, maxAge: number) {
  const secure = getRequestIsSecure(request) ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

function sessionCookie(token: string, request: Request) {
  return makeCookie(sessionCookieName(request), token, request, sessionDays * 24 * 60 * 60);
}

function expiredSessionCookie(request: Request) {
  return makeCookie(sessionCookieName(request), "", request, 0);
}

function oauthStateCookie(state: string, request: Request) {
  return makeCookie(oauthCookieName(request), state, request, oauthStateMinutes * 60);
}

export function expiredOauthCookie(request: Request) {
  return makeCookie(oauthCookieName(request), "", request, 0);
}

function visibleClipTitle(row: Pick<D1ClipRow, "title" | "url">) {
  const title = row.title.trim();
  if (!title || /^Untitled (Twitch|Kick) clip$/i.test(title)) return cleanClipTitle(row.url);
  return normaliseTaskTitle(title, cleanClipTitle(row.url), maxClipTitleLength);
}

function clipFromRow(row: D1ClipRow): Clip {
  return {
    id: row.id,
    url: row.url,
    title: visibleClipTitle(row),
    category: row.category,
    intakeSource: row.intake_source === "trusted_sync" ? "trusted_sync" : "manual",
    twitchCreatorLogin: row.twitch_creator_login ?? null,
    status: row.status,
    priority: Boolean(row.priority),
    saved: Boolean(row.saved),
    assignee: row.assignee,
    notes: normaliseTaskNotes(row.notes),
    createdBy: row.created_by_display_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    postedAt: row.posted_at,
    deletedAt: row.deleted_at ?? null,
    deletedBy: row.deleted_by_username ?? null,
  };
}

function collectionFromRow(row: D1CollectionRow, clips: Clip[]): Collection {
  return {
    id: row.id,
    title: normaliseTaskTitle(row.title, "Collection", maxCollectionTitleLength),
    category: row.category,
    status: row.status,
    priority: Boolean(row.priority),
    saved: Boolean(row.saved),
    assignee: row.assignee,
    notes: normaliseTaskNotes(row.notes),
    createdBy: row.created_by_display_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    postedAt: row.posted_at,
    deletedAt: row.deleted_at ?? null,
    deletedBy: row.deleted_by_username ?? null,
    clips,
  };
}

function memberFromRow(row: D1MemberRow): Member {
  const username = row.twitch_login ?? row.username;
  return {
    id: row.id,
    username,
    displayName: row.twitch_display_name || username,
    avatarUrl: row.twitch_avatar_url || null,
    role: row.role,
    addedAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function publicMemberFromSession(row: D1SessionRow): CurrentMember {
  const username = row.twitch_login ?? "unknown";
  return {
    id: row.member_id,
    username,
    displayName: row.twitch_display_name || username,
    avatarUrl: row.twitch_avatar_url || null,
    role: row.role,
  };
}

function memberDisplaySelect(tableAlias: string, memberColumn: string) {
  return `(SELECT COALESCE(NULLIF(m.twitch_display_name, ''), m.twitch_login, m.username) FROM members m WHERE m.id = ${tableAlias}.${memberColumn})`;
}

function auditLogFromRow(row: D1AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    action: row.action,
    actorUsername: row.actor_username,
    actorRole: row.actor_role,
    targetKind: row.target_kind,
    targetId: row.target_id,
    targetTitle: row.target_title,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

function auditLogStatement(
  db: D1Database,
  actor: CurrentMember,
  action: string,
  targetKind: D1AuditLogRow["target_kind"],
  targetId: string | null,
  targetTitle: string | null,
  metadata?: Record<string, unknown>,
) {
  return db
    .prepare(
      `INSERT INTO audit_logs (
        id, action, actor_member_id, actor_username, actor_role,
        target_kind, target_id, target_title, metadata, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      makeId("audit"),
      action,
      actor.id,
      actor.username,
      actor.role,
      targetKind,
      targetId,
      targetTitle,
      metadata ? JSON.stringify(metadata) : null,
      nowIso(),
    );
}

async function recordAuditLog(
  db: D1Database,
  actor: CurrentMember,
  action: string,
  targetKind: D1AuditLogRow["target_kind"],
  targetId: string | null,
  targetTitle: string | null,
  metadata?: Record<string, unknown>,
) {
  await auditLogStatement(db, actor, action, targetKind, targetId, targetTitle, metadata).run();
}

async function pruneExpiredAuditLogs(db: D1Database) {
  await db.prepare("DELETE FROM audit_logs WHERE created_at < ?").bind(auditLogRetentionCutoff()).run();
}

function twitchCurrentMember(row: D1MemberRow): CurrentMember {
  const username = row.twitch_login ?? row.username;
  return {
    id: row.id,
    username,
    displayName: row.twitch_display_name || username,
    avatarUrl: row.twitch_avatar_url || null,
    role: row.role,
  };
}

async function getSetting(db: D1Database, key: string) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setSetting(db: D1Database, key: string, value: string) {
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, timestamp)
    .run();
}

async function activeAdminCount(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM members
       WHERE role = 'Admin' AND status = 'active' AND twitch_user_id IS NOT NULL`,
    )
    .first<D1CountRow>();
  return row?.count ?? 0;
}

async function activeMemberCount(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM members
       WHERE status = 'active' AND twitch_user_id IS NOT NULL`,
    )
    .first<D1CountRow>();
  return row?.count ?? 0;
}

async function ensureLegacyUsernameSchema(db: D1Database) {
  const info = await db.prepare("PRAGMA table_info(members)").all<D1TableInfoRow>();
  const columns = info.results ?? [];
  if (columns.length === 0 || columns.some((column) => column.name === "username")) return;
  if (!columns.some((column) => column.name === "email")) {
    throw new HttpError(500, "ClipRoom member storage needs a schema update.");
  }
  await db.prepare("ALTER TABLE members RENAME COLUMN email TO username").run();
  await db.prepare("DROP INDEX IF EXISTS idx_members_email_status").run();
}

async function ensureTwitchMemberColumns(db: D1Database) {
  const info = await db.prepare("PRAGMA table_info(members)").all<D1TableInfoRow>();
  const columns = new Set((info.results ?? []).map((column) => column.name));
  const additions: D1PreparedStatement[] = [];
  if (!columns.has("twitch_user_id")) additions.push(db.prepare("ALTER TABLE members ADD COLUMN twitch_user_id TEXT"));
  if (!columns.has("twitch_login")) additions.push(db.prepare("ALTER TABLE members ADD COLUMN twitch_login TEXT"));
  if (!columns.has("twitch_display_name")) additions.push(db.prepare("ALTER TABLE members ADD COLUMN twitch_display_name TEXT"));
  if (!columns.has("twitch_avatar_url")) additions.push(db.prepare("ALTER TABLE members ADD COLUMN twitch_avatar_url TEXT"));
  if (additions.length) await db.batch(additions);
}

async function ensureClipSourceColumns(db: D1Database) {
  const result = await db.prepare("PRAGMA table_info(clips)").all<D1TableInfoRow>();
  const columns = new Set((result.results ?? []).map((item) => item.name));
  const statements: D1PreparedStatement[] = [];
  if (!columns.has("intake_source")) {
    statements.push(db.prepare("ALTER TABLE clips ADD COLUMN intake_source TEXT NOT NULL DEFAULT 'manual'"));
  }
  if (!columns.has("twitch_creator_login")) {
    statements.push(db.prepare("ALTER TABLE clips ADD COLUMN twitch_creator_login TEXT"));
  }
  statements.push(
    db.prepare("CREATE INDEX IF NOT EXISTS idx_clips_intake_source ON clips (intake_source, created_at DESC)"),
  );
  await db.batch(statements);
}

async function runSchemaStatements(
  db: D1Database,
  shouldRun: (statement: string) => boolean = () => true,
) {
  const statements = schemaStatements
    .filter(shouldRun)
    .map((statement) => db.prepare(statement));
  if (statements.length) await db.batch(statements);
}

function isCreateTableStatement(statement: string) {
  return statement.trimStart().toUpperCase().startsWith("CREATE TABLE");
}

async function initialiseDatabase(db: D1Database) {
  try {
    if ((await getSetting(db, schemaVersionSettingKey)) === currentSchemaVersion) return;
  } catch {
    // Fresh database; continue with bootstrap.
  }

  await ensureLegacyUsernameSchema(db);
  await runSchemaStatements(db, isCreateTableStatement);
  await ensureTwitchMemberColumns(db);
  await ensureClipSourceColumns(db);
  await runSchemaStatements(db);

  const timestamp = nowIso();
  await db.batch([
    db.prepare("DELETE FROM sessions"),
    db.prepare("DELETE FROM member_invite_codes"),
    db.prepare("UPDATE members SET invite_code_hash = NULL"),
    db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(timestamp),
    db.prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('source_channel', ?, ?)`).bind(defaultChannel, timestamp),
    db.prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, '[]', ?)`).bind(trustedClipperSettingKey, timestamp),
    db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(schemaVersionSettingKey, currentSchemaVersion, timestamp),
  ]);
}

async function ensureCollectionsSchema(db: D1Database) {
  if ((await getSetting(db, collectionsSchemaVersionSettingKey)) === currentCollectionsSchemaVersion) {
    return;
  }

  const statements = collectionSchemaStatements.map((statement) => db.prepare(statement));
  if (statements.length) await db.batch(statements);
  await setSetting(db, collectionsSchemaVersionSettingKey, currentCollectionsSchemaVersion);
}

async function ensureRetentionSchema(db: D1Database) {
  if ((await getSetting(db, retentionSchemaVersionSettingKey)) === currentRetentionSchemaVersion) return;

  for (const table of ["clips", "collections"] as const) {
    const columns = async () => {
      const info = await db.prepare(`PRAGMA table_info(${table})`).all<D1TableInfoRow>();
      return new Set((info.results ?? []).map((column) => column.name));
    };
    for (const [column, definition] of [
      ["deleted_at", "TEXT"],
      ["deleted_by_member_id", "TEXT"],
    ] as const) {
      if ((await columns()).has(column)) continue;
      try {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
      } catch (error) {
        // Another Worker may finish this additive migration during a cold start.
        if (!(await columns()).has(column)) throw error;
      }
    }
  }
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_clips_retention ON clips (deleted_at, status, posted_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_collections_retention ON collections (deleted_at, status, posted_at)"),
  ]);
  await setSetting(db, retentionSchemaVersionSettingKey, currentRetentionSchemaVersion);
}

async function ensureAuditSchema(db: D1Database) {
  if ((await getSetting(db, auditSchemaVersionSettingKey)) === currentAuditSchemaVersion) return;

  const statements = auditSchemaStatements.map((statement) => db.prepare(statement));
  if (statements.length) await db.batch(statements);
  await setSetting(db, auditSchemaVersionSettingKey, currentAuditSchemaVersion);
}

async function ensureSavedSchema(db: D1Database) {
  if ((await getSetting(db, savedSchemaVersionSettingKey)) === currentSavedSchemaVersion) return;

  const statements = savedTaskSchemaStatements.map((statement) => db.prepare(statement));
  if (statements.length) await db.batch(statements);
  await setSetting(db, savedSchemaVersionSettingKey, currentSavedSchemaVersion);
}

export async function ensureDatabase(db = getDatabase()) {
  if (!databaseReadyPromise) {
    databaseReadyPromise = (async () => {
      await initialiseDatabase(db);
      await ensureCollectionsSchema(db);
      await ensureRetentionSchema(db);
      await ensureAuditSchema(db);
      await ensureSavedSchema(db);
    })().catch((error) => {
      databaseReadyPromise = null;
      throw error;
    });
  }
  await databaseReadyPromise;
}

function securityHeaders(headers = new Headers()) {
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return headers;
}

export function jsonOk(payload: unknown, init?: ResponseInit) {
  const headers = securityHeaders(new Headers(init?.headers));
  return Response.json(payload, { ...init, headers });
}

export function jsonError(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json(
      { error: error.message },
      { status: error.status, headers: securityHeaders() },
    );
  }
  console.error(error);
  return Response.json(
    { error: "Something went wrong in ClipRoom." },
    { status: 500, headers: securityHeaders() },
  );
}

export function assertMutationRequest(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) throw new HttpError(403, "Cross-site request blocked.");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin && fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new HttpError(403, "Cross-site request blocked.");
  }
}

export async function readJson<T>(request: Request, maxBytes = 32_768): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > maxBytes) throw new HttpError(413, "Request is too large.");

  if (!request.body) return {} as T;

  const decoder = new TextDecoder();
  const reader = request.body.getReader();
  let received = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Request is too large.");
    }

    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  try {
    return JSON.parse(text || "{}") as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

async function requestFingerprint(request: Request) {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const ua = (request.headers.get("user-agent") || "unknown").slice(0, 160);
  return (await sha256(`${ip}|${ua}`)).slice(0, 32);
}

async function applyRateLimit(binding: RateLimitBinding | undefined, key: string, message: string) {
  if (!binding) return;
  const result = await binding.limit({ key });
  if (!result.success) throw new HttpError(429, message);
}

async function rateLimitAuth(request: Request, route: string) {
  await applyRateLimit(
    getBindings().AUTH_RATE_LIMITER,
    `${route}:${await requestFingerprint(request)}`,
    "Too many login attempts. Try again in a minute.",
  );
}

async function rateLimitSession(sessionHash: string) {
  await applyRateLimit(
    getBindings().API_RATE_LIMITER,
    `session:${sessionHash.slice(0, 32)}`,
    "Too many requests. Try again shortly.",
  );
}

async function rateLimitTwitch(memberId: string) {
  await applyRateLimit(
    getBindings().TWITCH_RATE_LIMITER,
    `member:${memberId}`,
    "Too many Twitch actions. Try again in a minute.",
  );
}

function cooldownSecondsRemaining(lastValue: string | null, now: number, cooldownMs: number) {
  if (!lastValue) return 0;
  const lastTime = Date.parse(lastValue);
  if (Number.isNaN(lastTime)) return 0;
  return Math.max(0, Math.ceil((cooldownMs - (now - lastTime)) / 1000));
}

async function rateLimitTwitchSync(db: D1Database, memberId: string) {
  const now = Date.now();
  const memberKey = `${twitchSyncMemberRatePrefix}${memberId}`;
  const [lastMemberSync, lastRoomSync] = await Promise.all([
    getSetting(db, memberKey),
    getSetting(db, twitchSyncRoomRateKey),
  ]);

  const memberWait = cooldownSecondsRemaining(
    lastMemberSync,
    now,
    twitchSyncMemberCooldownMs,
  );
  if (memberWait > 0) {
    throw new HttpError(429, `You can sync Twitch clips every 5 seconds. Try again in ${memberWait} seconds.`);
  }

  const roomWait = cooldownSecondsRemaining(
    lastRoomSync,
    now,
    twitchSyncRoomCooldownMs,
  );
  if (roomWait > 0) {
    throw new HttpError(429, `Twitch sync just ran. Try again in ${roomWait} seconds.`);
  }
}

async function markTwitchSyncCooldown(db: D1Database, memberId: string) {
  const timestamp = new Date().toISOString();
  await Promise.all([
    setSetting(db, `${twitchSyncMemberRatePrefix}${memberId}`, timestamp),
    setSetting(db, twitchSyncRoomRateKey, timestamp),
  ]);
}

async function hashSessionToken(token: string) {
  return sha256(`cliproom:session:${token}`);
}

async function createSession(member: CurrentMember, request: Request) {
  const db = getDatabase();
  const token = randomToken(32);
  const sessionHash = await hashSessionToken(token);
  const timestamp = nowIso();
  const sessionId = makeId("ses");

  await db.batch([
    db
      .prepare(
        `INSERT INTO sessions (id, member_id, session_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(sessionId, member.id, sessionHash, timestamp, daysFromNow(sessionDays)),
    db.prepare("UPDATE members SET last_seen_at = ? WHERE id = ?").bind(timestamp, member.id),
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(timestamp),
  ]);

  await db
    .prepare(
      `DELETE FROM sessions
       WHERE member_id = ? AND id NOT IN (
         SELECT id FROM sessions WHERE member_id = ? ORDER BY created_at DESC LIMIT ?
       )`,
    )
    .bind(member.id, member.id, maxSessionsPerMember)
    .run();

  return sessionCookie(token, request);
}

export async function destroyCurrentSession(request: Request) {
  assertMutationRequest(request);
  const token = getSessionToken(request);
  if (token) {
    const db = getDatabase();
    await ensureDatabase(db);
    const hash = await hashSessionToken(token);
    await db.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(hash).run();
  }
  return expiredSessionCookie(request);
}

export async function getCurrentMember(request: Request) {
  const token = getSessionToken(request);
  if (!token) return null;

  const sessionHash = await hashSessionToken(token);
  await rateLimitSession(sessionHash);
  const db = getDatabase();
  await ensureDatabase(db);

  const row = await db
    .prepare(
      `SELECT sessions.id, sessions.member_id, sessions.session_hash, sessions.expires_at,
        members.status AS member_status, members.twitch_user_id, members.twitch_login,
        members.twitch_display_name, members.twitch_avatar_url, members.role, members.last_seen_at
       FROM sessions JOIN members ON members.id = sessions.member_id
       WHERE sessions.session_hash = ?`,
    )
    .bind(sessionHash)
    .first<D1SessionRow>();

  if (
    !row ||
    row.expires_at <= nowIso() ||
    row.member_status !== "active" ||
    !row.twitch_user_id ||
    !row.twitch_login
  ) {
    await db.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(sessionHash).run();
    return null;
  }

  const lastSeen = row.last_seen_at ? Date.parse(row.last_seen_at) : 0;
  if (!lastSeen || Date.now() - lastSeen > presenceHeartbeatMs) {
    await db.prepare("UPDATE members SET last_seen_at = ? WHERE id = ?").bind(nowIso(), row.member_id).run();
  }

  return publicMemberFromSession(row);
}

export async function requireMember(request: Request) {
  const member = await getCurrentMember(request);
  if (!member) throw new HttpError(401, "Sign in with Twitch to enter ClipRoom.");
  return member;
}

function requireAdmin(member: CurrentMember) {
  if (member.role !== "Admin") throw new HttpError(403, "Only admins can do that.");
}

function twitchConfigured() {
  const bindings = getBindings();
  return Boolean(bindings.TWITCH_CLIENT_ID && bindings.TWITCH_CLIENT_SECRET);
}

export async function getAuthStatus(request?: Request): Promise<AuthStatus> {
  if (request) await rateLimitAuth(request, "status");
  const db = getDatabase();
  await ensureDatabase(db);
  return {
    configured: twitchConfigured(),
    needsSetup: (await activeAdminCount(db)) === 0,
  };
}

function twitchRedirectUri(request: Request) {
  return getTwitchOAuthRedirectUri(request.url);
}

export async function beginTwitchAuth(request: Request, input: { setupCode?: unknown }) {
  assertMutationRequest(request);
  await rateLimitAuth(request, "start");
  if (!twitchConfigured()) throw new HttpError(503, "Twitch login is not configured yet.");

  const db = getDatabase();
  await ensureDatabase(db);
  const needsSetup = (await activeAdminCount(db)) === 0;
  let bootstrap = 0;

  if (needsSetup) {
    const supplied = typeof input.setupCode === "string" ? input.setupCode.trim() : "";
    const expected = getBindings().CLIPROOM_ADMIN_CODE?.trim() ?? "";
    if (!supplied || !expected || !(await secureEqual(supplied, expected))) {
      throw new HttpError(403, "The first admin setup code is required.");
    }
    bootstrap = 1;
  }

  const state = randomToken(32);
  const stateHash = await sha256(`cliproom:oauth:${state}`);
  const timestamp = nowIso();
  await db.batch([
    db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(timestamp),
    db
      .prepare(
        `INSERT INTO oauth_states (id, state_hash, bootstrap, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(makeId("oauth"), stateHash, bootstrap, timestamp, minutesFromNow(oauthStateMinutes)),
  ]);

  const params = new URLSearchParams({
    client_id: getBindings().TWITCH_CLIENT_ID ?? "",
    redirect_uri: twitchRedirectUri(request),
    response_type: "code",
    state,
    scope: "openid",
  });

  return {
    authorizationUrl: `https://id.twitch.tv/oauth2/authorize?${params.toString()}`,
    cookie: oauthStateCookie(state, request),
  };
}

async function exchangeTwitchCode(request: Request, code: string) {
  const bindings = getBindings();
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: bindings.TWITCH_CLIENT_ID ?? "",
      client_secret: bindings.TWITCH_CLIENT_SECRET ?? "",
      code,
      grant_type: "authorization_code",
      redirect_uri: twitchRedirectUri(request),
    }),
  });
  if (!response.ok) throw new HttpError(502, "Twitch login could not be completed.");
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new HttpError(502, "Twitch login could not be completed.");
  return data.access_token;
}

async function fetchCurrentTwitchUser(accessToken: string) {
  const response = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": getBindings().TWITCH_CLIENT_ID ?? "",
    },
  });
  if (!response.ok) throw new HttpError(502, "Twitch account details could not be loaded.");
  const data = (await response.json()) as { data?: TwitchUser[] };
  const user = data.data?.[0];
  if (!user?.id || !user.login) throw new HttpError(502, "Twitch account details could not be loaded.");
  return user;
}

async function revokeTwitchToken(accessToken: string) {
  try {
    await fetch("https://id.twitch.tv/oauth2/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: getBindings().TWITCH_CLIENT_ID ?? "",
        token: accessToken,
      }),
    });
  } catch {
    // Best-effort cleanup. ClipRoom never stores the Twitch token.
  }
}

function internalUsernameForTwitch(twitchUserId: string) {
  return `twitch_${twitchUserId}`;
}

async function findLinkableLegacyMember(db: D1Database, twitchUser: TwitchUser) {
  return db
    .prepare(
      `SELECT * FROM members
       WHERE twitch_user_id IS NULL AND lower(username) = ?
       ORDER BY created_at ASC LIMIT 1`,
    )
    .bind(normaliseTwitchLogin(twitchUser.login))
    .first<D1MemberRow>();
}

async function upsertTwitchIdentity(
  db: D1Database,
  twitchUser: TwitchUser,
  role: MemberRole,
  invitedBy: string | null,
  forceAdminBootstrap = false,
) {
  let row = await db
    .prepare("SELECT * FROM members WHERE twitch_user_id = ?")
    .bind(twitchUser.id)
    .first<D1MemberRow>();

  if (!row) row = await findLinkableLegacyMember(db, twitchUser);

  const timestamp = nowIso();
  if (row) {
    const nextRole = forceAdminBootstrap ? "Admin" : role;
    await db
      .prepare(
        `UPDATE members SET twitch_user_id = ?, twitch_login = ?, twitch_display_name = ?,
          twitch_avatar_url = ?, role = ?, status = 'active', invite_code_hash = NULL,
          invited_by = COALESCE(?, invited_by), last_seen_at = COALESCE(last_seen_at, ?)
         WHERE id = ?`,
      )
      .bind(
        twitchUser.id,
        normaliseTwitchLogin(twitchUser.login),
        twitchUser.display_name || twitchUser.login,
        twitchUser.profile_image_url || null,
        nextRole,
        invitedBy,
        timestamp,
        row.id,
      )
      .run();
  } else {
    const id = makeId("mem");
    await db
      .prepare(
        `INSERT INTO members (
          id, username, twitch_user_id, twitch_login, twitch_display_name, twitch_avatar_url,
          role, status, invite_code_hash, invited_by, created_at, last_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?)`,
      )
      .bind(
        id,
        internalUsernameForTwitch(twitchUser.id),
        twitchUser.id,
        normaliseTwitchLogin(twitchUser.login),
        twitchUser.display_name || twitchUser.login,
        twitchUser.profile_image_url || null,
        forceAdminBootstrap ? "Admin" : role,
        invitedBy,
        timestamp,
        timestamp,
      )
      .run();
  }

  return db
    .prepare("SELECT * FROM members WHERE twitch_user_id = ?")
    .bind(twitchUser.id)
    .first<D1MemberRow>();
}

async function claimFirstAdminBootstrap(db: D1Database, twitchUserId: string) {
  if ((await activeAdminCount(db)) > 0) {
    throw new HttpError(403, "The first admin has already been created.");
  }

  const timestamp = nowIso();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO settings (key, value, updated_at)
       VALUES (?, ?, ?)`,
    )
    .bind(firstAdminClaimSettingKey, twitchUserId, timestamp)
    .run();

  if (result.meta.changes) return true;

  const existingClaim = await getSetting(db, firstAdminClaimSettingKey);
  if (existingClaim === twitchUserId) return false;
  throw new HttpError(403, "The first admin has already been claimed.");
}

export async function completeTwitchAuth(request: Request) {
  await rateLimitAuth(request, "callback");
  if (!twitchConfigured()) throw new HttpError(503, "Twitch login is not configured yet.");

  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const returnedState = url.searchParams.get("state") ?? "";
  const cookieState = readCookie(request, oauthCookieName(request));
  if (!code || !returnedState || !cookieState || !(await secureEqual(returnedState, cookieState))) {
    throw new HttpError(401, "Twitch login expired or was not started from ClipRoom.");
  }

  const db = getDatabase();
  await ensureDatabase(db);
  const stateHash = await sha256(`cliproom:oauth:${returnedState}`);
  const stateRow = await db
    .prepare("SELECT * FROM oauth_states WHERE state_hash = ?")
    .bind(stateHash)
    .first<OAuthStateRow>();

  if (!stateRow || stateRow.expires_at <= nowIso()) {
    throw new HttpError(401, "Twitch login expired. Try again.");
  }
  const stateDelete = await db
    .prepare("DELETE FROM oauth_states WHERE id = ? AND state_hash = ?")
    .bind(stateRow.id, stateHash)
    .run();
  if (!stateDelete.meta.changes) {
    throw new HttpError(401, "Twitch login expired. Try again.");
  }

  const accessToken = await exchangeTwitchCode(request, code);
  let twitchUser: TwitchUser;
  try {
    twitchUser = await fetchCurrentTwitchUser(accessToken);
  } finally {
    await revokeTwitchToken(accessToken);
  }

  let memberRow = await db
    .prepare("SELECT * FROM members WHERE twitch_user_id = ? AND status = 'active'")
    .bind(twitchUser.id)
    .first<D1MemberRow>();

  if (stateRow.bootstrap) {
    const createdClaim = await claimFirstAdminBootstrap(db, twitchUser.id);
    try {
      memberRow = await upsertTwitchIdentity(db, twitchUser, "Admin", null, true);
    } catch (error) {
      if (createdClaim) {
        await db
          .prepare("DELETE FROM settings WHERE key = ? AND value = ?")
          .bind(firstAdminClaimSettingKey, twitchUser.id)
          .run();
      }
      throw error;
    }
  } else if (!memberRow) {
    throw new HttpError(403, "This Twitch account is not on the ClipRoom access list.");
  } else {
    await db
      .prepare(
        `UPDATE members SET twitch_login = ?, twitch_display_name = ?, twitch_avatar_url = ?
         WHERE id = ?`,
      )
      .bind(
        normaliseTwitchLogin(twitchUser.login),
        twitchUser.display_name || twitchUser.login,
        twitchUser.profile_image_url || null,
        memberRow.id,
      )
      .run();
    memberRow = await db.prepare("SELECT * FROM members WHERE id = ?").bind(memberRow.id).first<D1MemberRow>();
  }

  if (!memberRow) throw new HttpError(500, "ClipRoom could not create your session.");
  const member = twitchCurrentMember(memberRow);
  return {
    cookie: await createSession(member, request),
    oauthCookie: expiredOauthCookie(request),
  };
}

export function authErrorCode(error: unknown) {
  if (error instanceof HttpError) {
    if (error.status === 429) return "rate_limited";
    if (error.status === 403 && error.message.includes("not on")) return "not_invited";
    if (error.status === 403) return "setup_changed";
    if (error.status === 401) return "expired";
  }
  console.error(error);
  return "twitch_failed";
}

async function getTrustedClipperLogins(db: D1Database) {
  const rawValue = await getSetting(db, trustedClipperSettingKey);
  return trustedClipperLoginsFromSetting(rawValue);
}

function trustedClipperLoginsFromSetting(rawValue: string | null) {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (Array.isArray(parsed)) return parseTwitchLogins(parsed.filter((item) => typeof item === "string").join(","));
  } catch {
    return parseTwitchLogins(rawValue);
  }
  return [];
}

async function setTrustedClipperLogins(db: D1Database, logins: string[]) {
  await setSetting(db, trustedClipperSettingKey, JSON.stringify(logins));
}

function parseTrustedClipperInput(input: unknown) {
  if (typeof input === "undefined") return null;
  let logins: string[];
  if (typeof input === "string") {
    if (input.length > maxTrustedClippersTextLength) {
      throw new HttpError(400, `Trusted clippers must be ${maxTrustedClippersTextLength} characters or fewer.`);
    }
    logins = parseTwitchLogins(input);
  } else if (Array.isArray(input)) {
    logins = parseTwitchLogins(input.filter((item) => typeof item === "string").join(","));
  } else {
    throw new HttpError(400, "Trusted clippers must be Twitch usernames.");
  }

  if (logins.length > maxTrustedClippers) {
    throw new HttpError(400, `Add ${maxTrustedClippers} trusted Twitch clippers or fewer.`);
  }

  return logins;
}

function runRetentionStatements(db: D1Database, statements: RetentionStatement[]) {
  return db.batch(statements.map(({ sql, params }) => db.prepare(sql).bind(...params)));
}

export function wantsMutationResponse(request: Request) {
  return request.headers.get("X-ClipRoom-Mutation") === "1";
}

type TaskResponse<Compact extends boolean> = Compact extends true ? RoomMutation : RoomState;
type ChangedTasks = {
  clipIds?: string[];
  collectionIds?: string[];
  removedClipIds?: string[];
  removedCollectionIds?: string[];
};

async function taskResponse<Compact extends boolean>(
  actor: CurrentMember,
  db: D1Database,
  compact: Compact,
  changed: ChangedTasks,
): Promise<TaskResponse<Compact>> {
  if (!compact) return await getRoomState(actor) as TaskResponse<Compact>;

  const clips: Clip[] = [];
  const collections: Collection[] = [];
  const removedClipIds = new Set(changed.removedClipIds ?? []);
  const removedCollectionIds = new Set(changed.removedCollectionIds ?? []);
  await Promise.all([
    ...Array.from(new Set(changed.clipIds)).map(async (id) => {
      const row = await db.prepare(`SELECT clips.*,
        EXISTS (
          SELECT 1 FROM saved_tasks st
          WHERE st.member_id = ? AND st.target_kind = 'clip' AND st.target_id = clips.id
        ) AS saved,
        ${memberDisplaySelect("clips", "created_by")} AS created_by_display_name,
        ${memberDisplaySelect("clips", "deleted_by_member_id")} AS deleted_by_username
        FROM clips WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM collection_clips cc WHERE cc.clip_id = clips.id)`).bind(actor.id, id).first<D1ClipRow>();
      if (row) clips.push(clipFromRow(row));
      else removedClipIds.add(id);
    }),
    ...Array.from(new Set(changed.collectionIds)).map(async (id) => {
      const result = await db.batch([
        db.prepare(`SELECT collections.*,
          EXISTS (
            SELECT 1 FROM saved_tasks st
            WHERE st.member_id = ? AND st.target_kind = 'collection' AND st.target_id = collections.id
          ) AS saved,
          ${memberDisplaySelect("collections", "created_by")} AS created_by_display_name,
          ${memberDisplaySelect("collections", "deleted_by_member_id")} AS deleted_by_username
          FROM collections WHERE id = ?`).bind(actor.id, id),
        db.prepare(`SELECT clips.*,
          0 AS saved,
          ${memberDisplaySelect("clips", "created_by")} AS created_by_display_name,
          ${memberDisplaySelect("clips", "deleted_by_member_id")} AS deleted_by_username
          FROM collection_clips cc JOIN clips ON clips.id = cc.clip_id
          WHERE cc.collection_id = ? ORDER BY cc.position`).bind(id),
      ]);
      const row = result[0].results[0] as D1CollectionRow | undefined;
      if (row) collections.push(collectionFromRow(row, (result[1].results as D1ClipRow[]).map(clipFromRow)));
      else removedCollectionIds.add(id);
    }),
  ]);
  return {
    kind: "mutation",
    clips,
    collections,
    removedClipIds: Array.from(removedClipIds),
    removedCollectionIds: Array.from(removedCollectionIds),
  } as TaskResponse<Compact>;
}

export async function getRoomState(member: CurrentMember): Promise<RoomState> {
  const db = getDatabase();
  await ensureDatabase(db);
  await runRetentionStatements(db, buildRetentionStatements(nowIso()));
  const isAdmin = member.role === "Admin";
  const onlineSince = new Date(Date.now() - onlineWindowMs).toISOString();
  const statements = [
    db.prepare(`SELECT clips.*,
      EXISTS (
        SELECT 1 FROM saved_tasks st
        WHERE st.member_id = ? AND st.target_kind = 'clip' AND st.target_id = clips.id
      ) AS saved,
      ${memberDisplaySelect("clips", "created_by")} AS created_by_display_name,
      ${memberDisplaySelect("clips", "deleted_by_member_id")} AS deleted_by_username
      FROM clips WHERE NOT EXISTS (SELECT 1 FROM collection_clips cc WHERE cc.clip_id = clips.id)
      ORDER BY priority DESC, CASE status WHEN 'New' THEN 0 WHEN 'Prioritised' THEN 1 WHEN 'Claimed' THEN 2
      WHEN 'Editing' THEN 3 WHEN 'Posted' THEN 4 ELSE 5 END, created_at DESC`).bind(member.id),
    db.prepare(`SELECT collections.*,
      EXISTS (
        SELECT 1 FROM saved_tasks st
        WHERE st.member_id = ? AND st.target_kind = 'collection' AND st.target_id = collections.id
      ) AS saved,
      ${memberDisplaySelect("collections", "created_by")} AS created_by_display_name,
      ${memberDisplaySelect("collections", "deleted_by_member_id")} AS deleted_by_username
      FROM collections ORDER BY priority DESC, CASE status WHEN 'New' THEN 0 WHEN 'Prioritised' THEN 1 WHEN 'Claimed' THEN 2
      WHEN 'Editing' THEN 3 WHEN 'Posted' THEN 4 ELSE 5 END, created_at DESC`).bind(member.id),
    db.prepare(`SELECT cc.collection_id, cc.position, clips.*,
      0 AS saved,
      ${memberDisplaySelect("clips", "created_by")} AS created_by_display_name,
      ${memberDisplaySelect("clips", "deleted_by_member_id")} AS deleted_by_username
      FROM collection_clips cc
      JOIN clips ON clips.id = cc.clip_id ORDER BY cc.collection_id, cc.position`),
    db.prepare("SELECT key, value FROM settings WHERE key IN (?, ?)").bind("source_channel", trustedClipperSettingKey),
    db.prepare(`SELECT COUNT(*) AS member_count,
      COALESCE(SUM(CASE WHEN last_seen_at IS NOT NULL AND last_seen_at >= ? THEN 1 ELSE 0 END), 0) AS online_member_count
      FROM members WHERE status = 'active' AND twitch_user_id IS NOT NULL`).bind(onlineSince),
  ];
  if (isAdmin) statements.push(db.prepare(`SELECT * FROM members WHERE status = 'active' AND twitch_user_id IS NOT NULL
    ORDER BY CASE role WHEN 'Admin' THEN 0 ELSE 1 END, created_at ASC`));
  const rows = await db.batch(statements);
  const clipRows = rows[0].results as D1ClipRow[];
  const collectionRows = rows[1].results as D1CollectionRow[];
  const collectionClipRows = rows[2].results as D1CollectionClipRow[];
  const settings = new Map((rows[3].results as { key: string; value: string }[]).map((row) => [row.key, row.value]));
  const presenceRow = (rows[4].results[0] ?? { member_count: 0, online_member_count: 0 }) as {
    member_count: number;
    online_member_count: number;
  };
  const memberRows = isAdmin ? rows[5].results as D1MemberRow[] : [];
  const collectionClips = new Map<string, Clip[]>();
  for (const row of collectionClipRows) {
    const clips = collectionClips.get(row.collection_id) ?? [];
    clips.push(clipFromRow(row));
    collectionClips.set(row.collection_id, clips);
  }
  const deletedNewestFirst = (left: { deleted_at?: string | null }, right: { deleted_at?: string | null }) =>
    Date.parse(right.deleted_at ?? "") - Date.parse(left.deleted_at ?? "");
  return {
    member,
    clips: clipRows.filter((row) => !row.deleted_at).map(clipFromRow),
    collections: collectionRows.filter((row) => !row.deleted_at).map((row) => collectionFromRow(row, collectionClips.get(row.id) ?? [])),
    trash: {
      clips: clipRows.filter((row) => row.deleted_at).sort(deletedNewestFirst).map(clipFromRow),
      collections: collectionRows.filter((row) => row.deleted_at).sort(deletedNewestFirst)
        .map((row) => collectionFromRow(row, collectionClips.get(row.id) ?? [])),
    },
    members: memberRows.map(memberFromRow),
    sourceChannel: settings.get("source_channel") ?? defaultChannel,
    trustedClipperLogins: trustedClipperLoginsFromSetting(settings.get(trustedClipperSettingKey) ?? null),
    memberCount: Number(presenceRow.member_count) || 0,
    onlineMemberCount: Number(presenceRow.online_member_count) || 0,
    maxMembers,
    twitchSyncAvailable: twitchConfigured(),
  };
}

export async function getAuditLogs(actor: CurrentMember, rawLimit: unknown = 100): Promise<AuditLogResponse> {
  requireAdmin(actor);
  const numericLimit =
    typeof rawLimit === "string" || typeof rawLimit === "number"
      ? Number(rawLimit)
      : 100;
  const limit = Number.isFinite(numericLimit)
    ? Math.min(200, Math.max(1, Math.floor(numericLimit)))
    : 100;

  const db = getDatabase();
  await ensureDatabase(db);
  await pruneExpiredAuditLogs(db);
  const rows = await db
    .prepare(
      `SELECT id, action, actor_member_id, actor_username, actor_role,
        target_kind, target_id, target_title, metadata, created_at
       FROM audit_logs
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<D1AuditLogRow>();

  return { logs: (rows.results ?? []).map(auditLogFromRow) };
}

async function getTwitchAppAccessToken() {
  const bindings = getBindings();
  if (!bindings.TWITCH_CLIENT_ID || !bindings.TWITCH_CLIENT_SECRET) {
    throw new HttpError(503, "Twitch is not configured yet.");
  }
  if (cachedAppToken && cachedAppToken.expiresAt > Date.now() + 60_000) return cachedAppToken.token;

  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: bindings.TWITCH_CLIENT_ID,
      client_secret: bindings.TWITCH_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!response.ok) throw new HttpError(502, "Twitch did not accept the API credentials.");
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new HttpError(502, "Twitch did not return an access token.");
  cachedAppToken = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

async function twitchFetch<T>(path: string, accessToken: string) {
  const response = await fetch(`https://api.twitch.tv/helix/${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": getBindings().TWITCH_CLIENT_ID ?? "",
    },
  });
  if (!response.ok) {
    throw new HttpError(502, "Twitch could not return clips right now. Try again.");
  }
  return (await response.json()) as T;
}

type ClipMetadata = {
  title: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
};

async function fetchKickJson(path: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "ClipRoom/1.0",
      },
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchKickChannelClipMetadata(url: string, clipId: string): Promise<ClipMetadata> {
  const channel = getKickChannelSlug(url);
  if (!channel) return { title: null, mediaUrl: null, thumbnailUrl: null };

  let cursor: string | null = null;
  let metadata: ClipMetadata = { title: null, mediaUrl: null, thumbnailUrl: null };
  const deadline = Date.now() + 5_500;

  for (let page = 0; page < 6 && Date.now() < deadline; page++) {
    const params = new URLSearchParams({ sort: "date", time: "all" });
    if (cursor) params.set("cursor", cursor);
    const payload = await fetchKickJson(
      `https://kick.com/api/v2/channels/${encodeURIComponent(channel)}/clips?${params.toString()}`,
      Math.max(750, Math.min(2_500, deadline - Date.now())),
    );
    if (!payload) break;

    const parsed = parseKickChannelClipMetadata(payload, clipId);
    if (parsed.metadata) {
      metadata = mergeKickMetadata(metadata, parsed.metadata);
      if (metadata.mediaUrl) return metadata;
    }
    if (!parsed.nextCursor || parsed.nextCursor === cursor) break;
    cursor = parsed.nextCursor;
  }

  return metadata;
}

async function fetchKickClipMetadata(url: string): Promise<ClipMetadata> {
  const clipId = getKickClipId(url);
  if (!clipId) return { title: null, mediaUrl: null, thumbnailUrl: null };

  const directPaths = [
    `https://kick.com/api/v2/clips/${encodeURIComponent(clipId)}/play`,
    `https://kick.com/api/v2/clips/${encodeURIComponent(clipId)}`,
    `https://kick.com/api/v2/clips/${encodeURIComponent(clipId)}/info`,
  ];
  const directPayloads = await Promise.all(directPaths.map((path) => fetchKickJson(path, 3_500)));
  let metadata = directPayloads.reduce<ClipMetadata>(
    (current, payload) => payload ? mergeKickMetadata(current, parseKickMetadata(payload)) : current,
    { title: null, mediaUrl: null, thumbnailUrl: null } as ClipMetadata,
  );
  if (metadata.mediaUrl) return metadata;

  // Kick's individual clip endpoints occasionally return metadata without a
  // playable URL. The channel clip listing is a second independent source and
  // currently carries the same direct HLS URL used by Kick's own clip pages.
  metadata = mergeKickMetadata(metadata, await fetchKickChannelClipMetadata(url, clipId));
  return metadata;
}

async function resolveManualClipTitle(url: string, rawTitle: string) {
  const explicitTitle = rawTitle.trim();
  if (explicitTitle) return explicitTitle;

  if (getKickClipId(url)) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const metadata = await fetchKickClipMetadata(url);
      const title = metadata.title?.trim();
      if (title) return title;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
    throw new HttpError(502, "Couldn’t retrieve this clip’s title from Kick. Try again.");
  }

  const slug = getTwitchClipSlug(url);
  if (slug) {
    try {
      const accessToken = await getTwitchAppAccessToken();
      const data = await twitchFetch<{ data: TwitchClip[] }>(`clips?id=${encodeURIComponent(slug)}`, accessToken);
      const title = data.data[0]?.title?.trim();
      if (title) return title;
    } catch {
      // Present a stable intake error below rather than exposing Twitch API details.
    }
    throw new HttpError(502, "Couldn’t retrieve this clip’s title from Twitch. Try again.");
  }

  return cleanClipTitle(url);
}

export async function getKickClipPlayback(clipId: string) {
  const db = getDatabase();
  await ensureDatabase(db);
  const clip = await getClip(db, clipId);
  if (!clip || !getKickClipId(clip.url)) throw new HttpError(404, "That Kick clip was not found.");
  const metadata = await fetchKickClipMetadata(clip.url);
  if (!metadata.mediaUrl) throw new HttpError(502, "Kick could not return playable media for this clip.");
  if (metadata.title && /^Untitled Kick clip$/i.test(clip.title)) {
    await db.prepare("UPDATE clips SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(normaliseTaskTitle(metadata.title, cleanClipTitle(clip.url), maxClipTitleLength), nowIso(), clip.id).run();
  }
  return metadata;
}

async function resolveTwitchUsersByLogin(logins: string[], accessToken: string) {
  const unique = Array.from(
    new Set(logins.map(normaliseTwitchLogin).filter((login) => isValidTwitchLogin(login))),
  );
  const users: TwitchUser[] = [];

  for (let index = 0; index < unique.length; index += 100) {
    const query = unique
      .slice(index, index + 100)
      .map((login) => `login=${encodeURIComponent(login)}`)
      .join("&");
    const data = await twitchFetch<{ data: TwitchUser[] }>(`users?${query}`, accessToken);
    users.push(...(data.data ?? []));
  }

  return users;
}

async function fetchBroadcasterClips(
  broadcasterId: string,
  startedAt: string,
  endedAt: string,
  accessToken: string,
) {
  const clips: TwitchClip[] = [];
  let cursor = "";

  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({
      broadcaster_id: broadcasterId,
      first: "100",
      started_at: startedAt,
      ended_at: endedAt,
    });
    if (cursor) params.set("after", cursor);

    const data = await twitchFetch<{
      data: TwitchClip[];
      pagination?: { cursor?: string };
    }>(`clips?${params.toString()}`, accessToken);
    clips.push(...(data.data ?? []));
    cursor = data.pagination?.cursor ?? "";
    if (!cursor || (data.data ?? []).length < 100) break;
  }

  return clips;
}

async function resolveTwitchUser(loginInput: string) {
  const login = normaliseTwitchLogin(loginInput);
  if (!isValidTwitchLogin(login)) throw new HttpError(400, "Enter a valid Twitch username.");
  const accessToken = await getTwitchAppAccessToken();
  const data = await twitchFetch<{ data: TwitchUser[] }>(`users?login=${encodeURIComponent(login)}`, accessToken);
  const user = data.data[0];
  if (!user) throw new HttpError(404, "Twitch could not find that user.");
  return user;
}

export async function addMember(
  actor: CurrentMember,
  input: { username?: unknown; role?: unknown },
) {
  requireAdmin(actor);
  if (typeof input.username !== "string" || !isRole(input.role)) {
    throw new HttpError(400, "Twitch username and role are required.");
  }
  await rateLimitTwitch(actor.id);
  const twitchUser = await resolveTwitchUser(input.username);
  const db = getDatabase();
  await ensureDatabase(db);

  let target = await db.prepare("SELECT * FROM members WHERE twitch_user_id = ?").bind(twitchUser.id).first<D1MemberRow>();
  if (!target) target = await findLinkableLegacyMember(db, twitchUser);

  if (target?.id === actor.id && input.role !== actor.role) {
    throw new HttpError(400, "You cannot change your own admin role.");
  }
  if (
    target?.status === "active" &&
    target.twitch_user_id &&
    target.role === "Admin" &&
    input.role === "Clipper" &&
    (await activeAdminCount(db)) <= 1
  ) {
    throw new HttpError(400, "ClipRoom must keep at least one active admin.");
  }

  const currentCount = await activeMemberCount(db);
  if ((!target || target.status !== "active" || !target.twitch_user_id) && currentCount >= maxMembers) {
    throw new HttpError(400, "This room already has 20 active members.");
  }

  const member = await upsertTwitchIdentity(db, twitchUser, input.role, actor.id);
  if (member) {
    await recordAuditLog(
      db,
      actor,
      "member.upsert",
      "member",
      member.id,
      member.twitch_display_name || member.twitch_login || member.username,
      { role: input.role },
    );
  }
  return getRoomState(actor);
}

export async function removeMember(actor: CurrentMember, memberId: string) {
  requireAdmin(actor);
  if (memberId === actor.id) throw new HttpError(400, "You cannot remove your own admin access.");
  const db = getDatabase();
  await ensureDatabase(db);
  const target = await db
    .prepare("SELECT * FROM members WHERE id = ? AND status = 'active' AND twitch_user_id IS NOT NULL")
    .bind(memberId)
    .first<D1MemberRow>();
  if (!target) throw new HttpError(404, "That member is not on the access list.");
  if (target.role === "Admin" && (await activeAdminCount(db)) <= 1) {
    throw new HttpError(400, "ClipRoom must keep at least one active admin.");
  }
  await db.batch([
    db.prepare("UPDATE members SET status = 'removed' WHERE id = ?").bind(memberId),
    db.prepare("DELETE FROM sessions WHERE member_id = ?").bind(memberId),
  ]);
  await recordAuditLog(
    db,
    actor,
    "member.remove",
    "member",
    target.id,
    target.twitch_display_name || target.twitch_login || target.username,
    { role: target.role },
  );
  return getRoomState(actor);
}

async function findClipBySupportedUrl(db: D1Database, url: string) {
  const exact = await db.prepare("SELECT * FROM clips WHERE url = ?").bind(url).first<D1ClipRow>();
  if (exact) return exact;

  const lookupToken = getKickClipId(url) ?? getTwitchClipSlug(url);
  if (!lookupToken) return null;
  const candidates = await db
    .prepare(
      `SELECT * FROM clips
       WHERE instr(url, ?) > 0
       ORDER BY created_at DESC
       LIMIT 25`,
    )
    .bind(lookupToken)
    .all<D1ClipRow>();
  return (candidates.results ?? []).find((candidate) => supportedClipUrlsMatch(candidate.url, url)) ?? null;
}

export async function addClip<Compact extends boolean = false>(
  actor: CurrentMember,
  input: { url?: unknown; title?: unknown; notes?: unknown; category?: unknown },
  compact: Compact = false as Compact,
) {
  if (typeof input.url !== "string" || !isCategory(input.category)) {
    throw new HttpError(400, "A Twitch or Kick clip URL and category are required.");
  }
  const url = input.url.trim();
  if (url.length > maxClipUrlLength || !isSupportedClipUrl(url)) {
    throw new HttpError(400, "Use a valid Twitch or Kick clip URL.");
  }
  const rawTitle = typeof input.title === "string" ? input.title.trim() : "";
  const rawNotes = normaliseTaskNotes(input.notes);
  if (rawTitle.length > maxClipTitleLength) {
    throw new HttpError(400, `Clip titles must be ${maxClipTitleLength} characters or fewer.`);
  }
  if (rawNotes.length > maxClipNotesLength) {
    throw new HttpError(400, `Clip notes must be ${maxClipNotesLength} characters or fewer.`);
  }

  const db = getDatabase();
  await ensureDatabase(db);
  const existingClip = await findClipBySupportedUrl(db, url);
  if (existingClip?.deleted_at) {
    throw new HttpError(409, "That clip is in Recently deleted. Restore it instead of adding it again.");
  }
  if (existingClip) {
    throw new HttpError(409, "That clip is already in the room.");
  }
  const timestamp = nowIso();
  const clipId = makeId("clip");
  const title = normaliseTaskTitle(await resolveManualClipTitle(url, rawTitle), cleanClipTitle(url), maxClipTitleLength);
  await db
    .prepare(
      `INSERT INTO clips (
        id, url, title, category, intake_source, twitch_creator_login, status, priority,
        assignee, assignee_member_id, notes, created_at, updated_at, created_by, claimed_at, posted_at
       ) VALUES (?, ?, ?, ?, 'manual', NULL, 'New', 0, 'Unclaimed', NULL, ?, ?, ?, ?, NULL, NULL)`,
    )
    .bind(clipId, url, title, input.category, rawNotes, timestamp, timestamp, actor.id)
    .run();
  await recordAuditLog(db, actor, "clip.create", "clip", clipId, title, { category: input.category });
  return taskResponse(actor, db, compact, { clipIds: [clipId] });
}

function parseClipDetails(input: { title?: unknown; notes?: unknown; category?: unknown }) {
  if (typeof input.title !== "string" || !input.title.trim() || !isCategory(input.category)) {
    throw new HttpError(400, "A clip title and category are required.");
  }
  const title = input.title.trim();
  const notes = normaliseTaskNotes(input.notes);
  if (title.length > maxClipTitleLength) {
    throw new HttpError(400, `Clip titles must be ${maxClipTitleLength} characters or fewer.`);
  }
  if (notes.length > maxClipNotesLength) {
    throw new HttpError(400, `Clip notes must be ${maxClipNotesLength} characters or fewer.`);
  }
  return { title, notes, category: input.category };
}

async function getClip(db: D1Database, clipId: string) {
  return db.prepare("SELECT * FROM clips WHERE id = ? AND deleted_at IS NULL").bind(clipId).first<D1ClipRow>();
}

async function getStandaloneClip(db: D1Database, clipId: string) {
  return db
    .prepare(
      `SELECT * FROM clips
       WHERE id = ? AND deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM collection_clips cc WHERE cc.clip_id = clips.id)`,
    )
    .bind(clipId)
    .first<D1ClipRow>();
}

async function getCollection(db: D1Database, collectionId: string) {
  return db
    .prepare("SELECT * FROM collections WHERE id = ? AND deleted_at IS NULL")
    .bind(collectionId)
    .first<D1CollectionRow>();
}

async function toggleSavedTask(
  db: D1Database,
  actor: CurrentMember,
  targetKind: "clip" | "collection",
  targetId: string,
) {
  const existing = await db
    .prepare(
      `SELECT target_id FROM saved_tasks
       WHERE member_id = ? AND target_kind = ? AND target_id = ?`,
    )
    .bind(actor.id, targetKind, targetId)
    .first<{ target_id: string }>();

  if (existing) {
    await db
      .prepare(
        `DELETE FROM saved_tasks
         WHERE member_id = ? AND target_kind = ? AND target_id = ?`,
      )
      .bind(actor.id, targetKind, targetId)
      .run();
    return false;
  }

  await db
    .prepare(
      `INSERT INTO saved_tasks (member_id, target_kind, target_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(actor.id, targetKind, targetId, nowIso())
    .run();
  return true;
}

async function getClipMembership(db: D1Database, clipId: string) {
  return db
    .prepare("SELECT collection_id, clip_id, position FROM collection_clips WHERE clip_id = ?")
    .bind(clipId)
    .first<D1CollectionMembershipRow>();
}

function parseCollectionDetails(input: { title?: unknown; notes?: unknown; category?: unknown }) {
  if (typeof input.title !== "string" || !input.title.trim() || !isCategory(input.category)) {
    throw new HttpError(400, "A Collection title and category are required.");
  }
  const title = input.title.trim();
  const notes = normaliseTaskNotes(input.notes);
  if (title.length > maxCollectionTitleLength) {
    throw new HttpError(400, `Collection titles must be ${maxCollectionTitleLength} characters or fewer.`);
  }
  if (notes.length > maxCollectionNotesLength) {
    throw new HttpError(400, `Collection notes must be ${maxCollectionNotesLength} characters or fewer.`);
  }
  return { title, notes, category: input.category };
}

function parseCollectionClipUrl(value: unknown) {
  if (typeof value !== "string") throw new HttpError(400, "Use a valid Twitch or Kick clip URL.");
  const url = value.trim();
  if (!url || url.length > maxClipUrlLength || !isSupportedClipUrl(url)) {
    throw new HttpError(400, "Use a valid Twitch or Kick clip URL.");
  }
  return url;
}

const activeCollectionGuard = "EXISTS (SELECT 1 FROM collections active_collection WHERE active_collection.id = ? AND active_collection.deleted_at IS NULL)";

function resetClipStatement(db: D1Database, clipId: string, timestamp: string, collectionId?: string) {
  return db
    .prepare(
      `UPDATE clips SET status = 'New', priority = 0, assignee = 'Unclaimed',
       assignee_member_id = NULL, claimed_at = NULL, posted_at = NULL, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL ${collectionId ? `AND ${activeCollectionGuard}` : ""}`,
    )
    .bind(timestamp, clipId, ...(collectionId ? [collectionId] : []));
}

async function runCollectionBatch(db: D1Database, statements: D1PreparedStatement[]) {
  const results = await db.batch(statements);
  if (!results.at(-1)?.meta.changes) throw new HttpError(404, "That Collection was not found.");
}

async function runActiveTaskUpdate(statement: D1PreparedStatement) {
  const result = await statement.run();
  if (!result.meta.changes) throw new HttpError(404, "That active task was not found.");
}

export async function toggleClipPriority<Compact extends boolean = false>(actor: CurrentMember, clipId: string, compact: Compact = false as Compact) {
  requireAdmin(actor);
  const db = getDatabase();
  await ensureDatabase(db);
  const clip = await getStandaloneClip(db, clipId);
  if (!clip) throw new HttpError(404, "That standalone clip was not found.");
  const priority = clip.priority ? 0 : 1;
  const status = priority && clip.status === "New" ? "Prioritised" : !priority && clip.status === "Prioritised" ? "New" : clip.status;
  await runActiveTaskUpdate(db.prepare("UPDATE clips SET priority = ?, status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").bind(priority, status, nowIso(), clipId));
  await recordAuditLog(db, actor, "clip.priority", "clip", clipId, clip.title, {
    fromPriority: Boolean(clip.priority),
    toPriority: Boolean(priority),
    toStatus: status,
  });
  return taskResponse(actor, db, compact, { clipIds: [clipId] });
}

export async function updateClipDetails<Compact extends boolean = false>(
  actor: CurrentMember,
  clipId: string,
  input: { title?: unknown; notes?: unknown; category?: unknown },
  compact: Compact = false as Compact,
) {
  const details = parseClipDetails(input);
  const db = getDatabase();
  await ensureDatabase(db);
  const clip = await getStandaloneClip(db, clipId);
  if (!clip) {
    throw new HttpError(404, "That standalone clip was not found.");
  }
  await runActiveTaskUpdate(db
    .prepare("UPDATE clips SET title = ?, category = ?, notes = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .bind(details.title, details.category, details.notes, nowIso(), clipId));
  await recordAuditLog(db, actor, "clip.update", "clip", clipId, details.title, {
    fromTitle: clip.title,
    toCategory: details.category,
  });
  return taskResponse(actor, db, compact, { clipIds: [clipId] });
}

export async function toggleClipSaved<Compact extends boolean = false>(
  actor: CurrentMember,
  clipId: string,
  compact: Compact = false as Compact,
) {
  const db = getDatabase();
  await ensureDatabase(db);
  const clip = await getStandaloneClip(db, clipId);
  if (!clip) throw new HttpError(404, "That standalone clip was not found.");
  await toggleSavedTask(db, actor, "clip", clipId);
  return taskResponse(actor, db, compact, { clipIds: [clipId] });
}

export async function resetClipProgress<Compact extends boolean = false>(
  actor: CurrentMember,
  clipId: string,
  compact: Compact = false as Compact,
) {
  const db = getDatabase();
  await ensureDatabase(db);
  const clip = await getStandaloneClip(db, clipId);
  if (!clip) throw new HttpError(404, "That standalone clip was not found.");
  if (actor.role !== "Admin" && clip.assignee_member_id && clip.assignee_member_id !== actor.id) {
    throw new HttpError(403, "Only the assignee or an admin can reset this clip's progress.");
  }
  const status: ClipStatus = clip.priority ? "Prioritised" : "New";
  await runActiveTaskUpdate(db
    .prepare(
      `UPDATE clips SET status = ?, assignee = 'Unclaimed', assignee_member_id = NULL,
       claimed_at = NULL, posted_at = NULL, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(status, nowIso(), clipId));
  await recordAuditLog(db, actor, "clip.reset", "clip", clipId, clip.title, {
    fromStatus: clip.status,
    toStatus: status,
  });
  return taskResponse(actor, db, compact, { clipIds: [clipId] });
}

export async function advanceClip<Compact extends boolean = false>(actor: CurrentMember, clipId: string, compact: Compact = false as Compact) {
  const db = getDatabase();
  await ensureDatabase(db);
  let clip = await getStandaloneClip(db, clipId);
  if (!clip) throw new HttpError(404, "That standalone clip was not found.");

  if (clip.status === "New" || clip.status === "Prioritised") {
    const timestamp = nowIso();
    const result = await db
      .prepare(
        `UPDATE clips SET status = 'Claimed', assignee = ?, assignee_member_id = ?, claimed_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('New', 'Prioritised') AND assignee_member_id IS NULL AND deleted_at IS NULL`,
      )
      .bind(actor.username, actor.id, timestamp, timestamp, clipId)
      .run();
    if (!result.meta.changes) {
      clip = await getStandaloneClip(db, clipId);
      if (!clip) throw new HttpError(404, "That standalone clip was not found.");
      if (clip?.assignee_member_id && clip.assignee_member_id !== actor.id) {
        throw new HttpError(409, "That clip was just claimed by someone else.");
      }
    } else {
      await recordAuditLog(db, actor, "clip.claim", "clip", clipId, clip.title, {
        fromStatus: clip.status,
        toStatus: "Claimed",
      });
    }
    return taskResponse(actor, db, compact, { clipIds: [clipId] });
  }

  if (actor.role !== "Admin" && clip.assignee_member_id !== actor.id) {
    throw new HttpError(403, "This clip is claimed by someone else.");
  }
  if (clip.status === "Posted") return taskResponse(actor, db, compact, { clipIds: [clipId] });

  const timestamp = nowIso();
  if (clip.status === "Claimed") {
    await runActiveTaskUpdate(db.prepare("UPDATE clips SET status = 'Editing', updated_at = ? WHERE id = ? AND deleted_at IS NULL").bind(timestamp, clipId));
    await recordAuditLog(db, actor, "clip.edit", "clip", clipId, clip.title, {
      fromStatus: clip.status,
      toStatus: "Editing",
    });
  } else if (clip.status === "Editing") {
    await runActiveTaskUpdate(db.prepare("UPDATE clips SET status = 'Posted', posted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").bind(timestamp, timestamp, clipId));
    await recordAuditLog(db, actor, "clip.post", "clip", clipId, clip.title, {
      fromStatus: clip.status,
      toStatus: "Posted",
    });
  }
  return taskResponse(actor, db, compact, { clipIds: [clipId] });
}

export async function createCollection<Compact extends boolean = false>(
  actor: CurrentMember,
  input: { title?: unknown; notes?: unknown; category?: unknown; urls?: unknown },
  compact: Compact = false as Compact,
) {
  const details = parseCollectionDetails(input);
  if (!Array.isArray(input.urls) || input.urls.length === 0) {
    throw new HttpError(400, "Add at least one Twitch or Kick clip to the Collection.");
  }
  const urls = input.urls.map(parseCollectionClipUrl);
  const hasDuplicateUrl = urls.some((url, index) =>
    urls.slice(0, index).some((existingUrl) => supportedClipUrlsMatch(existingUrl, url)),
  );
  if (hasDuplicateUrl) {
    throw new HttpError(409, "A Collection cannot contain the same clip twice.");
  }

  const db = getDatabase();
  await ensureDatabase(db);
  const timestamp = nowIso();
  const collectionId = makeId("collection");
  const clipPlans: { clipId: string; url: string; existing: boolean; title: string }[] = [];

  for (const url of urls) {
    const existing = await findClipBySupportedUrl(db, url);
    if (existing) {
      if (existing.deleted_at) {
        throw new HttpError(409, "That clip is in Recently deleted. Restore it before adding it to a Collection.");
      }
      if (await getClipMembership(db, existing.id)) {
        throw new HttpError(409, "That clip already belongs to another Collection.");
      }
      clipPlans.push({ clipId: existing.id, url, existing: true, title: normaliseTaskTitle(existing.title, cleanClipTitle(url), maxClipTitleLength) });
    } else {
      clipPlans.push({ clipId: makeId("clip"), url, existing: false, title: normaliseTaskTitle(await resolveManualClipTitle(url, ""), cleanClipTitle(url), maxClipTitleLength) });
    }
  }

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO collections (
          id, title, category, status, priority, assignee, assignee_member_id, notes,
          created_at, updated_at, created_by, claimed_at, posted_at
         ) VALUES (?, ?, ?, 'New', 0, 'Unclaimed', NULL, ?, ?, ?, ?, NULL, NULL)`,
      )
      .bind(
        collectionId,
        details.title,
        details.category,
        details.notes,
        timestamp,
        timestamp,
        actor.id,
      ),
  ];

  clipPlans.forEach((plan, position) => {
    if (plan.existing) {
      statements.push(resetClipStatement(db, plan.clipId, timestamp));
    } else {
      statements.push(
        db
          .prepare(
            `INSERT INTO clips (
              id, url, title, category, intake_source, twitch_creator_login, status, priority,
              assignee, assignee_member_id, notes, created_at, updated_at, created_by, claimed_at, posted_at
             ) VALUES (?, ?, ?, ?, 'manual', NULL, 'New', 0, 'Unclaimed', NULL, 'N/A', ?, ?, ?, NULL, NULL)`,
          )
          .bind(
            plan.clipId,
            plan.url,
            plan.title,
            details.category,
            timestamp,
            timestamp,
            actor.id,
          ),
      );
    }
    statements.push(
      db
        .prepare(
          "INSERT INTO collection_clips (collection_id, clip_id, position, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(collectionId, plan.clipId, position, timestamp),
    );
  });

  await db.batch(statements);
  await recordAuditLog(db, actor, "collection.create", "collection", collectionId, details.title, {
    category: details.category,
    clips: clipPlans.length,
  });
  return taskResponse(actor, db, compact, { collectionIds: [collectionId], removedClipIds: clipPlans.map((plan) => plan.clipId) });
}

export async function updateCollection<Compact extends boolean = false>(
  actor: CurrentMember,
  collectionId: string,
  input: { title?: unknown; notes?: unknown; category?: unknown },
  compact: Compact = false as Compact,
) {
  const details = parseCollectionDetails(input);
  const db = getDatabase();
  await ensureDatabase(db);
  const collection = await getCollection(db, collectionId);
  if (!collection) {
    throw new HttpError(404, "That Collection was not found.");
  }
  await runActiveTaskUpdate(db
    .prepare("UPDATE collections SET title = ?, category = ?, notes = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .bind(details.title, details.category, details.notes, nowIso(), collectionId));
  await recordAuditLog(db, actor, "collection.update", "collection", collectionId, details.title, {
    fromTitle: collection.title,
    toCategory: details.category,
  });
  return taskResponse(actor, db, compact, { collectionIds: [collectionId] });
}

export async function toggleCollectionSaved<Compact extends boolean = false>(
  actor: CurrentMember,
  collectionId: string,
  compact: Compact = false as Compact,
) {
  const db = getDatabase();
  await ensureDatabase(db);
  const collection = await getCollection(db, collectionId);
  if (!collection) throw new HttpError(404, "That Collection was not found.");
  await toggleSavedTask(db, actor, "collection", collectionId);
  return taskResponse(actor, db, compact, { collectionIds: [collectionId] });
}

export async function addCollectionClip<Compact extends boolean = false>(
  actor: CurrentMember,
  collectionId: string,
  input: { url?: unknown },
  compact: Compact = false as Compact,
) {
  const url = parseCollectionClipUrl(input.url);
  const db = getDatabase();
  await ensureDatabase(db);
  const collection = await getCollection(db, collectionId);
  if (!collection) throw new HttpError(404, "That Collection was not found.");

  const timestamp = nowIso();
  const existing = await findClipBySupportedUrl(db, url);
  const clipId = existing?.id ?? makeId("clip");
  if (existing) {
    if (existing.deleted_at) {
      throw new HttpError(409, "That clip is in Recently deleted. Restore it before adding it to a Collection.");
    }
    const membership = await getClipMembership(db, existing.id);
    if (membership?.collection_id === collectionId) {
      throw new HttpError(409, "That clip is already in this Collection.");
    }
    if (membership) {
      throw new HttpError(409, "That clip already belongs to another Collection.");
    }
  }

  const stillActive = await db.prepare("SELECT 1 FROM collections WHERE id = ? AND deleted_at IS NULL").bind(collectionId).first();
  if (!stillActive) throw new HttpError(404, "That Collection was not found.");

  const statements: D1PreparedStatement[] = [];
  const newClipTitle = existing ? null : normaliseTaskTitle(await resolveManualClipTitle(url, ""), cleanClipTitle(url), maxClipTitleLength);
  if (existing) {
    statements.push(resetClipStatement(db, clipId, timestamp, collectionId));
  } else {
    statements.push(
      db
        .prepare(
          `INSERT INTO clips (
            id, url, title, category, intake_source, twitch_creator_login, status, priority,
            assignee, assignee_member_id, notes, created_at, updated_at, created_by, claimed_at, posted_at
           ) SELECT ?, ?, ?, ?, 'manual', NULL, 'New', 0, 'Unclaimed', NULL, 'N/A', ?, ?, ?, NULL, NULL
             WHERE ${activeCollectionGuard}`,
        )
        .bind(
          clipId,
          url,
          newClipTitle ?? cleanClipTitle(url),
          collection.category,
          timestamp,
          timestamp,
          actor.id,
          collectionId,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO collection_clips (collection_id, clip_id, position, created_at)
         SELECT ?, ?, COALESCE(MAX(position), -1) + 1, ?
         FROM collection_clips WHERE collection_id = ? HAVING ${activeCollectionGuard}`,
      )
      .bind(collectionId, clipId, timestamp, collectionId, collectionId),
    db.prepare("UPDATE collections SET updated_at = ? WHERE id = ? AND deleted_at IS NULL").bind(timestamp, collectionId),
  );
  await runCollectionBatch(db, statements);
  await recordAuditLog(db, actor, "collection.clipAdd", "collection", collectionId, collection.title, {
    clipId,
    url,
  });
  return taskResponse(actor, db, compact, { collectionIds: [collectionId], removedClipIds: [clipId] });
}

export async function removeCollectionClip<Compact extends boolean = false>(
  actor: CurrentMember,
  collectionId: string,
  clipId: string,
  compact: Compact = false as Compact,
) {
  const db = getDatabase();
  await ensureDatabase(db);
  if (!(await getCollection(db, collectionId))) {
    throw new HttpError(404, "That Collection was not found.");
  }
  const membership = await getClipMembership(db, clipId);
  if (!membership || membership.collection_id !== collectionId) {
    throw new HttpError(404, "That clip is not in this Collection.");
  }
  const count = await db
    .prepare("SELECT COUNT(*) AS count FROM collection_clips WHERE collection_id = ?")
    .bind(collectionId)
    .first<D1CountRow>();
  if ((count?.count ?? 0) <= 1) {
    throw new HttpError(400, "A Collection must keep at least one clip.");
  }

  const timestamp = nowIso();
  const collection = await getCollection(db, collectionId);
  const clip = await getClip(db, clipId);
  await runCollectionBatch(db, [
    db
      .prepare(`DELETE FROM collection_clips WHERE collection_id = ? AND clip_id = ? AND ${activeCollectionGuard}`)
      .bind(collectionId, clipId, collectionId),
    resetClipStatement(db, clipId, timestamp, collectionId),
    db
      .prepare(
        `UPDATE collection_clips SET position = -position - 1 WHERE collection_id = ? AND position > ? AND ${activeCollectionGuard}`,
      )
      .bind(collectionId, membership.position, collectionId),
    db
      .prepare(
        `UPDATE collection_clips SET position = -position - 2 WHERE collection_id = ? AND position < 0 AND ${activeCollectionGuard}`,
      )
      .bind(collectionId, collectionId),
    db.prepare("UPDATE collections SET updated_at = ? WHERE id = ? AND deleted_at IS NULL").bind(timestamp, collectionId),
  ]);
  await recordAuditLog(db, actor, "collection.clipRemove", "collection", collectionId, collection?.title ?? null, {
    clipId,
    clipTitle: clip?.title ?? null,
  });
  return taskResponse(actor, db, compact, { clipIds: [clipId], collectionIds: [collectionId] });
}

export async function reorderCollectionClip<Compact extends boolean = false>(
  actor: CurrentMember,
  collectionId: string,
  clipId: string,
  direction: unknown,
  compact: Compact = false as Compact,
) {
  if (direction !== "left" && direction !== "right") {
    throw new HttpError(400, "Choose a valid clip reorder direction.");
  }
  const db = getDatabase();
  await ensureDatabase(db);
  if (!(await getCollection(db, collectionId))) {
    throw new HttpError(404, "That Collection was not found.");
  }
  const membership = await getClipMembership(db, clipId);
  if (!membership || membership.collection_id !== collectionId) {
    throw new HttpError(404, "That clip is not in this Collection.");
  }

  const targetPosition = membership.position + (direction === "left" ? -1 : 1);
  if (targetPosition < 0) return taskResponse(actor, db, compact, { collectionIds: [collectionId] });
  const neighbour = await db
    .prepare(
      "SELECT collection_id, clip_id, position FROM collection_clips WHERE collection_id = ? AND position = ?",
    )
    .bind(collectionId, targetPosition)
    .first<D1CollectionMembershipRow>();
  if (!neighbour) return taskResponse(actor, db, compact, { collectionIds: [collectionId] });

  const timestamp = nowIso();
  const collection = await getCollection(db, collectionId);
  const clip = await getClip(db, clipId);
  await runCollectionBatch(db, [
    db
      .prepare(`UPDATE collection_clips SET position = -1 WHERE collection_id = ? AND clip_id = ? AND ${activeCollectionGuard}`)
      .bind(collectionId, clipId, collectionId),
    db
      .prepare(`UPDATE collection_clips SET position = ? WHERE collection_id = ? AND clip_id = ? AND ${activeCollectionGuard}`)
      .bind(membership.position, collectionId, neighbour.clip_id, collectionId),
    db
      .prepare(`UPDATE collection_clips SET position = ? WHERE collection_id = ? AND clip_id = ? AND ${activeCollectionGuard}`)
      .bind(targetPosition, collectionId, clipId, collectionId),
    db.prepare("UPDATE collections SET updated_at = ? WHERE id = ? AND deleted_at IS NULL").bind(timestamp, collectionId),
  ]);
  await recordAuditLog(db, actor, "collection.clipReorder", "collection", collectionId, collection?.title ?? null, {
    clipId,
    clipTitle: clip?.title ?? null,
    direction,
  });
  return taskResponse(actor, db, compact, { collectionIds: [collectionId] });
}

export async function toggleCollectionPriority<Compact extends boolean = false>(actor: CurrentMember, collectionId: string, compact: Compact = false as Compact) {
  requireAdmin(actor);
  const db = getDatabase();
  await ensureDatabase(db);
  const collection = await getCollection(db, collectionId);
  if (!collection) throw new HttpError(404, "That Collection was not found.");
  const priority = collection.priority ? 0 : 1;
  const status =
    priority && collection.status === "New"
      ? "Prioritised"
      : !priority && collection.status === "Prioritised"
        ? "New"
        : collection.status;
  await runActiveTaskUpdate(db
    .prepare("UPDATE collections SET priority = ?, status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .bind(priority, status, nowIso(), collectionId));
  await recordAuditLog(db, actor, "collection.priority", "collection", collectionId, collection.title, {
    fromPriority: Boolean(collection.priority),
    toPriority: Boolean(priority),
    toStatus: status,
  });
  return taskResponse(actor, db, compact, { collectionIds: [collectionId] });
}

export async function resetCollectionProgress<Compact extends boolean = false>(
  actor: CurrentMember,
  collectionId: string,
  compact: Compact = false as Compact,
) {
  const db = getDatabase();
  await ensureDatabase(db);
  const collection = await getCollection(db, collectionId);
  if (!collection) throw new HttpError(404, "That Collection was not found.");
  if (actor.role !== "Admin" && collection.assignee_member_id && collection.assignee_member_id !== actor.id) {
    throw new HttpError(403, "Only the assignee or an admin can reset this Collection's progress.");
  }
  const status: ClipStatus = collection.priority ? "Prioritised" : "New";
  await runActiveTaskUpdate(db
    .prepare(
      `UPDATE collections SET status = ?, assignee = 'Unclaimed', assignee_member_id = NULL,
       claimed_at = NULL, posted_at = NULL, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(status, nowIso(), collectionId));
  await recordAuditLog(db, actor, "collection.reset", "collection", collectionId, collection.title, {
    fromStatus: collection.status,
    toStatus: status,
  });
  return taskResponse(actor, db, compact, { collectionIds: [collectionId] });
}

export async function advanceCollection<Compact extends boolean = false>(actor: CurrentMember, collectionId: string, compact: Compact = false as Compact) {
  const db = getDatabase();
  await ensureDatabase(db);
  let collection = await getCollection(db, collectionId);
  if (!collection) throw new HttpError(404, "That Collection was not found.");

  if (collection.status === "New" || collection.status === "Prioritised") {
    const timestamp = nowIso();
    const result = await db
      .prepare(
        `UPDATE collections SET status = 'Claimed', assignee = ?, assignee_member_id = ?, claimed_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('New', 'Prioritised') AND assignee_member_id IS NULL AND deleted_at IS NULL`,
      )
      .bind(actor.username, actor.id, timestamp, timestamp, collectionId)
      .run();
    if (!result.meta.changes) {
      collection = await getCollection(db, collectionId);
      if (!collection) throw new HttpError(404, "That Collection was not found.");
      if (collection?.assignee_member_id && collection.assignee_member_id !== actor.id) {
        throw new HttpError(409, "That Collection was just claimed by someone else.");
      }
    } else {
      await recordAuditLog(db, actor, "collection.claim", "collection", collectionId, collection.title, {
        fromStatus: collection.status,
        toStatus: "Claimed",
      });
    }
    return taskResponse(actor, db, compact, { collectionIds: [collectionId] });
  }

  if (actor.role !== "Admin" && collection.assignee_member_id !== actor.id) {
    throw new HttpError(403, "This Collection is claimed by someone else.");
  }
  if (collection.status === "Posted") return taskResponse(actor, db, compact, { collectionIds: [collectionId] });

  const timestamp = nowIso();
  if (collection.status === "Claimed") {
    await runActiveTaskUpdate(db
      .prepare("UPDATE collections SET status = 'Editing', updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(timestamp, collectionId));
    await recordAuditLog(db, actor, "collection.edit", "collection", collectionId, collection.title, {
      fromStatus: collection.status,
      toStatus: "Editing",
    });
  } else if (collection.status === "Editing") {
    await runActiveTaskUpdate(db
      .prepare("UPDATE collections SET status = 'Posted', posted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(timestamp, timestamp, collectionId));
    await recordAuditLog(db, actor, "collection.post", "collection", collectionId, collection.title, {
      fromStatus: collection.status,
      toStatus: "Posted",
    });
  }
  return taskResponse(actor, db, compact, { collectionIds: [collectionId] });
}

export async function deleteCollection<Compact extends boolean = false>(actor: CurrentMember, collectionId: string, compact: Compact = false as Compact) {
  const db = getDatabase();
  await ensureDatabase(db);
  const collection = await getCollection(db, collectionId);
  if (!collection) {
    throw new HttpError(404, "That Collection was not found.");
  }
  const results = await runRetentionStatements(db, buildSoftDeleteStatements("collection", collectionId, nowIso(), actor.id));
  if (!results.at(-1)?.meta.changes) throw new HttpError(404, "That Collection was not found.");
  await recordAuditLog(db, actor, "collection.delete", "collection", collectionId, collection.title);
  return taskResponse(actor, db, compact, { collectionIds: [collectionId] });
}

export async function deleteClip<Compact extends boolean = false>(actor: CurrentMember, clipId: string, compact: Compact = false as Compact) {
  const db = getDatabase();
  await ensureDatabase(db);
  const clip = await getStandaloneClip(db, clipId);
  if (!clip) {
    if (await getClip(db, clipId)) {
      throw new HttpError(409, "That clip belongs to a Collection. Remove it from the Collection first.");
    }
    throw new HttpError(404, "That clip was not found.");
  }
  const results = await runRetentionStatements(db, buildSoftDeleteStatements("clip", clipId, nowIso(), actor.id));
  if (!results.at(-1)?.meta.changes) throw new HttpError(404, "That clip was not found.");
  await recordAuditLog(db, actor, "clip.delete", "clip", clipId, clip.title);
  return taskResponse(actor, db, compact, { clipIds: [clipId] });
}

export async function restoreClip<Compact extends boolean = false>(actor: CurrentMember, clipId: string, compact: Compact = false as Compact) {
  const db = getDatabase();
  await ensureDatabase(db);
  const clip = await db.prepare("SELECT title FROM clips WHERE id = ?").bind(clipId).first<{ title: string }>();
  const results = await runRetentionStatements(db, buildRestoreStatements("clip", clipId, nowIso()));
  if (!results.at(-1)?.meta.changes) {
    throw new HttpError(404, "That deleted clip is no longer available to restore.");
  }
  await recordAuditLog(db, actor, "clip.restore", "clip", clipId, clip?.title ?? null);
  return taskResponse(actor, db, compact, { clipIds: [clipId] });
}

export async function restoreCollection<Compact extends boolean = false>(actor: CurrentMember, collectionId: string, compact: Compact = false as Compact) {
  const db = getDatabase();
  await ensureDatabase(db);
  const collection = await db.prepare("SELECT title FROM collections WHERE id = ?").bind(collectionId).first<{ title: string }>();
  const results = await runRetentionStatements(db, buildRestoreStatements("collection", collectionId, nowIso()));
  if (!results.at(-1)?.meta.changes) {
    throw new HttpError(404, "That deleted Collection is no longer available to restore.");
  }
  await recordAuditLog(db, actor, "collection.restore", "collection", collectionId, collection?.title ?? null);
  return taskResponse(actor, db, compact, { collectionIds: [collectionId] });
}

export async function permanentlyDeleteClip<Compact extends boolean = false>(
  actor: CurrentMember,
  clipId: string,
  compact: Compact = false as Compact,
) {
  requireAdmin(actor);
  const db = getDatabase();
  await ensureDatabase(db);
  const clip = await db.prepare("SELECT title FROM clips WHERE id = ?").bind(clipId).first<{ title: string }>();
  const results = await runRetentionStatements(db, buildPermanentDeleteStatements("clip", clipId));
  if (!results.at(-1)?.meta.changes) throw new HttpError(404, "That deleted standalone clip was not found.");
  await recordAuditLog(db, actor, "clip.permanentDelete", "clip", clipId, clip?.title ?? null);
  return taskResponse(actor, db, compact, { removedClipIds: [clipId] });
}

export async function permanentlyDeleteCollection<Compact extends boolean = false>(
  actor: CurrentMember,
  collectionId: string,
  compact: Compact = false as Compact,
) {
  requireAdmin(actor);
  const db = getDatabase();
  await ensureDatabase(db);
  const collection = await db.prepare("SELECT title FROM collections WHERE id = ?").bind(collectionId).first<{ title: string }>();
  const results = await runRetentionStatements(db, buildPermanentDeleteStatements("collection", collectionId));
  if (!results.at(-1)?.meta.changes) throw new HttpError(404, "That deleted Collection was not found.");
  await recordAuditLog(db, actor, "collection.permanentDelete", "collection", collectionId, collection?.title ?? null);
  return taskResponse(actor, db, compact, { removedCollectionIds: [collectionId] });
}

export async function setSourceChannel(actor: CurrentMember, channel: unknown, trustedClippers?: unknown) {
  requireAdmin(actor);
  if (typeof channel !== "string") throw new HttpError(400, "Twitch channel is required.");
  const cleanChannel = normaliseTwitchLogin(channel);
  if (!isValidTwitchLogin(cleanChannel)) throw new HttpError(400, "Enter a valid Twitch channel.");
  const trustedClipperLogins = parseTrustedClipperInput(trustedClippers);
  const db = getDatabase();
  await ensureDatabase(db);
  const previousChannel = (await getSetting(db, "source_channel")) ?? defaultChannel;
  const previousTrustedClippers = await getTrustedClipperLogins(db);
  await setSetting(db, "source_channel", cleanChannel);
  if (trustedClipperLogins) await setTrustedClipperLogins(db, trustedClipperLogins);
  await recordAuditLog(db, actor, "room.sourceUpdate", "room", null, "Twitch source", {
    fromChannel: previousChannel,
    toChannel: cleanChannel,
    fromTrustedClippers: previousTrustedClippers,
    toTrustedClippers: trustedClipperLogins ?? previousTrustedClippers,
  });
  return getRoomState(actor);
}

function getSyncWindowStartedAt() {
  return toRfc3339(new Date(Date.now() - firstTwitchSyncWindowHours * 60 * 60 * 1000).toISOString());
}

function toRfc3339(value: string) {
  return value.replace(/\.\d{3}Z$/, "Z");
}

async function findClipByTwitchUrl(db: D1Database, url: string) {
  const slug = getTwitchClipSlug(url);
  if (!slug) {
    return db.prepare("SELECT * FROM clips WHERE url = ?").bind(url).first<D1ClipRow>();
  }

  const candidates = await db
    .prepare(
      `SELECT * FROM clips
       WHERE url = ? OR instr(url, ?) > 0
       ORDER BY created_at DESC
       LIMIT 25`,
    )
    .bind(url, slug)
    .all<D1ClipRow>();

  return (candidates.results ?? []).find((candidate) => twitchClipUrlsMatch(candidate.url, url)) ?? null;
}

export async function syncTwitchClips(actor: CurrentMember) {
  await rateLimitTwitch(actor.id);
  const db = getDatabase();
  await ensureDatabase(db);
  await rateLimitTwitchSync(db, actor.id);
  const sourceChannel = (await getSetting(db, "source_channel")) ?? defaultChannel;
  const trustedClipperLogins = await getTrustedClipperLogins(db);
  if (!trustedClipperLogins.length) throw new HttpError(400, "Add at least one trusted Twitch clipper before syncing.");

  const accessToken = await getTwitchAppAccessToken();
  const userData = await twitchFetch<{ data: { id: string }[] }>(`users?login=${encodeURIComponent(sourceChannel)}`, accessToken);
  const broadcasterId = userData.data[0]?.id;
  if (!broadcasterId) throw new HttpError(404, "Twitch could not find that channel.");

  const matchLogins = Array.from(
    new Set(
      trustedClipperLogins
        .map(normaliseTwitchLogin)
        .filter((login) => isValidTwitchLogin(login)),
    ),
  );
  const trustedUsers = await resolveTwitchUsersByLogin(matchLogins, accessToken);
  const trustedIds = new Set(trustedUsers.map((user) => user.id));
  const loginById = new Map(trustedUsers.map((user) => [user.id, user.login]));
  const trustedLogins = new Set(matchLogins);

  const syncTimestamp = nowIso();
  const startedAt = getSyncWindowStartedAt();
  const recentClips = await fetchBroadcasterClips(broadcasterId, startedAt, syncTimestamp, accessToken);
  const trustedClips = recentClips.filter((clip) => {
    if (clip.creator_id && trustedIds.has(clip.creator_id)) return true;
    return trustedLogins.has(normaliseTwitchLogin(clip.creator_name ?? ""));
  });

  let imported = 0;
  for (const clip of trustedClips) {
    const creatorLogin =
      (clip.creator_id && loginById.get(clip.creator_id)) ||
      normaliseTwitchLogin(clip.creator_name ?? "") ||
      null;
    const existing = await findClipByTwitchUrl(db, clip.url);
    if (existing) {
      if (existing.deleted_at) continue;
      if (existing.intake_source === "trusted_sync" && existing.twitch_creator_login === creatorLogin) {
        continue;
      }
      const updated = await db
        .prepare(
          `UPDATE clips
           SET intake_source = 'trusted_sync', twitch_creator_login = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL AND (intake_source != 'trusted_sync' OR IFNULL(twitch_creator_login, '') != IFNULL(?, ''))`,
        )
        .bind(creatorLogin, syncTimestamp, existing.id, creatorLogin)
        .run();
      imported += updated.meta.changes ?? 0;
      continue;
    }

    const inserted = await db
      .prepare(
        `INSERT OR IGNORE INTO clips (
          id, url, title, category, intake_source, twitch_creator_login, status, priority,
          assignee, assignee_member_id, notes, created_at, updated_at, created_by, claimed_at, posted_at
         ) VALUES (?, ?, ?, 'other', 'trusted_sync', ?, 'New', 0, 'Unclaimed', NULL, 'N/A', ?, ?, ?, NULL, NULL)`,
      )
      .bind(
        `tw_${clip.id}`,
        clip.url,
        normaliseTaskTitle(clip.title, cleanClipTitle(clip.url), maxClipTitleLength),
        creatorLogin,
        clip.created_at || syncTimestamp,
        syncTimestamp,
        actor.id,
      )
      .run();
    imported += inserted.meta.changes ?? 0;
  }

  await setSetting(db, lastTwitchSyncSettingKey, syncTimestamp);
  await markTwitchSyncCooldown(db, actor.id);
  await recordAuditLog(db, actor, "room.sync", "room", null, sourceChannel, {
    checked: recentClips.length,
    matched: trustedClips.length,
    imported,
  });
  return { state: await getRoomState(actor), checked: recentClips.length, matched: trustedClips.length, imported };
}
