import { env } from "cloudflare:workers";

import { schemaStatements, seedClips } from "@/db/schema";
import {
  cleanClipTitle,
  defaultChannel,
  getTwitchClipSlug,
  isCategory,
  isRole,
  maxMembers,
  normaliseEmail,
} from "@/lib/cliproom/shared";
import type {
  Category,
  Clip,
  ClipStatus,
  CurrentMember,
  Member,
  MemberRole,
  RoomState,
} from "@/lib/cliproom/shared";

const sessionCookieName = "cliproom_session";
const sessionDays = 30;
const encoder = new TextEncoder();

type ClipRoomEnv = {
  DB?: D1Database;
  CLIPROOM_ADMIN_CODE?: string;
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
};

type D1CountRow = { count: number };

type D1MemberRow = {
  id: string;
  email: string;
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
  status: ClipStatus;
  priority: number;
  assignee: string;
  assignee_member_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  claimed_at: string | null;
  posted_at: string | null;
};

type D1SessionRow = {
  id: string;
  member_id: string;
  session_hash: string;
  expires_at: string;
  member_status: string;
  email: string;
  role: MemberRole;
};

type TwitchClip = {
  id: string;
  url: string;
  title: string;
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
  return env as ClipRoomEnv;
}

function getDatabase() {
  const db = getBindings().DB;
  if (!db) {
    throw new HttpError(500, "ClipRoom storage is not connected yet.");
  }

  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function daysFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function randomToken(bytes = 24) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function hashInviteCode(email: string, code: string) {
  return sha256(`cliproom:invite:${normaliseEmail(email)}:${code.trim()}`);
}

async function hashSessionToken(token: string) {
  return sha256(`cliproom:session:${token}`);
}

function getSessionToken(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`));

  return match ? decodeURIComponent(match.slice(sessionCookieName.length + 1)) : "";
}

function getRequestIsSecure(request: Request) {
  const url = new URL(request.url);
  return url.protocol === "https:";
}

function sessionCookie(token: string, request: Request) {
  const secure = getRequestIsSecure(request) ? "; Secure" : "";
  return `${sessionCookieName}=${encodeURIComponent(
    token,
  )}; HttpOnly; Path=/; Max-Age=${sessionDays * 24 * 60 * 60}; SameSite=Lax${secure}`;
}

function expiredSessionCookie(request: Request) {
  const secure = getRequestIsSecure(request) ? "; Secure" : "";
  return `${sessionCookieName}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function clipFromRow(row: D1ClipRow): Clip {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    category: row.category,
    status: row.status,
    priority: Boolean(row.priority),
    assignee: row.assignee,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    postedAt: row.posted_at,
  };
}

function memberFromRow(row: D1MemberRow): Member {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    addedAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function publicMemberFromSession(row: D1SessionRow): CurrentMember {
  return {
    id: row.member_id,
    email: row.email,
    role: row.role,
  };
}

async function getSetting(db: D1Database, key: string) {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();

  return row?.value ?? null;
}

async function setSetting(db: D1Database, key: string, value: string) {
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    )
    .bind(key, value, timestamp)
    .run();
}

async function activeAdminCount(db: D1Database) {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM members WHERE role = 'Admin' AND status = 'active'",
    )
    .first<D1CountRow>();

  return row?.count ?? 0;
}

async function activeMemberCount(db: D1Database) {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM members WHERE status = 'active'")
    .first<D1CountRow>();

  return row?.count ?? 0;
}

export async function ensureDatabase(db = getDatabase()) {
  for (const statement of schemaStatements) {
    await db.prepare(statement).run();
  }

  const timestamp = nowIso();
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(timestamp).run();

  const sourceChannel = await getSetting(db, "source_channel");
  if (!sourceChannel) {
    await setSetting(db, "source_channel", defaultChannel);
  }

  const clipCount = await db
    .prepare("SELECT COUNT(*) AS count FROM clips")
    .first<D1CountRow>();

  if ((clipCount?.count ?? 0) === 0) {
    const inserts = seedClips.map((clip) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO clips (
            id, url, title, category, status, priority, assignee, assignee_member_id,
            notes, created_at, updated_at, created_by, claimed_at, posted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          clip.id,
          clip.url,
          clip.title,
          clip.category,
          clip.status,
          clip.priority ? 1 : 0,
          clip.assignee,
          null,
          clip.notes,
          clip.createdAt,
          clip.createdAt,
          null,
          clip.claimedAt ?? null,
          clip.postedAt ?? null,
        ),
    );

    await db.batch(inserts);
  }

  await db.prepare("PRAGMA optimize").run();
}

