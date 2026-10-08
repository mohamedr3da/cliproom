export type Category = "social" | "news" | "gameplay" | "other";
export type ClipIntakeSource = "manual" | "trusted_sync";
export type CategoryFilter = "all" | "saved" | "trusted" | Category;
export type ClipStatus = "New" | "Prioritised" | "Claimed" | "Editing" | "Posted";
export type MemberRole = "Admin" | "Clipper";

export type Clip = {
  id: string;
  url: string;
  title: string;
  category: Category;
  intakeSource: ClipIntakeSource;
  twitchCreatorLogin: string | null;
  status: ClipStatus;
  priority: boolean;
  saved: boolean;
  assignee: string;
  notes: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  postedAt: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
};

export type Collection = {
  id: string;
  title: string;
  category: Category;
  status: ClipStatus;
  priority: boolean;
  saved: boolean;
  assignee: string;
  notes: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  postedAt: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  clips: Clip[];
};

export type Member = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: MemberRole;
  addedAt: string;
  lastSeenAt: string | null;
};

export type CurrentMember = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: MemberRole;
};

export type RoomState = {
  member: CurrentMember;
  clips: Clip[];
  collections: Collection[];
  trash?: { clips: Clip[]; collections: Collection[] };
  members: Member[];
  sourceChannel: string;
  trustedClipperLogins: string[];
  memberCount: number;
  onlineMemberCount: number;
  maxMembers: number;
  twitchSyncAvailable: boolean;
};

export type AuthStatus = {
  configured: boolean;
  needsSetup: boolean;
};

export type RoomMutation = {
  kind: "mutation";
  clips: Clip[];
  collections: Collection[];
  removedClipIds: string[];
  removedCollectionIds: string[];
};

export type AuditLogEntry = {
  id: string;
  action: string;
  actorUsername: string;
  actorRole: MemberRole | null;
  targetKind: "clip" | "collection" | "member" | "room";
  targetId: string | null;
  targetTitle: string | null;
  metadata: string | null;
  createdAt: string;
};

export type AuditLogResponse = {
  logs: AuditLogEntry[];
};

export const maxMembers = 20;
export const defaultChannel = "rawdogmoon";
export const defaultEmbedHost = "cliproom.sevencliproom.workers.dev";
export const maxClipUrlLength = 1000;
export const maxClipTitleLength = 120;
export const maxClipNotesLength = 92;
export const maxCollectionTitleLength = 120;
export const maxCollectionNotesLength = 92;
export const maxTaskTitleSegmentLength = 14;
export const maxTwitchLoginLength = 25;
export const maxTrustedClippers = 20;
export const maxTrustedClippersTextLength = 600;
export const defaultTaskNotes = "N/A";
export const auditLogRetentionDays = 90;
export const deletedTaskRetentionDays = 7;

export function normaliseTaskNotes(value: unknown) {
  const notes = typeof value === "string" ? value.trim() : "";
  return notes || defaultTaskNotes;
}

export function normaliseTaskTitle(value: unknown, fallback = "Clip", maxLength = maxClipTitleLength) {
  const rawTitle = typeof value === "string" ? value.trim() : "";
  const title = rawTitle || fallback;
  if (title.length <= maxLength) return title;
  return `${title.slice(0, maxLength - 3).trimEnd()}...`;
}

export function formatTaskTitleForDisplay(value: string) {
  return value
    .split(/(\s+)/)
    .map((part) => {
      if (!part.trim() || Array.from(part).length <= maxTaskTitleSegmentLength) return part;

      const characters = Array.from(part);
      const chunks: string[] = [];
      for (let index = 0; index < characters.length; index += maxTaskTitleSegmentLength) {
        chunks.push(characters.slice(index, index + maxTaskTitleSegmentLength).join(""));
      }
      return chunks.join("\u200B");
    })
    .join("");
}

export function getTwitchOAuthRedirectUri(requestUrl: string | URL) {
  const url = typeof requestUrl === "string" ? new URL(requestUrl) : requestUrl;
  return url.origin;
}

export const categories: { id: Category; label: string }[] = [
  { id: "social", label: "Social" },
  { id: "news", label: "X / News" },
  { id: "gameplay", label: "Gameplay" },
  { id: "other", label: "Other" },
];

export const filters: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All clips" },
  { id: "saved", label: "Saved" },
  { id: "trusted", label: "Trusted clippers" },
  ...categories,
];

export function isCategory(value: unknown): value is Category {
  return categories.some((category) => category.id === value);
}

