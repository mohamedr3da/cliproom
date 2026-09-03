export type Category = "social" | "news" | "gameplay" | "other";
export type CategoryFilter = "all" | Category;
export type ClipStatus = "New" | "Prioritised" | "Claimed" | "Editing" | "Posted";
export type MemberRole = "Admin" | "Clipper";

export type Clip = {
  id: string;
  url: string;
  title: string;
  category: Category;
  status: ClipStatus;
  priority: boolean;
  assignee: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  postedAt: string | null;
};

export type Member = {
  id: string;
  email: string;
  role: MemberRole;
  addedAt: string;
  lastSeenAt: string | null;
};

export type CurrentMember = {
  id: string;
  email: string;
  role: MemberRole;
};

export type RoomState = {
  member: CurrentMember;
  clips: Clip[];
  members: Member[];
  sourceChannel: string;
  memberCount: number;
  maxMembers: number;
  twitchSyncAvailable: boolean;
};

export const maxMembers = 20;
export const defaultChannel = "rawdogmoon";
export const defaultEmbedHost = "cliproom.seven.workers.dev";

export const categories: { id: Category; label: string }[] = [
  { id: "social", label: "Social" },
  { id: "news", label: "X / News" },
  { id: "gameplay", label: "Gameplay" },
  { id: "other", label: "Other" },
];

export const filters: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All clips" },
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
    if (parsed.hostname.includes("twitch")) return "Untitled Twitch clip";
    return `Clip from ${parsed.hostname.replace("www.", "")}`;
  } catch {
    return "Untitled clip";
  }
}

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getTwitchClipSlug(url: string) {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const pathParts = parsed.pathname.split("/").filter(Boolean);

    if (host === "clips.twitch.tv") {
      return pathParts[0] ?? null;
    }

    const clipIndex = pathParts.findIndex(
      (part) => part.toLowerCase() === "clip",
    );

    if (host.endsWith("twitch.tv") && clipIndex >= 0) {
      return pathParts[clipIndex + 1] ?? null;
    }
  } catch {
    return null;
  }

  return null;
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