export function jsonOk(payload: unknown, init?: ResponseInit) {
  return Response.json(payload, init);
}

export function jsonError(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  console.error(error);
  return Response.json({ error: "Something went wrong in ClipRoom." }, { status: 500 });
}

async function createSession(member: CurrentMember, request: Request) {
  const db = getDatabase();
  const token = randomToken(32);
  const sessionHash = await hashSessionToken(token);
  const timestamp = nowIso();

  await db
    .prepare(
      `INSERT INTO sessions (id, member_id, session_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(makeId("ses"), member.id, sessionHash, timestamp, daysFromNow(sessionDays))
    .run();

  await db
    .prepare("UPDATE members SET last_seen_at = ? WHERE id = ?")
    .bind(timestamp, member.id)
    .run();

  return sessionCookie(token, request);
}

export async function destroyCurrentSession(request: Request) {
  const db = getDatabase();
  await ensureDatabase(db);

  const token = getSessionToken(request);
  if (token) {
    const hash = await hashSessionToken(token);
    await db.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(hash).run();
  }

  return expiredSessionCookie(request);
}

export async function getCurrentMember(request: Request) {
  const db = getDatabase();
  await ensureDatabase(db);

  const token = getSessionToken(request);
  if (!token) return null;

  const sessionHash = await hashSessionToken(token);
  const row = await db
    .prepare(
      `SELECT
        sessions.id,
        sessions.member_id,
        sessions.session_hash,
        sessions.expires_at,
        members.status AS member_status,
        members.email,
        members.role
      FROM sessions
      JOIN members ON members.id = sessions.member_id
      WHERE sessions.session_hash = ?`,
    )
    .bind(sessionHash)
    .first<D1SessionRow>();

  if (!row || row.expires_at <= nowIso() || row.member_status !== "active") {
    await db.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(sessionHash).run();
    return null;
  }

  await db
    .prepare("UPDATE members SET last_seen_at = ? WHERE id = ?")
    .bind(nowIso(), row.member_id)
    .run();

  return publicMemberFromSession(row);
}

export async function requireMember(request: Request) {
  const member = await getCurrentMember(request);
  if (!member) {
    throw new HttpError(401, "Enter your ClipRoom email and access code.");
  }

  return member;
}

function requireAdmin(member: CurrentMember) {
  if (member.role !== "Admin") {
    throw new HttpError(403, "Only admins can do that.");
  }
}

export async function getRoomState(member: CurrentMember): Promise<RoomState> {
  const db = getDatabase();
  await ensureDatabase(db);

  const clipRows = await db
    .prepare(
      `SELECT * FROM clips
       ORDER BY
        priority DESC,
        CASE status
          WHEN 'New' THEN 0
          WHEN 'Prioritised' THEN 1
          WHEN 'Claimed' THEN 2
          WHEN 'Editing' THEN 3
          WHEN 'Posted' THEN 4
          ELSE 5
        END,
        created_at DESC`,
    )
    .all<D1ClipRow>();

  const memberRows =
    member.role === "Admin"
      ? await db
          .prepare(
            `SELECT * FROM members
             WHERE status = 'active'
             ORDER BY
               CASE role WHEN 'Admin' THEN 0 ELSE 1 END,
               created_at ASC`,
          )
          .all<D1MemberRow>()
      : { results: [] };

  const bindings = getBindings();
  const sourceChannel = (await getSetting(db, "source_channel")) ?? defaultChannel;

  return {
    member,
    clips: clipRows.results.map(clipFromRow),
    members: memberRows.results.map(memberFromRow),
    sourceChannel,
    memberCount: await activeMemberCount(db),
    maxMembers,
    twitchSyncAvailable: Boolean(
      bindings.TWITCH_CLIENT_ID && bindings.TWITCH_CLIENT_SECRET,
    ),
  };
}

export async function signInWithCode(
  request: Request,
  input: { email?: unknown; code?: unknown },
) {
  const db = getDatabase();
  await ensureDatabase(db);

  if (typeof input.email !== "string" || typeof input.code !== "string") {
    throw new HttpError(400, "Email and access code are required.");
  }

  const email = normaliseEmail(input.email);
  const code = input.code.trim();

  if (!email.includes("@") || !code) {
    throw new HttpError(400, "Use a valid email and access code.");
  }

  const adminCode = getBindings().CLIPROOM_ADMIN_CODE?.trim();
  const adminCount = await activeAdminCount(db);

  if (adminCode && code === adminCode) {
    const existingAdmin = await db
      .prepare(
        "SELECT * FROM members WHERE email = ? AND role = 'Admin' AND status = 'active'",
      )
      .bind(email)
      .first<D1MemberRow>();

    if (existingAdmin) {
      const member = {
        id: existingAdmin.id,
        email: existingAdmin.email,
        role: existingAdmin.role,
      };
      const cookie = await createSession(member, request);
      return { state: await getRoomState(member), cookie };
    }

    if (adminCount > 0) {
      throw new HttpError(403, "Ask an existing admin for an invite link.");
    }

    const timestamp = nowIso();
    const member: CurrentMember = {
      id: makeId("mem"),
      email,
      role: "Admin",
    };

    await db
      .prepare(
        `INSERT INTO members (
          id, email, role, status, invite_code_hash, invited_by, created_at, last_seen_at
        )
        VALUES (?, ?, 'Admin', 'active', NULL, NULL, ?, ?)`,
      )
      .bind(member.id, email, timestamp, timestamp)
      .run();

    const cookie = await createSession(member, request);
    return { state: await getRoomState(member), cookie };
  }

  const row = await db
    .prepare("SELECT * FROM members WHERE email = ? AND status = 'active'")
    .bind(email)
    .first<D1MemberRow>();

  if (!row || !row.invite_code_hash) {
    throw new HttpError(401, "This email is not on the ClipRoom access list.");
  }

  const codeHash = await hashInviteCode(email, code);
  if (codeHash !== row.invite_code_hash) {
    throw new HttpError(401, "That access code does not match this email.");
  }

  const member = { id: row.id, email: row.email, role: row.role };
  const cookie = await createSession(member, request);
  return { state: await getRoomState(member), cookie };
}

function buildInviteUrl(request: Request, email: string, code: string) {
  const url = new URL(request.url);
  url.pathname = "/";
  url.search = "";
  url.searchParams.set("email", email);
  url.searchParams.set("code", code);
  return url.toString();
}

export async function createInvite(
  request: Request,
  actor: CurrentMember,
  input: { email?: unknown; role?: unknown },
) {
  requireAdmin(actor);

  if (typeof input.email !== "string" || !isRole(input.role)) {
    throw new HttpError(400, "Email and role are required.");
  }

  const db = getDatabase();
  await ensureDatabase(db);

  const email = normaliseEmail(input.email);
  if (!email.includes("@")) {
    throw new HttpError(400, "Use a valid email address.");
  }

  const existing = await db
    .prepare("SELECT * FROM members WHERE email = ?")
    .bind(email)
    .first<D1MemberRow>();

  const currentCount = await activeMemberCount(db);
  if ((!existing || existing.status !== "active") && currentCount >= maxMembers) {
    throw new HttpError(400, "This room already has 20 active members.");
  }

  const code = randomToken(9);
  const inviteHash = await hashInviteCode(email, code);
  const timestamp = nowIso();
  const memberId = existing?.id ?? makeId("mem");

  await db
    .prepare(
      `INSERT INTO members (
        id, email, role, status, invite_code_hash, invited_by, created_at, last_seen_at
      )
      VALUES (?, ?, ?, 'active', ?, ?, ?, NULL)
      ON CONFLICT(email) DO UPDATE SET
        role = excluded.role,
        status = 'active',
        invite_code_hash = excluded.invite_code_hash,
        invited_by = excluded.invited_by`,
    )
    .bind(memberId, email, input.role, inviteHash, actor.id, timestamp)
    .run();

  return {
    inviteCode: code,
    inviteUrl: buildInviteUrl(request, email, code),
    state: await getRoomState(actor),
  };
}

export async function regenerateInvite(
  request: Request,
  actor: CurrentMember,
  memberId: string,
) {
  requireAdmin(actor);

  const db = getDatabase();
  await ensureDatabase(db);

  const target = await db
    .prepare("SELECT * FROM members WHERE id = ? AND status = 'active'")
    .bind(memberId)
    .first<D1MemberRow>();

  if (!target) {
    throw new HttpError(404, "That member is not on the access list.");
  }

  const code = randomToken(9);
  const inviteHash = await hashInviteCode(target.email, code);

  await db
    .prepare("UPDATE members SET invite_code_hash = ?, invited_by = ? WHERE id = ?")
    .bind(inviteHash, actor.id, memberId)
    .run();

  return {
    inviteCode: code,
    inviteUrl: buildInviteUrl(request, target.email, code),
    state: await getRoomState(actor),
  };
}

export async function removeMember(actor: CurrentMember, memberId: string) {
  requireAdmin(actor);

  if (memberId === actor.id) {
    throw new HttpError(400, "You cannot remove your own admin access.");
  }

  const db = getDatabase();
  await ensureDatabase(db);

  await db
    .prepare(
      `UPDATE members
       SET status = 'removed', invite_code_hash = NULL
       WHERE id = ?`,
    )
    .bind(memberId)
    .run();

  await db.prepare("DELETE FROM sessions WHERE member_id = ?").bind(memberId).run();

  return getRoomState(actor);
}

export async function addClip(
  actor: CurrentMember,
  input: { url?: unknown; title?: unknown; notes?: unknown; category?: unknown },
) {
  if (typeof input.url !== "string" || !isCategory(input.category)) {
    throw new HttpError(400, "A Twitch clip URL and category are required.");
  }

  const url = input.url.trim();
  if (!getTwitchClipSlug(url)) {
    throw new HttpError(400, "Use a valid Twitch clip URL.");
  }

  const db = getDatabase();
  await ensureDatabase(db);

  const timestamp = nowIso();
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim()
      : cleanClipTitle(url);
  const notes =
    typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : "";

  const existing = await db
    .prepare("SELECT id FROM clips WHERE url = ?")
    .bind(url)
    .first<{ id: string }>();

  if (existing) {
    throw new HttpError(409, "That clip is already in the room.");
  }

  await db
    .prepare(
      `INSERT INTO clips (
        id, url, title, category, status, priority, assignee, assignee_member_id,
        notes, created_at, updated_at, created_by, claimed_at, posted_at
      )
      VALUES (?, ?, ?, ?, 'New', 0, 'Unclaimed', NULL, ?, ?, ?, ?, NULL, NULL)`,
    )
    .bind(makeId("clip"), url, title, input.category, notes, timestamp, timestamp, actor.id)
    .run();

  return getRoomState(actor);
}

async function getClip(db: D1Database, clipId: string) {
  return db.prepare("SELECT * FROM clips WHERE id = ?").bind(clipId).first<D1ClipRow>();
}

export async function toggleClipPriority(actor: CurrentMember, clipId: string) {
  requireAdmin(actor);

  const db = getDatabase();
  await ensureDatabase(db);

  const clip = await getClip(db, clipId);
  if (!clip) {
    throw new HttpError(404, "That clip was not found.");
  }

  const priority = clip.priority ? 0 : 1;
  const status =
    priority && clip.status === "New"
      ? "Prioritised"
      : !priority && clip.status === "Prioritised"
        ? "New"
        : clip.status;

  await db
    .prepare(
      `UPDATE clips
       SET priority = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(priority, status, nowIso(), clipId)
    .run();

  return getRoomState(actor);
}

export async function advanceClip(actor: CurrentMember, clipId: string) {
  const db = getDatabase();
  await ensureDatabase(db);

  const clip = await getClip(db, clipId);
  if (!clip) {
    throw new HttpError(404, "That clip was not found.");
  }

  if (
    actor.role !== "Admin" &&
    clip.assignee_member_id &&
    clip.assignee_member_id !== actor.id
  ) {
    throw new HttpError(403, "This clip is already claimed by someone else.");
  }

  const timestamp = nowIso();
  let status: ClipStatus = "Posted";
  let assignee = clip.assignee;
  let assigneeMemberId = clip.assignee_member_id;
  let claimedAt = clip.claimed_at;
  let postedAt = clip.posted_at;

  if (clip.status === "New" || clip.status === "Prioritised") {
    status = "Claimed";
    assignee = actor.email;
    assigneeMemberId = actor.id;
    claimedAt = timestamp;
  } else if (clip.status === "Claimed") {
    status = "Editing";
  } else if (clip.status === "Editing") {
    status = "Posted";
    postedAt = timestamp;
  } else {
    status = "Posted";
  }

  await db
    .prepare(
      `UPDATE clips
       SET status = ?, assignee = ?, assignee_member_id = ?,
         claimed_at = ?, posted_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(status, assignee, assigneeMemberId, claimedAt, postedAt, timestamp, clipId)
    .run();

  return getRoomState(actor);
}

export async function deleteClip(actor: CurrentMember, clipId: string) {
  requireAdmin(actor);

  const db = getDatabase();
  await ensureDatabase(db);
  await db.prepare("DELETE FROM clips WHERE id = ?").bind(clipId).run();
  return getRoomState(actor);
}

export async function setSourceChannel(actor: CurrentMember, channel: unknown) {
  requireAdmin(actor);

  if (typeof channel !== "string") {
    throw new HttpError(400, "Twitch channel is required.");
  }

  const cleanChannel = channel.trim().replace(/^@/, "").replace(/^twitch\.tv\//i, "");
  if (!cleanChannel) {
    throw new HttpError(400, "Twitch channel is required.");
  }

  const db = getDatabase();
  await ensureDatabase(db);
  await setSetting(db, "source_channel", cleanChannel);
  return getRoomState(actor);
}

async function getTwitchAccessToken() {
  const bindings = getBindings();
  if (!bindings.TWITCH_CLIENT_ID || !bindings.TWITCH_CLIENT_SECRET) {
    throw new HttpError(
      400,
      "Twitch sync needs API keys first. Manual clip links still work.",
    );
  }

  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: bindings.TWITCH_CLIENT_ID,
      client_secret: bindings.TWITCH_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });

  if (!response.ok) {
    throw new HttpError(502, "Twitch did not accept the API keys.");
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new HttpError(502, "Twitch did not return an access token.");
  }

  return data.access_token;
}

async function twitchFetch<T>(path: string, accessToken: string) {
  const bindings = getBindings();
  const response = await fetch(`https://api.twitch.tv/helix/${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": bindings.TWITCH_CLIENT_ID ?? "",
    },
  });

  if (!response.ok) {
    throw new HttpError(502, "Twitch sync failed. Try again later.");
  }

  return (await response.json()) as T;
}

