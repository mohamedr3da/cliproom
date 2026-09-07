import { maxClipTitleLength, normaliseTaskTitle } from "./shared.ts";

export type KickMetadata = {
  title: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
};

export type KickPlayback = KickMetadata & { mediaUrl: string };

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function title(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? normaliseTaskTitle(value, "Kick clip", maxClipTitleLength) : null;
}

export function parseKickMetadata(payload: unknown): KickMetadata {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const clip = root.clip && typeof root.clip === "object" ? root.clip as Record<string, unknown> : root;
  return {
    title: title(clip.title),
    mediaUrl: httpsUrl(clip.clip_url) ?? httpsUrl(clip.video_url),
    thumbnailUrl: httpsUrl(clip.thumbnail_url) ?? httpsUrl(clip.thumbnail),
  };
}

export function mergeKickMetadata(first: KickMetadata, next: KickMetadata): KickMetadata {
  return {
    title: first.title ?? next.title,
    mediaUrl: first.mediaUrl ?? next.mediaUrl,
    thumbnailUrl: first.thumbnailUrl ?? next.thumbnailUrl,
  };
}

export function requireKickPlayback(payload: unknown): KickPlayback {
  const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const mediaUrl = httpsUrl(data.mediaUrl);
  if (!mediaUrl) throw new Error("Kick did not return playable media for this clip. Try again or open it on Kick.");
  return { mediaUrl, title: title(data.title), thumbnailUrl: httpsUrl(data.thumbnailUrl) };
}

export function isHlsMediaUrl(mediaUrl: string): boolean {
  return /\.m3u8$/i.test(new URL(mediaUrl).pathname);
}
export type KickChannelClipPage = {
  metadata: KickMetadata | null;
  nextCursor: string | null;
};

function cursorValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object" && "id" in value) return cursorValue((value as Record<string, unknown>).id);
  return null;
}

function recordMatchesKickClip(record: Record<string, unknown>, clipId: string) {
  for (const key of ["id", "clip_id", "uuid"]) {
    if (record[key] === clipId) return true;
  }
  for (const key of ["clip_url", "video_url"]) {
    const value = record[key];
    if (typeof value !== "string") continue;
    try {
      const pathname = new URL(value).pathname.split("/").filter(Boolean);
      if (pathname.includes(clipId)) return true;
    } catch {
      // Ignore malformed media URLs and keep looking for a matching record.
    }
  }
  return false;
}

export function parseKickChannelClipMetadata(payload: unknown, clipId: string): KickChannelClipPage {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const clips = Array.isArray(root.clips) ? root.clips : [];
  const match = clips.find((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && recordMatchesKickClip(item as Record<string, unknown>, clipId)));
  return {
    metadata: match ? parseKickMetadata(match) : null,
    nextCursor: cursorValue(root.nextCursor ?? root.next_cursor),
  };
}