export function isRole(value: unknown): value is MemberRole {
  return value === "Admin" || value === "Clipper";
}

export function cleanClipTitle(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("twitch")) return "Twitch clip";
    if (getKickClipId(url)) return "Kick clip";
    return `Clip from ${parsed.hostname.replace("www.", "")}`;
  } catch {
    return "Clip";
  }
}

export function normaliseTwitchLogin(login: string) {
  return login
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, "")
    .replace(/^twitch\.tv\//i, "")
    .split(/[/?#]/)[0]
    .toLowerCase();
}

export function isValidTwitchLogin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^[a-z0-9_]{1,25}$/.test(normaliseTwitchLogin(value));
}

export function parseTwitchLogins(value: string) {
  const unique = new Set<string>();

  for (const part of value.split(/[,\s]+/)) {
    const login = normaliseTwitchLogin(part);
    if (login && /^[a-z0-9_]{1,25}$/.test(login)) unique.add(login);
  }

  return Array.from(unique);
}

export function getTwitchClipSlug(url: string) {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const pathParts = parsed.pathname.split("/").filter(Boolean);

    if (host === "clips.twitch.tv") return pathParts[0] ?? null;

    const clipIndex = pathParts.findIndex((part) => part.toLowerCase() === "clip");
    if ((host === "twitch.tv" || host.endsWith(".twitch.tv")) && clipIndex >= 0) {
      return pathParts[clipIndex + 1] ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

export function twitchClipUrlsMatch(leftUrl: string, rightUrl: string) {
  const leftSlug = getTwitchClipSlug(leftUrl);
  const rightSlug = getTwitchClipSlug(rightUrl);
  if (leftSlug && rightSlug) return leftSlug === rightSlug;
  return leftUrl.trim() === rightUrl.trim();
}

export function getKickClipId(url: string) {
  try {
    const parsed = new URL(url.trim());
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.port) return null;
    if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== "kick.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (!/^[\w-]+$/.test(parts[0] ?? "")) return null;
    const id = parts.length === 3 && parts[1] === "clips" ? parts[2] : parts.length === 1 ? parsed.searchParams.get("clip") : null;
    return id && /^clip_[\w-]+$/.test(id) ? id : null;
  } catch { return null; }
}

export function getKickChannelSlug(url: string) {
  try {
    const parsed = new URL(url.trim());
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.port) return null;
    if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== "kick.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const hasCanonicalClip = parts.length === 3 && parts[1] === "clips" && /^clip_[\w-]+$/.test(parts[2] ?? "");
    const hasLegacyClip = parts.length === 1 && /^clip_[\w-]+$/.test(parsed.searchParams.get("clip") ?? "");
    if (!hasCanonicalClip && !hasLegacyClip) return null;
    const channel = parts[0]?.toLowerCase();
    return channel && /^[a-z0-9_-]+$/.test(channel) ? channel : null;
  } catch { return null; }
}

export function getClipPlatform(url: string): "Twitch" | "Kick" | null {
  if (getKickClipId(url)) return "Kick";
  try {
    const parsed = new URL(url.trim());
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.port) return null;
    return getTwitchClipSlug(url) ? "Twitch" : null;
  } catch { return null; }
}

export function isSupportedClipUrl(url: string) {
  return getClipPlatform(url) !== null;
}

export function supportedClipUrlsMatch(leftUrl: string, rightUrl: string) {
  const leftKickId = getKickClipId(leftUrl);
  const rightKickId = getKickClipId(rightUrl);
  if (leftKickId || rightKickId) return Boolean(leftKickId && rightKickId && leftKickId === rightKickId);
  return twitchClipUrlsMatch(leftUrl, rightUrl);
}

export function getClipEmbedUrl(url: string, parentHost: string) {
  return getTwitchEmbedUrl(url, parentHost);
}

export function collectionClipLabel(clip: Pick<Clip, "title">, index: number) {
  const cleanTitle = clip.title.trim();
  if (cleanTitle && !/^untitled (twitch|kick) clip$/i.test(cleanTitle)) return cleanTitle;
  return `Clip ${index + 1}`;
}

export function getTwitchEmbedUrl(url: string, parentHost: string) {
  const slug = getTwitchClipSlug(url);
  if (!slug || !parentHost) return null;

  const params = new URLSearchParams({
    clip: slug,
    parent: parentHost,
    autoplay: "false",
  });

  return `https://clips.twitch.tv/embed?${params.toString()}`;
}
