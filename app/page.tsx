"use client";

import {
  CheckCircle2,
  CircleDot,
  Clapperboard,
  Clock3,
  Copy,
  Crown,
  ExternalLink,
  Flame,
  KeyRound,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Tags,
  Trash2,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import {
  categories,
  defaultEmbedHost,
  filters,
  getTwitchClipSlug,
  getTwitchEmbedUrl,
} from "@/lib/cliproom/shared";
import type {
  Category,
  CategoryFilter,
  Clip,
  ClipStatus,
  Member,
  MemberRole,
  RoomState,
} from "@/lib/cliproom/shared";

type ClipForm = {
  url: string;
  title: string;
  notes: string;
  category: Category;
};

type AuthForm = {
  email: string;
  code: string;
};

type InviteResponse = {
  state: RoomState;
  inviteCode: string;
  inviteUrl: string;
};

type SyncResponse = {
  state: RoomState;
  imported: number;
};

const emptyClipForm: ClipForm = {
  url: "",
  title: "",
  notes: "",
  category: "social",
};

const emptyClips: Clip[] = [];
const emptyMembers: Member[] = [];

const statusStyles: Record<ClipStatus, string> = {
  New: "border-[#2dd4bf]/45 bg-[#2dd4bf]/12 text-[#b9fff7]",
  Prioritised: "border-[#facc15]/45 bg-[#facc15]/12 text-[#fff4b0]",
  Claimed: "border-white/16 bg-white/8 text-white/72",
  Editing: "border-[#9146ff]/45 bg-[#9146ff]/14 text-[#e1d2ff]",
  Posted: "border-[#6ee7b7]/45 bg-[#6ee7b7]/12 text-[#c8ffe6]",
};

async function apiRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : "ClipRoom could not complete that request.";
    throw new Error(message);
  }

  return data as T;
}

function formatDate(value: string | null) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function clipActionLabel(clip: Clip, currentEmail: string, isAdmin: boolean) {
  const claimedByOther =
    clip.assignee !== "Unclaimed" && clip.assignee !== currentEmail && !isAdmin;

  if (clip.status === "Posted") return "Posted";
  if (claimedByOther) return "Claimed";
  if (clip.status === "New" || clip.status === "Prioritised") return "Claim";
  if (clip.status === "Claimed") return "Start edit";
  return "Mark posted";
}

function categoryLabel(category: Category) {
  return categories.find((item) => item.id === category)?.label ?? "Other";
}

function getInviteParams() {
  if (typeof window === "undefined") {
    return { email: "", code: "" };
  }

  const params = new URLSearchParams(window.location.search);
  return {
    email: params.get("email") ?? "",
    code: params.get("code") ?? params.get("invite") ?? "",
  };
}