export async function syncTwitchClips(actor: CurrentMember) {
  requireAdmin(actor);

  const db = getDatabase();
  await ensureDatabase(db);

  const sourceChannel = (await getSetting(db, "source_channel")) ?? defaultChannel;
  const accessToken = await getTwitchAccessToken();
  const userData = await twitchFetch<{ data: { id: string }[] }>(
    `users?login=${encodeURIComponent(sourceChannel)}`,
    accessToken,
  );
  const broadcasterId = userData.data[0]?.id;

  if (!broadcasterId) {
    throw new HttpError(404, "Twitch could not find that channel.");
  }

  const clipData = await twitchFetch<{ data: TwitchClip[] }>(
    `clips?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=20`,
    accessToken,
  );

  const timestamp = nowIso();
  const inserts = clipData.data.map((clip) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO clips (
          id, url, title, category, status, priority, assignee, assignee_member_id,
          notes, created_at, updated_at, created_by, claimed_at, posted_at
        )
        VALUES (?, ?, ?, 'other', 'New', 0, 'Unclaimed', NULL, '', ?, ?, ?, NULL, NULL)`,
      )
      .bind(
        `tw_${clip.id}`,
        clip.url,
        clip.title || "Untitled Twitch clip",
        clip.created_at || timestamp,
        timestamp,
        actor.id,
      ),
  );

  if (inserts.length > 0) {
    await db.batch(inserts);
  }

  return {
    state: await getRoomState(actor),
    imported: clipData.data.length,
  };
}