export default function Home() {
  const [initialising, setInitialising] = useState(true);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [authForm, setAuthForm] = useState<AuthForm>(() => getInviteParams());
  const [authBusy, setAuthBusy] = useState(false);
  const [clipForm, setClipForm] = useState<ClipForm>(emptyClipForm);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<MemberRole>("Clipper");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [channelInput, setChannelInput] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [embedHost] = useState(() =>
    typeof window === "undefined"
      ? defaultEmbedHost
      : window.location.hostname || defaultEmbedHost,
  );

  const clips = roomState?.clips ?? emptyClips;
  const members = roomState?.members ?? emptyMembers;
  const currentMember = roomState?.member ?? null;
  const isAdmin = currentMember?.role === "Admin";

  useEffect(() => {
    let cancelled = false;
    const { email, code } = getInviteParams();

    async function initialiseRoom() {
      try {
        const nextState =
          email && code
            ? await apiRequest<RoomState>("/api/cliproom/auth", {
                method: "POST",
                body: JSON.stringify({ email, code }),
              })
            : await apiRequest<RoomState>("/api/cliproom");

        if (cancelled) return;
        setRoomState(nextState);
        setChannelInput(nextState.sourceChannel);
        setToast(email && code ? "Welcome to ClipRoom." : "Room ready.");

        if (email && code) {
          window.history.replaceState({}, "", window.location.pathname);
        }
      } catch (error) {
        if (cancelled) return;
        setRoomState(null);
        if (email && code) {
          setToast(
            error instanceof Error ? error.message : "Could not enter ClipRoom.",
          );
        }
      } finally {
        if (!cancelled) setInitialising(false);
      }
    }

    void initialiseRoom();

    return () => {
      cancelled = true;
    };
  }, []);

  function applyRoomState(nextState: RoomState) {
    setRoomState(nextState);
    setChannelInput(nextState.sourceChannel);
  }

  async function signIn(email: string, code: string, fromInvite = false) {
    setAuthBusy(true);
    setToast("");
    try {
      const nextState = await apiRequest<RoomState>("/api/cliproom/auth", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });
      applyRoomState(nextState);
      setToast("Welcome to ClipRoom.");

      if (fromInvite) {
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch (error) {
      setRoomState(null);
      setToast(error instanceof Error ? error.message : "Could not enter ClipRoom.");
    } finally {
      setAuthBusy(false);
      setInitialising(false);
    }
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await signIn(authForm.email, authForm.code);
  }

  async function signOut() {
    setBusyAction("signout");
    try {
      await apiRequest<{ ok: true }>("/api/cliproom/auth", { method: "DELETE" });
      setRoomState(null);
      setAuthForm((current) => ({ ...current, code: "" }));
      setToast("Signed out.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not sign out.");
    } finally {
      setBusyAction(null);
    }
  }

  const filteredClips = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();

    return clips.filter((clip) => {
      const matchesCategory =
        categoryFilter === "all" || clip.category === categoryFilter;

      if (!cleanQuery) return matchesCategory;

      const haystack = [
        clip.title,
        clip.url,
        clip.notes,
        clip.assignee,
        clip.status,
        clip.category,
      ]
        .join(" ")
        .toLowerCase();

      return matchesCategory && haystack.includes(cleanQuery);
    });
  }, [categoryFilter, clips, query]);

  const priorityClips = clips.filter((clip) => clip.priority);
  const counts: Record<CategoryFilter | "posted", number> = {
    all: clips.length,
    social: clips.filter((clip) => clip.category === "social").length,
    news: clips.filter((clip) => clip.category === "news").length,
    gameplay: clips.filter((clip) => clip.category === "gameplay").length,
    other: clips.filter((clip) => clip.category === "other").length,
    posted: clips.filter((clip) => clip.status === "Posted").length,
  };

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
  }

  async function copyRoomLink() {
    await copyText(window.location.origin);
    setToast("Room link copied.");
  }

  async function addClip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clipForm.url.trim()) {
      setToast("Paste a Twitch clip URL first.");
      return;
    }

    setBusyAction("add-clip");
    try {
      const nextState = await apiRequest<RoomState>("/api/cliproom/clips", {
        method: "POST",
        body: JSON.stringify(clipForm),
      });
      applyRoomState(nextState);
      setClipForm(emptyClipForm);
      setToast("Clip added to the review queue.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not add that clip.");
    } finally {
      setBusyAction(null);
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin) return;

    setBusyAction("add-member");
    try {
      const response = await apiRequest<InviteResponse>("/api/cliproom/members", {
        method: "POST",
        body: JSON.stringify({ email: memberEmail, role: memberRole }),
      });
      applyRoomState(response.state);
      await copyText(response.inviteUrl);
      setToast(`Invite link copied for ${memberEmail.trim().toLowerCase()}.`);
      setMemberEmail("");
      setMemberRole("Clipper");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not add that person.");
    } finally {
      setBusyAction(null);
    }
  }

  async function regenerateMemberInvite(member: Member) {
    if (!isAdmin) return;

    setBusyAction(`invite-${member.id}`);
    try {
      const response = await apiRequest<InviteResponse>(
        `/api/cliproom/members/${member.id}/invite`,
        { method: "POST" },
      );
      applyRoomState(response.state);
      await copyText(response.inviteUrl);
      setToast(`Fresh invite link copied for ${member.email}.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not create invite link.");
    } finally {
      setBusyAction(null);
    }
  }

  async function removeAccess(member: Member) {
    if (!isAdmin) return;

    setBusyAction(`remove-${member.id}`);
    try {
      const nextState = await apiRequest<RoomState>(
        `/api/cliproom/members/${member.id}`,
        { method: "DELETE" },
      );
      applyRoomState(nextState);
      setToast(`${member.email} removed from ClipRoom.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not remove access.");
    } finally {
      setBusyAction(null);
    }
  }

  async function togglePriority(clip: Clip) {
    if (!isAdmin) return;

    setBusyAction(`priority-${clip.id}`);
    try {
      const nextState = await apiRequest<RoomState>(`/api/cliproom/clips/${clip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "togglePriority" }),
      });
      applyRoomState(nextState);
      setToast(clip.priority ? "Clip removed from priority." : "Clip prioritised.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not update priority.");
    } finally {
      setBusyAction(null);
    }
  }

  async function advanceClip(clip: Clip) {
    setBusyAction(`advance-${clip.id}`);
    try {
      const nextState = await apiRequest<RoomState>(`/api/cliproom/clips/${clip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "advance" }),
      });
      applyRoomState(nextState);
      setToast(`${clip.title} moved forward.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not update the clip.");
    } finally {
      setBusyAction(null);
    }
  }

  async function removeClip(clip: Clip) {
    if (!isAdmin) return;

    setBusyAction(`delete-${clip.id}`);
    try {
      const nextState = await apiRequest<RoomState>(`/api/cliproom/clips/${clip.id}`, {
        method: "DELETE",
      });
      applyRoomState(nextState);
      setToast(`${clip.title} removed.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not remove the clip.");
    } finally {
      setBusyAction(null);
    }
  }

  async function saveChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin) return;

    setBusyAction("source");
    try {
      const nextState = await apiRequest<RoomState>("/api/cliproom/settings/source", {
        method: "PATCH",
        body: JSON.stringify({ channel: channelInput }),
      });
      applyRoomState(nextState);
      setToast(`Twitch source set to twitch.tv/${nextState.sourceChannel}.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not save the source.");
    } finally {
      setBusyAction(null);
    }
  }

  async function syncTwitch() {
    if (!isAdmin) return;

    setBusyAction("sync");
    try {
      const response = await apiRequest<SyncResponse>("/api/cliproom/twitch/sync", {
        method: "POST",
      });
      applyRoomState(response.state);
      setToast(`${response.imported} Twitch clips checked for the room.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not sync Twitch clips.");
    } finally {
      setBusyAction(null);
    }
  }

  if (initialising) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#0e0e10] px-6 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg bg-[#9146ff] shadow-[0_0_38px_rgba(145,70,255,0.45)]">
            <Clapperboard aria-hidden="true" size={28} />
          </div>
          <p className="text-xl font-black">Opening ClipRoom</p>
          <p className="mt-2 text-sm text-white/48">Loading the private queue.</p>
        </div>
      </main>
    );
  }

  if (!roomState || !currentMember) {
    return (
      <main className="min-h-screen bg-[#0e0e10] text-white">
        <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,rgba(145,70,255,0.3),transparent_420px)] px-4 py-10">
          <section className="w-full max-w-md rounded-lg border border-white/10 bg-[#18181b] p-5 shadow-2xl shadow-black/40">
            <div className="mb-6 flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-lg bg-[#9146ff] shadow-[0_0_34px_rgba(145,70,255,0.38)]">
                <Clapperboard aria-hidden="true" size={25} />
              </div>
              <div>
                <p className="text-xl font-black leading-6">ClipRoom</p>
                <p className="text-sm text-white/48">Private creator queue</p>
              </div>
            </div>

            <div className="mb-5">
              <div className="mb-3 inline-flex h-8 items-center gap-2 rounded-lg border border-[#2dd4bf]/35 bg-[#2dd4bf]/12 px-3 text-xs font-semibold text-[#adfff6]">
                <ShieldCheck aria-hidden="true" size={15} />
                Invite-only access
              </div>
              <h1 className="text-3xl font-black leading-tight">Enter the room.</h1>
              <p className="mt-3 text-sm leading-6 text-white/56">
                Use the email and access code from your invite. The first admin
                can enter with the setup code.
              </p>
            </div>

            <form className="space-y-3" onSubmit={handleAuth}>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-white/48">
                  Email
                </span>
                <input
                  className="h-12 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 text-base text-white outline-none placeholder:text-white/34 focus:border-[#9146ff]"
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="you@email.com"
                  type="email"
                  value={authForm.email}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-white/48">
                  Access code
                </span>
                <input
                  className="h-12 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 text-base text-white outline-none placeholder:text-white/34 focus:border-[#9146ff]"
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, code: event.target.value }))
                  }
                  placeholder="Paste code"
                  type="password"
                  value={authForm.code}
                />
              </label>
              <button
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#9146ff] text-sm font-black text-white hover:bg-[#7c3aed] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={authBusy}
                type="submit"
              >
                <KeyRound aria-hidden="true" size={18} />
                {authBusy ? "Checking access" : "Enter ClipRoom"}
              </button>
            </form>

            {toast ? (
              <div className="mt-4 rounded-lg border border-[#ffcc66]/30 bg-[#ffcc66]/10 p-3 text-sm leading-5 text-[#ffe4ab]">
                {toast}
              </div>
            ) : null}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0e0e10] text-white">
      <div className="min-h-screen bg-[linear-gradient(180deg,rgba(145,70,255,0.24),rgba(14,14,16,0)_360px)]">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0e0e10]/92 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#9146ff] shadow-[0_0_30px_rgba(145,70,255,0.35)]">
                <Clapperboard aria-hidden="true" size={22} />
              </div>
              <div className="min-w-0">
                <p className="text-base font-semibold leading-5">ClipRoom</p>
                <p className="truncate text-xs text-white/48">
                  Private creator queue
                </p>
              </div>
            </div>

            <div className="hidden min-w-0 flex-1 items-center justify-center md:flex">
              <label className="flex h-10 w-full max-w-xl items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white/54 focus-within:border-[#9146ff]/80">
                <Search aria-hidden="true" size={17} />
                <input
                  aria-label="Search clips"
                  className="h-full min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/38"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search clips, notes, assignees..."
                  value={query}
                />
              </label>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm font-bold text-white/74 hover:border-white/24 hover:text-white"
                onClick={copyRoomLink}
                type="button"
              >
                <Copy aria-hidden="true" size={16} />
                <span className="hidden sm:inline">Copy link</span>
              </button>
              <button
                className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/[0.06] text-white/64 hover:border-white/24 hover:text-white"
                disabled={busyAction === "signout"}
                onClick={signOut}
                title="Sign out"
                type="button"
              >
                <LogOut aria-hidden="true" size={17} />
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[238px_minmax(0,1fr)_340px] lg:px-8">
          <aside className="hidden lg:block">
            <section className="rounded-lg border border-white/10 bg-white/[0.055] p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Room</p>
                  <p className="text-xs text-white/42">
                    {currentMember.role} access
                  </p>
                </div>
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#2dd4bf]/14 text-[#8ff7eb]">
                  <ShieldCheck aria-hidden="true" size={15} />
                </span>
              </div>
              <div className="space-y-1.5">
                {[
                  ["Library", counts.all],
                  ["Priority", priorityClips.length],
                  ["Access", roomState.memberCount],
                  ["Posted", counts.posted],
                ].map(([label, count]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-white/58 first:bg-white/[0.07] first:text-white/78"
                  >
                    <span>{label}</span>
                    <span>{count}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-5 rounded-lg border border-[#2dd4bf]/25 bg-[#2dd4bf]/10 p-4">
              <div className="mb-3 flex items-center gap-2 text-[#bcfff7]">
                <KeyRound aria-hidden="true" size={17} />
                <p className="text-sm font-semibold">Access model</p>
              </div>
              <p className="text-xs leading-5 text-white/58">
                Trusted editors enter by email and invite code. Admins control
                priorities; clippers claim the next cut.
              </p>
            </section>
          </aside>

          <section className="min-w-0">
            <div className="mb-5 grid overflow-hidden rounded-lg border border-white/10 bg-[#18181b] lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0 p-5 sm:p-6">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#2dd4bf]/35 bg-[#2dd4bf]/12 px-3 text-xs font-semibold text-[#adfff6]">
                    <ShieldCheck aria-hidden="true" size={15} />
                    Invite-only room
                  </span>
                  <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-xs text-white/62">
                    <CircleDot aria-hidden="true" size={14} />
                    {clips.length === 1 ? "1 clip ready" : `${clips.length} clips ready`}
                  </span>
                </div>
                <h1 className="max-w-3xl text-3xl font-black leading-[1.05] sm:text-5xl">
                  Twitch clips, priorities, and claims in one private room.
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-white/58 sm:text-base">
                  Review the clip, mark what matters, and let social or news
                  clippers claim the edit without digging through chat, Discord,
                  or DMs.
                </p>
              </div>

              <div
                aria-label="ClipRoom preview artwork"
                className="min-h-[240px] bg-cover bg-center lg:min-h-full"
                role="img"
                style={{ backgroundImage: "url('/og.png')" }}
              />
            </div>

            <div className="mb-4 rounded-lg border border-white/10 bg-[#18181b] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">Clip intake</p>
                  <p className="text-xs text-white/42">
                    Paste a Twitch clip and it appears in the review queue.
                  </p>
                </div>
                <span className="hidden rounded-lg border border-white/10 bg-white/[0.055] px-3 py-1.5 text-xs text-white/50 sm:inline">
                  Source: twitch.tv/{roomState.sourceChannel}
                </span>
              </div>
              <form
                className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_220px]"
                onSubmit={addClip}
              >
                <label className="min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold text-white/48">
                    Clip URL
                  </span>
                  <input
                    aria-label="Clip URL"
                    className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none placeholder:text-white/32 focus:border-[#9146ff]"
                    onChange={(event) =>
                      setClipForm((current) => ({
                        ...current,
                        url: event.target.value,
                      }))
                    }
                    placeholder="https://clips.twitch.tv/..."
                    value={clipForm.url}
                  />
                </label>
                <label className="min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold text-white/48">
                    Title
                  </span>
                  <input
                    aria-label="Clip title"
                    className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none placeholder:text-white/32 focus:border-[#9146ff]"
                    onChange={(event) =>
                      setClipForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="What happened?"
                    value={clipForm.title}
                  />
                </label>
                <div>
                  <span className="mb-1.5 block text-xs font-semibold text-white/48">
                    Category
                  </span>
                  <div
                    aria-label="Clip category"
                    className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-white/[0.06] p-1"
                    role="radiogroup"
                  >
                    {categories.map((category) => (
                      <button
                        key={category.id}
                        aria-checked={clipForm.category === category.id}
                        className={`h-9 rounded-md px-2 text-xs font-bold ${
                          clipForm.category === category.id
                            ? "bg-[#9146ff] text-white"
                            : "text-white/52 hover:bg-white/[0.07] hover:text-white"
                        }`}
                        onClick={() =>
                          setClipForm((current) => ({
                            ...current,
                            category: category.id,
                          }))
                        }
                        role="radio"
                        type="button"
                      >
                        {category.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="min-w-0 xl:col-span-2">
                  <span className="mb-1.5 block text-xs font-semibold text-white/48">
                    Notes
                  </span>
                  <input
                    aria-label="Clip notes"
                    className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none placeholder:text-white/32 focus:border-[#9146ff]"
                    onChange={(event) =>
                      setClipForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Hook, caption idea, context, edit direction..."
                    value={clipForm.notes}
                  />
                </label>
                <button
                  className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#9146ff] px-4 text-sm font-bold text-white hover:bg-[#7c3aed] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={busyAction === "add-clip"}
                  type="submit"
                >
                  <Plus aria-hidden="true" size={17} />
                  {busyAction === "add-clip" ? "Adding" : "Add clip"}
                </button>
              </form>
            </div>

            <div className="mb-4 rounded-lg border border-white/10 bg-[#18181b] p-3 sm:p-4">
              <div className="flex flex-col gap-3 md:hidden">
                <label className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white/54">
                  <Search aria-hidden="true" size={17} />
                  <input
                    aria-label="Search clips"
                    className="h-full min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/38"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search clips..."
                    value={query}
                  />
                </label>
              </div>
              <div className="flex gap-2 overflow-x-auto">
                {filters.map((filter) => (
                  <button
                    key={filter.id}
                    aria-pressed={categoryFilter === filter.id}
                    className={`h-10 shrink-0 rounded-lg border px-4 text-sm font-semibold ${
                      categoryFilter === filter.id
                        ? "border-[#9146ff] bg-[#9146ff] text-white"
                        : "border-white/10 bg-white/[0.045] text-white/58 hover:border-white/22 hover:text-white"
                    }`}
                    onClick={() => setCategoryFilter(filter.id)}
                    type="button"
                  >
                    {filter.label}
                    <span className="ml-2 text-xs opacity-72">
                      {counts[filter.id]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {toast ? (
              <div className="mb-4 flex items-center gap-3 rounded-lg border border-[#9146ff]/35 bg-[#9146ff]/12 px-4 py-3 text-sm text-[#e8dcff]">
                <Sparkles aria-hidden="true" size={17} />
                <p>{toast}</p>
              </div>
            ) : null}

            {filteredClips.length > 0 ? (
              <div className="grid items-start gap-4 xl:grid-cols-2">
                {filteredClips.map((clip) => {
                  const embedUrl = getTwitchEmbedUrl(clip.url, embedHost);
                  const clipSlug = getTwitchClipSlug(clip.url);
                  const actionLabel = clipActionLabel(
                    clip,
                    currentMember.email,
                    isAdmin,
                  );
                  const canAdvance =
                    clip.status !== "Posted" &&
                    (isAdmin ||
                      clip.assignee === "Unclaimed" ||
                      clip.assignee === currentMember.email);

                  return (
                    <article
                      key={clip.id}
                      className="overflow-hidden rounded-lg border border-white/10 bg-[#18181b]"
                    >
                      <div className="border-b border-white/10 bg-black">
                        {embedUrl ? (
                          <iframe
                            allow="autoplay; fullscreen; picture-in-picture"
                            allowFullScreen
                            className="aspect-video w-full"
                            src={embedUrl}
                            title={`${clip.title} Twitch clip`}
                          />
                        ) : (
                          <div className="grid aspect-video place-items-center bg-[#101014] px-6 text-center">
                            <div>
                              <Clapperboard
                                aria-hidden="true"
                                className="mx-auto mb-3 text-[#9146ff]"
                                size={28}
                              />
                              <p className="text-sm font-bold text-white">
                                Preview unavailable
                              </p>
                              <p className="mt-1 text-xs text-white/44">
                                Use a Twitch clip URL to play it in the room.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="p-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded border px-2.5 py-1 text-xs font-semibold ${statusStyles[clip.status]}`}
                              >
                                {clip.status}
                              </span>
                              <span className="rounded border border-white/10 bg-white/[0.055] px-2.5 py-1 text-xs text-white/56">
                                {categoryLabel(clip.category)}
                              </span>
                            </div>
                            <h2 className="line-clamp-2 text-lg font-bold leading-6">
                              {clip.title}
                            </h2>
                            <p className="mt-2 line-clamp-2 break-words text-xs leading-[17px] text-white/38">
                              {clipSlug ? `Twitch clip: ${clipSlug}` : clip.url}
                            </p>
                          </div>
                          <button
                            aria-label={
                              clip.priority
                                ? `Remove ${clip.title} from priority`
                                : `Prioritise ${clip.title}`
                            }
                            className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border ${
                              clip.priority
                                ? "border-[#facc15]/55 bg-[#facc15] text-black"
                                : "border-white/12 bg-white/[0.055] text-white/60 hover:text-white"
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                            disabled={!isAdmin || busyAction === `priority-${clip.id}`}
                            onClick={() => togglePriority(clip)}
                            title={isAdmin ? "Toggle priority" : "Admins set priority"}
                            type="button"
                          >
                            <Star
                              aria-hidden="true"
                              fill={clip.priority ? "currentColor" : "none"}
                              size={18}
                            />
                          </button>
                        </div>

                        {clip.notes ? (
                          <p className="mb-4 line-clamp-3 rounded-lg border border-white/10 bg-white/[0.045] p-3 text-sm leading-5 text-white/58">
                            {clip.notes}
                          </p>
                        ) : null}

                        <div className="grid gap-2 text-xs text-white/50 sm:grid-cols-3">
                          <span className="flex min-w-0 items-center gap-2">
                            <Clock3 aria-hidden="true" className="shrink-0" size={14} />
                            <span className="min-w-0 truncate">
                              {formatDate(clip.createdAt)}
                            </span>
                          </span>
                          <span className="flex min-w-0 items-center gap-2">
                            <UserRound
                              aria-hidden="true"
                              className="shrink-0"
                              size={14}
                            />
                            <span className="min-w-0 truncate">{clip.assignee}</span>
                          </span>
                          <span className="flex min-w-0 items-center gap-2">
                            <Tags aria-hidden="true" className="shrink-0" size={14} />
                            <span>{clip.priority ? "Priority" : "Normal"}</span>
                          </span>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
                          <button
                            className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-3 text-sm font-bold text-[#18181b] hover:bg-[#efe7ff] disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={!canAdvance || busyAction === `advance-${clip.id}`}
                            onClick={() => advanceClip(clip)}
                            type="button"
                          >
                            <CheckCircle2 aria-hidden="true" size={16} />
                            {actionLabel}
                          </button>
                          <a
                            className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.055] px-3 text-sm font-bold text-white/72 hover:border-white/24 hover:text-white"
                            href={clip.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <ExternalLink aria-hidden="true" size={16} />
                            Open on Twitch
                          </a>
                          {isAdmin ? (
                            <button
                              className="ml-auto grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/[0.045] text-white/48 hover:border-[#ff6b6b]/40 hover:text-[#ffb4b4] disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={busyAction === `delete-${clip.id}`}
                              onClick={() => removeClip(clip)}
                              title="Remove clip"
                              type="button"
                            >
                              <Trash2 aria-hidden="true" size={16} />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-[#18181b] p-10 text-center">
                <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-lg bg-[#9146ff]/16 text-[#dac8ff]">
                  <Clapperboard aria-hidden="true" size={26} />
                </div>
                <p className="text-xl font-black">No clips found</p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/50">
                  Try a different search or category.
                </p>
              </div>
            )}
          </section>

          <aside className="space-y-5">
            <section className="rounded-lg border border-white/10 bg-[#18181b] p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Access list</p>
                  <p className="text-xs text-white/44">
                    {roomState.memberCount}/{roomState.maxMembers} people
                  </p>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#2dd4bf]/14 text-[#adfff6]">
                  <Mail aria-hidden="true" size={18} />
                </span>
              </div>

              {isAdmin ? (
                <>
                  <form className="space-y-3" onSubmit={addMember}>
                    <input
                      aria-label="Member email"
                      className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none placeholder:text-white/32 focus:border-[#2dd4bf]"
                      onChange={(event) => setMemberEmail(event.target.value)}
                      placeholder="editor@email.com"
                      type="email"
                      value={memberEmail}
                    />
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <div
                        aria-label="Member role"
                        className="grid h-11 grid-cols-2 gap-1 rounded-lg border border-white/10 bg-white/[0.06] p-1"
                        role="radiogroup"
                      >
                        {(["Clipper", "Admin"] as MemberRole[]).map((role) => (
                          <button
                            key={role}
                            aria-checked={memberRole === role}
                            className={`rounded-md px-2 text-xs font-bold ${
                              memberRole === role
                                ? "bg-[#2dd4bf] text-[#071b19]"
                                : "text-white/52 hover:bg-white/[0.07] hover:text-white"
                            }`}
                            onClick={() => setMemberRole(role)}
                            role="radio"
                            type="button"
                          >
                            {role}
                          </button>
                        ))}
                      </div>
                      <button
                        className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#2dd4bf] px-4 text-sm font-black text-[#071b19] hover:bg-[#5eeadd] disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={busyAction === "add-member"}
                        type="submit"
                      >
                        <Plus aria-hidden="true" size={17} />
                        Add
                      </button>
                    </div>
                  </form>

                  <div className="mt-4 space-y-2">
                    {members.map((member) => (
                      <div
                        key={member.id}
                        className="rounded-lg border border-white/10 bg-white/[0.045] p-3"
                      >
                        <div className="mb-3 flex items-center gap-3">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10">
                            {member.role === "Admin" ? (
                              <Crown aria-hidden="true" size={16} />
                            ) : (
                              <UserRound aria-hidden="true" size={16} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">
                              {member.email}
                            </p>
                            <p className="text-xs text-white/40">
                              {member.role} - added {formatDate(member.addedAt)}
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-[1fr_auto] gap-2">
                          <button
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.055] px-3 text-xs font-bold text-white/70 hover:border-white/24 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={busyAction === `invite-${member.id}`}
                            onClick={() => regenerateMemberInvite(member)}
                            type="button"
                          >
                            <Copy aria-hidden="true" size={14} />
                            Invite
                          </button>
                          <button
                            className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.045] text-white/48 hover:border-[#ff6b6b]/40 hover:text-[#ffb4b4] disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={
                              currentMember.id === member.id ||
                              busyAction === `remove-${member.id}`
                            }
                            onClick={() => removeAccess(member)}
                            title="Remove access"
                            type="button"
                          >
                            <Trash2 aria-hidden="true" size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-white/10 bg-white/[0.045] p-4 text-sm leading-6 text-white/54">
                  Access is managed by admins. Your queue updates here as clips
                  are added, claimed, and posted.
                </div>
              )}
            </section>

            <section className="rounded-lg border border-white/10 bg-[#18181b] p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Twitch source</p>
                  <p className="text-xs text-white/44">
                    twitch.tv/{roomState.sourceChannel}
                  </p>
                </div>
                <Clapperboard
                  aria-hidden="true"
                  className="text-[#9146ff]"
                  size={24}
                />
              </div>
              <form className="space-y-3" onSubmit={saveChannel}>
                <label className="flex h-11 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white/54 focus-within:border-[#9146ff]">
                  <span className="text-white/36">twitch.tv/</span>
                  <input
                    aria-label="Twitch channel"
                    className="h-full min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30 disabled:text-white/48"
                    disabled={!isAdmin}
                    onChange={(event) => setChannelInput(event.target.value)}
                    placeholder="channel"
                    value={channelInput}
                  />
                </label>
                {isAdmin ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <button
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#9146ff] text-sm font-bold text-white hover:bg-[#7c3aed] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busyAction === "source"}
                      type="submit"
                    >
                      <RefreshCw aria-hidden="true" size={17} />
                      Set source
                    </button>
                    <button
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.055] px-3 text-sm font-bold text-white/70 hover:border-white/24 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={busyAction === "sync"}
                      onClick={syncTwitch}
                      type="button"
                    >
                      <Clapperboard aria-hidden="true" size={17} />
                      Sync clips
                    </button>
                  </div>
                ) : null}
              </form>
            </section>

            <section className="rounded-lg border border-white/10 bg-[#18181b] p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Priority queue</p>
                  <p className="text-xs text-white/44">
                    {priorityClips.length} selected
                  </p>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#ffcc66]/14 text-[#ffe2a3]">
                  <Flame aria-hidden="true" size={18} />
                </span>
              </div>
              <div className="space-y-2">
                {priorityClips.map((clip, index) => (
                  <div
                    key={clip.id}
                    className="rounded-lg border border-white/10 bg-white/[0.045] p-3"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="grid h-6 w-6 place-items-center rounded-md bg-white text-xs font-black text-[#18181b]">
                        {index + 1}
                      </span>
                      <span className="text-xs text-white/42">{clip.status}</span>
                    </div>
                    <p className="line-clamp-3 text-sm font-semibold leading-5">
                      {clip.title}
                    </p>
                  </div>
                ))}
                {priorityClips.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/16 p-4 text-center text-sm text-white/42">
                    No priority clips.
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-lg border border-[#ffcc66]/25 bg-[#ffcc66]/10 p-4">
              <div className="mb-3 flex items-center gap-2 text-[#ffe2a3]">
                <CheckCircle2 aria-hidden="true" size={18} />
                <p className="text-sm font-semibold">Clip workflow</p>
              </div>
              <p className="text-xs leading-5 text-white/58">
                Add clips, pick priorities, let clippers claim edits, then track
                what has already been posted.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
