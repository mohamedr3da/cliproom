"use client";
/* eslint-disable @next/next/no-img-element */

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  ClipboardList,
  Crown,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { CollectionCard } from "@/components/cliproom/CollectionCard";
import {
  CollectionIntake,
  type CollectionCreateInput,
} from "@/components/cliproom/CollectionIntake";
import { ClipPreviewProvider } from "@/components/cliproom/ClipPreviewProvider";
import { formatUserDate } from "@/components/cliproom/date-format";
import { QueueSearchControls } from "@/components/cliproom/QueueSearchControls";
import { RecentlyDeleted } from "@/components/cliproom/RecentlyDeleted";
import { applyRoomMutation, type ClientRoomMutation } from "@/lib/cliproom/room-mutations";
import { StandaloneClipCard } from "@/components/cliproom/StandaloneClipCard";
import {
  defaultQueueViewOptions,
  type QueueViewOptions,
  type QueueTask,
  sortQueueTasks,
  parseTaskLinkTarget,
  taskDomId,
  taskMatchesOptions,
  getQueueCounts,
  getQueueTasks,
  taskMatchesFilter,
  taskMatchesQuery,
} from "@/lib/cliproom/task-helpers";
import {
  categories,
  deletedTaskRetentionDays,
  defaultEmbedHost,
  filters,
  maxClipNotesLength,
  maxClipTitleLength,
  maxClipUrlLength,
  maxTrustedClippersTextLength,
  maxTwitchLoginLength,
  normaliseTaskNotes,
  supportedClipUrlsMatch,
} from "@/lib/cliproom/shared";
import type {
  AuthStatus,
  Category,
  CategoryFilter,
  Clip,
  Collection,
  Member,
  MemberRole,
  RoomState,
  RoomMutation,
} from "@/lib/cliproom/shared";

type ClipForm = {
  url: string;
  title: string;
  notes: string;
  category: Category;
};

type TwitchStartResponse = {
  authorizationUrl: string;
};

type SyncResponse = {
  state: RoomState;
  checked: number;
  matched: number;
  imported: number;
};

const emptyClipForm: ClipForm = {
  url: "",
  title: "",
  notes: "",
  category: "social",
};

const emptyClips: Clip[] = [];
const emptyCollections: Collection[] = [];
const emptyMembers: Member[] = [];
const rightPanelsStorageKey = "cliproom:right-panels-collapsed";
const pendingTaskLinkStorageKey = "cliproom:pending-task-link";

function taskSelectionKey(task: QueueTask) {
  return task.kind === "clip"
    ? `clip:${task.clip.id}`
    : `collection:${task.collection.id}`;
}

function taskSelectionTitle(task: QueueTask) {
  return task.kind === "clip" ? task.clip.title : task.collection.title;
}

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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
    throw new ApiError(response.status, message);
  }

  return data as T;
}

let taskRequestSequence = 0;
let pendingTaskRequests = 0;
async function apiTaskRequest(path: string, init: RequestInit) {
  const clientSequence = ++taskRequestSequence;
  pendingTaskRequests++;
  try {
    const response = await apiRequest<RoomState | RoomMutation>(path, { ...init, headers: { ...init.headers, "X-ClipRoom-Mutation": "1" } });
    return "kind" in response ? { ...response, clientSequence } : response;
  } finally { pendingTaskRequests--; }
}

function submitParentFormOnEnter(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

export default function Home() {
  const [initialising, setInitialising] = useState(true);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [clipForm, setClipForm] = useState<ClipForm>(emptyClipForm);
  const [memberUsername, setMemberUsername] = useState("");
  const [memberRole, setMemberRole] = useState<MemberRole>("Clipper");
  const [query, setQuery] = useState("");
  const [viewOptions, setViewOptions] = useState<QueueViewOptions>({ ...defaultQueueViewOptions });
  const [lastDeleted, setLastDeleted] = useState<{ kind: "clip" | "collection"; id: string; title: string } | null>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<Clip | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [channelInput, setChannelInput] = useState("");
  const [trustedClippersInput, setTrustedClippersInput] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [intakeMode, setIntakeMode] = useState<"clip" | "collection" | null>(null);
  const [rightPanelsCollapsed, setRightPanelsCollapsed] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTaskKeys, setSelectedTaskKeys] = useState<Set<string>>(() => new Set());
  const handledTaskLinkRef = useRef<string | null>(null);
  const [embedHost] = useState(() =>
    typeof window === "undefined"
      ? defaultEmbedHost
      : window.location.hostname || defaultEmbedHost,
  );

  const clips = roomState?.clips ?? emptyClips;
  const collections = roomState?.collections ?? emptyCollections;
  const members = roomState?.members ?? emptyMembers;
  const currentMember = roomState?.member ?? null;
  const isAdmin = currentMember?.role === "Admin";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        setRightPanelsCollapsed(window.localStorage.getItem(rightPanelsStorageKey) === "true");
      } catch {
        // Local storage is optional; the sidebar still works for this session.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialiseRoom() {
      const searchParams = new URLSearchParams(window.location.search);
      if (
        searchParams.has("state") &&
        (searchParams.has("code") || searchParams.has("error"))
      ) {
        const callbackUrl = new URL(
          "/api/cliproom/auth/twitch/callback",
          window.location.origin,
        );
        callbackUrl.search = window.location.search;
        window.location.replace(callbackUrl.toString());
        return;
      }

      const authError = searchParams.get("auth_error");
      const requestedTask = searchParams.get("task");
      if (requestedTask) {
        try { window.sessionStorage.setItem(pendingTaskLinkStorageKey, requestedTask); } catch { /* optional */ }
      }

      try {
        const nextState = await apiRequest<RoomState>("/api/cliproom");
        if (cancelled) return;
        setRoomState(nextState);
        setChannelInput(nextState.sourceChannel);
        setTrustedClippersInput(nextState.trustedClipperLogins.join(", "));
        setToast("Room ready.");
      } catch (error) {
        if (cancelled) return;
        setRoomState(null);
        try {
          const status = await apiRequest<AuthStatus>("/api/cliproom/auth");
          if (!cancelled) setAuthStatus(status);
        } catch (statusError) {
          if (!cancelled) {
            setToast(
              statusError instanceof Error
                ? statusError.message
                : "Could not check Twitch login.",
            );
          }
        }

        if (authError) {
          const messages: Record<string, string> = {
            cancelled: "Twitch sign-in was cancelled.",
            not_invited: "This Twitch account does not have access to this ClipRoom.",
            setup_changed: "The first-admin setup changed. Try signing in again.",
            expired: "That Twitch sign-in expired. Try again.",
            rate_limited: "Too many sign-in attempts. Try again in a minute.",
            twitch_failed: "Twitch sign-in could not be completed. Try again.",
          };
          setToast(messages[authError] ?? "Twitch sign-in could not be completed.");
          window.history.replaceState({}, "", window.location.pathname);
        } else if (!(error instanceof ApiError && error.status === 401)) {
          setToast(error instanceof Error ? error.message : "Could not open ClipRoom.");
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

  useEffect(() => {
    if (!roomState?.member.id) return;

    let checking = false;
    async function recheckAccess() {
      if (checking) return;
      checking = true;
      const sequence = taskRequestSequence;
      const wasMutating = pendingTaskRequests > 0;
      try {
        const nextState = await apiRequest<RoomState>("/api/cliproom");
        if (wasMutating || pendingTaskRequests > 0 || sequence !== taskRequestSequence) return;
        setRoomState(nextState);
        setChannelInput(nextState.sourceChannel);
        setTrustedClippersInput(nextState.trustedClipperLogins.join(", "));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setRoomState(null);
          try {
            setAuthStatus(await apiRequest<AuthStatus>("/api/cliproom/auth"));
          } catch {
            setAuthStatus(null);
          }
          setToast("You no longer have access to this ClipRoom.");
        }
      } finally {
        checking = false;
      }
    }

    window.addEventListener("focus", recheckAccess);
    return () => window.removeEventListener("focus", recheckAccess);
  }, [roomState?.member.id]);

  useEffect(() => {
    if (!roomState) return;
    const expiries = [...roomState.clips, ...roomState.collections]
      .filter((task) => task.status === "Posted" && task.postedAt)
      .map((task) => Date.parse(task.postedAt!) + 24 * 60 * 60 * 1000)
      .concat([...(roomState.trash?.clips ?? []), ...(roomState.trash?.collections ?? [])].map((task) => Date.parse(task.deletedAt ?? "") + deletedTaskRetentionDays * 24 * 60 * 60 * 1000))
      .filter(Number.isFinite);
    if (!expiries.length) return;
    let cancelled = false;
    let timer: number;
    async function refreshAfterExpiry() {
      const sequence = taskRequestSequence;
      const wasMutating = pendingTaskRequests > 0;
      try {
        const nextState = await apiRequest<RoomState>("/api/cliproom");
        if (wasMutating || pendingTaskRequests > 0 || sequence !== taskRequestSequence) {
          if (!cancelled) timer = window.setTimeout(refreshAfterExpiry, 1000);
          return;
        }
        if (!cancelled) setRoomState(nextState);
      } catch {
        if (!cancelled) timer = window.setTimeout(refreshAfterExpiry, 60000);
      }
    }
    timer = window.setTimeout(refreshAfterExpiry, Math.min(2147483647, Math.max(1000, Math.min(...expiries) - Date.now() + 1000)));
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [roomState]);

  function applyRoomState(nextState: RoomState | ClientRoomMutation) {
    if ("kind" in nextState && nextState.kind === "mutation") {
      setRoomState((current) => current ? applyRoomMutation(current, nextState) : current);
      return;
    }
    if (!("member" in nextState)) return;
    setRoomState(nextState);
    setChannelInput(nextState.sourceChannel);
    setTrustedClippersInput(nextState.trustedClipperLogins.join(", "));
  }

  function updateTaskOptimistically(task: Clip | Collection, changes: Partial<Clip>) {
    const optimisticTask = { ...task, ...changes };
    const isCollection = "clips" in task;
    setRoomState((current) => current ? isCollection
      ? { ...current, collections: current.collections.map((item) => item.id === task.id ? optimisticTask as Collection : item) }
      : { ...current, clips: current.clips.map((item) => item.id === task.id ? optimisticTask as Clip : item) }
      : current);
    return () => setRoomState((current) => current ? isCollection
      ? { ...current, collections: current.collections.map((item) => item === optimisticTask ? task as Collection : item) }
      : { ...current, clips: current.clips.map((item) => item === optimisticTask ? task as Clip : item) }
      : current);
  }

  async function handleTwitchAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authStatus?.configured) return;

    setAuthBusy(true);
    setToast("");
    try {
      const response = await apiRequest<TwitchStartResponse>(
        "/api/cliproom/auth/twitch",
        {
          method: "POST",
          body: JSON.stringify({ setupCode: authStatus.needsSetup ? setupCode : undefined }),
        },
      );
      window.location.assign(response.authorizationUrl);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not start Twitch sign-in.");
      setAuthBusy(false);
    }
  }

  async function signOut() {
    setBusyAction("signout");
    try {
      await apiRequest<{ ok: true }>("/api/cliproom/auth", { method: "DELETE" });
      const status = await apiRequest<AuthStatus>("/api/cliproom/auth");
      setAuthStatus(status);
      setRoomState(null);
      setSetupCode("");
      setToast("Signed out.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not sign out.");
    } finally {
      setBusyAction(null);
    }
  }

  const queueTasks = useMemo(
    () => getQueueTasks({ clips, collections }),
    [clips, collections],
  );
  const filteredTasks = useMemo(
    () =>
      sortQueueTasks(queueTasks.filter(
        (task) =>
          taskMatchesFilter(task, categoryFilter, currentMember?.username ?? "") && taskMatchesQuery(task, query) && taskMatchesOptions(task, viewOptions, currentMember?.username ?? ""),
      ), viewOptions.sort),
    [categoryFilter, query, queueTasks, viewOptions, currentMember?.username],
  );
  const hasViewOptions = Object.keys(defaultQueueViewOptions).some((key) => viewOptions[key as keyof QueueViewOptions] !== defaultQueueViewOptions[key as keyof QueueViewOptions]);
  const queueCounts = useMemo(() => getQueueCounts(queueTasks, currentMember?.username ?? ""), [queueTasks, currentMember?.username]);
  const priorityTasks = useMemo(
    () =>
      queueTasks.filter((task) =>
        task.kind === "clip" ? task.clip.priority : task.collection.priority,
      ),
    [queueTasks],
  );
  const counts: Record<CategoryFilter | "posted", number> = {
    all: queueCounts.all,
    saved: queueCounts.saved,
    trusted: queueCounts.trusted,
    social: queueCounts.social,
    news: queueCounts.news,
    gameplay: queueCounts.gameplay,
    other: queueCounts.other,
    posted: queueCounts.posted,
  };

  useEffect(() => {
    if (!roomState || !currentMember) return;

    const searchParams = new URLSearchParams(window.location.search);
    let rawTarget = searchParams.get("task");
    if (!rawTarget) {
      try { rawTarget = window.sessionStorage.getItem(pendingTaskLinkStorageKey); } catch { rawTarget = null; }
    }
    if (!rawTarget || handledTaskLinkRef.current === rawTarget) return;

    const target = parseTaskLinkTarget(rawTarget);
    if (!target) {
      handledTaskLinkRef.current = rawTarget;
      try { window.sessionStorage.removeItem(pendingTaskLinkStorageKey); } catch { /* optional */ }
      return;
    }

    const matchedTask = queueTasks.find((task) =>
      target.kind === task.kind && (task.kind === "clip" ? task.clip.id : task.collection.id) === target.id,
    );
    if (!matchedTask) return;

    handledTaskLinkRef.current = rawTarget;
    try { window.sessionStorage.removeItem(pendingTaskLinkStorageKey); } catch { /* optional */ }

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      setQuery("");
      setViewOptions({ ...defaultQueueViewOptions });
      setCategoryFilter(taskMatchesFilter(matchedTask, "trusted", currentMember.username) ? "trusted" : "all");
      secondFrame = window.requestAnimationFrame(() => {
        const element = document.getElementById(taskDomId(target.kind, target.id));
        if (!element) return;
        element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        element.classList.remove("task-link-highlight");
        void element.getBoundingClientRect();
        element.classList.add("task-link-highlight");
        window.setTimeout(() => element.classList.remove("task-link-highlight"), 2400);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [currentMember, queueTasks, roomState]);


  async function addClip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!clipForm.url.trim()) {
      setToast("Paste a Twitch or Kick clip URL first.");
      return;
    }

    const deletedMatch = roomState?.trash?.clips.find((clip) =>
      supportedClipUrlsMatch(clip.url, clipForm.url.trim()),
    );
    if (deletedMatch) {
      setRestoreCandidate(deletedMatch);
      setToast("");
      return;
    }

    setRestoreCandidate(null);
    setBusyAction("add-clip");
    try {
      const nextState = await apiTaskRequest("/api/cliproom/clips", {
        method: "POST",
        body: JSON.stringify({
          ...clipForm,
          notes: normaliseTaskNotes(clipForm.notes),
        }),
      });
      applyRoomState(nextState);
      setClipForm(emptyClipForm);
      setIntakeMode(null);
      setToast("Clip added to the library.");
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
      const nextState = await apiRequest<RoomState>("/api/cliproom/members", {
        method: "POST",
        body: JSON.stringify({ username: memberUsername, role: memberRole }),
      });
      applyRoomState(nextState);
      const addedUsername = memberUsername.trim().replace(/^@+/, "").toLowerCase();
      setToast(`@${addedUsername} can now sign in with Twitch.`);
      setMemberUsername("");
      setMemberRole("Clipper");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not add that Twitch user.");
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
      setToast(`@${member.username} removed from ClipRoom.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not remove access.");
    } finally {
      setBusyAction(null);
    }
  }

  async function togglePriority(clip: Clip) {
    if (!isAdmin) return;

    setBusyAction(`priority-${clip.id}`);
    const rollback = updateTaskOptimistically(clip, { priority: !clip.priority, status: clip.status === "New" ? "Prioritised" : clip.status === "Prioritised" ? "New" : clip.status });
    try {
      const nextState = await apiTaskRequest(`/api/cliproom/clips/${clip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "togglePriority" }),
      });
      applyRoomState(nextState);
      setToast(clip.priority ? "Clip removed from priority." : "Clip prioritised.");
    } catch (error) {
      rollback();
      setToast(error instanceof Error ? error.message : "Could not update priority.");
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleSavedClip(clip: Clip) {
    setBusyAction(`save-${clip.id}`);
    const rollback = updateTaskOptimistically(clip, { saved: !clip.saved });
    try {
      const nextState = await apiTaskRequest(`/api/cliproom/clips/${clip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "toggleSaved" }),
      });
      applyRoomState(nextState);
      setToast(clip.saved ? "Clip removed from Saved." : "Clip saved.");
    } catch (error) {
      rollback();
      setToast(error instanceof Error ? error.message : "Could not update Saved.");
    } finally {
      setBusyAction(null);
    }
  }

  async function restoreTask(kind: "clip" | "collection", id: string, title: string) {
    setBusyAction(`restore-${id}`);
    try {
      applyRoomState(await apiTaskRequest(`/api/cliproom/${kind === "clip" ? "clips" : "collections"}/${id}`, { method: "PATCH", body: JSON.stringify({ action: "restore" }) }));
      setLastDeleted(null);
      setRestoreCandidate(null);
      setToast(`${title} restored to the library.`);
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not restore that task.");
      return false;
    } finally { setBusyAction(null); }
  }

  async function restoreDeletedCandidate() {
    if (!restoreCandidate) return;
    const restored = await restoreTask("clip", restoreCandidate.id, restoreCandidate.title);
    if (restored) {
      setClipForm(emptyClipForm);
      setIntakeMode(null);
    }
  }

  async function permanentlyDeleteTask(kind: "clip" | "collection", id: string, title: string) {
    if (!isAdmin) {
      setToast("Only admins can permanently delete clips permanently.");
      return false;
    }

    setBusyAction(`permanent-delete-${id}`);
    try {
      applyRoomState(await apiTaskRequest(`/api/cliproom/${kind === "clip" ? "clips" : "collections"}/${id}`, { method: "PATCH", body: JSON.stringify({ action: "permanent-delete" }) }));
      setLastDeleted(null);
      setRestoreCandidate(null);
      setToast(`${title} permanently deleted.`);
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not permanently delete that task.");
      return false;
    } finally { setBusyAction(null); }
  }

  function toggleSelectMode() {
    setSelectMode((current) => {
      if (current) setSelectedTaskKeys(new Set());
      return !current;
    });
  }

  function toggleTaskSelected(task: QueueTask) {
    const key = taskSelectionKey(task);
    setSelectedTaskKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllVisibleTasks() {
    setSelectedTaskKeys((current) => {
      const next = new Set(current);
      filteredTasks.forEach((task) => next.add(taskSelectionKey(task)));
      return next;
    });
  }

  function clearSelectedTasks() {
    setSelectedTaskKeys(new Set());
    setSelectMode(false);
  }

  async function deleteSelectedTasks() {
    const selectedTargets = queueTasks.filter((task) => selectedTaskKeys.has(taskSelectionKey(task)));
    if (!selectedTargets.length) {
      setToast("Select clips to delete first.");
      return;
    }

    setBusyAction("bulk-delete");
    try {
      for (const task of selectedTargets) {
        const path = task.kind === "clip"
          ? `/api/cliproom/clips/${task.clip.id}`
          : `/api/cliproom/collections/${task.collection.id}`;
        const nextState = await apiTaskRequest(path, { method: "DELETE" });
        applyRoomState(nextState);
      }

      setSelectedTaskKeys(new Set());
      setSelectMode(false);
      setLastDeleted(
        selectedTargets.length === 1
          ? {
              kind: selectedTargets[0].kind,
              id: selectedTargets[0].kind === "clip" ? selectedTargets[0].clip.id : selectedTargets[0].collection.id,
              title: taskSelectionTitle(selectedTargets[0]),
            }
          : null,
      );
      setToast(
        `${selectedTargets.length} ${selectedTargets.length === 1 ? "item" : "items"} moved to Recently deleted.`,
      );
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not delete the selected clips.");
    } finally {
      setBusyAction(null);
    }
  }

  async function removeClip(clip: Clip) {
    setBusyAction(`delete-${clip.id}`);
    try {
      const nextState = await apiTaskRequest(`/api/cliproom/clips/${clip.id}`, {
        method: "DELETE",
      });
      applyRoomState(nextState);
      setToast(`${clip.title} moved to Recently deleted.`);
      setLastDeleted({kind: "clip", id: clip.id, title: clip.title});
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not remove the clip.");
    } finally {
      setBusyAction(null);
    }
  }

  async function updateClipDetails(
    clip: Clip,
    input: { title: string; notes: string; category: Category },
  ) {
    setBusyAction(`update-clip-${clip.id}`);
    const rollback = updateTaskOptimistically(clip, input);
    try {
      const nextState = await apiTaskRequest(`/api/cliproom/clips/${clip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "updateDetails", ...input }),
      });
      applyRoomState(nextState);
      setToast("Clip details updated.");
      return true;
    } catch (error) {
      rollback();
      setToast(error instanceof Error ? error.message : "Could not update the clip.");
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  async function createCollection(input: CollectionCreateInput) {
    if (!input.urls.length) {
      setToast("Add at least one Twitch or Kick clip to the Collection.");
      return;
    }

    setBusyAction("create-collection");
    try {
      const nextState = await apiTaskRequest("/api/cliproom/collections", {
        method: "POST",
        body: JSON.stringify(input),
      });
      applyRoomState(nextState);
      setIntakeMode(null);
      setToast("Collection added to the library.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not create that Collection.");
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleCollectionPriority(collection: Collection) {
    if (!isAdmin) return;

    setBusyAction(`collection-priority-${collection.id}`);
    const rollback = updateTaskOptimistically(collection, { priority: !collection.priority, status: collection.status === "New" ? "Prioritised" : collection.status === "Prioritised" ? "New" : collection.status });
    try {
      const nextState = await apiTaskRequest(
        `/api/cliproom/collections/${collection.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "togglePriority" }),
        },
      );
      applyRoomState(nextState);
      setToast(
        collection.priority
          ? "Collection removed from priority."
          : "Collection prioritised.",
      );
    } catch (error) {
      rollback();
      setToast(error instanceof Error ? error.message : "Could not update Collection priority.");
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleSavedCollection(collection: Collection) {
    setBusyAction(`collection-save-${collection.id}`);
    const rollback = updateTaskOptimistically(collection, { saved: !collection.saved });
    try {
      const nextState = await apiTaskRequest(
        `/api/cliproom/collections/${collection.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "toggleSaved" }),
        },
      );
      applyRoomState(nextState);
      setToast(collection.saved ? "Collection removed from Saved." : "Collection saved.");
    } catch (error) {
      rollback();
      setToast(error instanceof Error ? error.message : "Could not update Saved.");
    } finally {
      setBusyAction(null);
    }
  }

  function toggleRightPanels() {
    setRightPanelsCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        window.localStorage.setItem(rightPanelsStorageKey, String(next));
      } catch {
        // Keep the in-memory preference when storage is unavailable.
      }
      return next;
    });
  }

  async function dissolveCollection(collection: Collection) {
    setBusyAction(`delete-collection-${collection.id}`);
    try {
      const nextState = await apiTaskRequest(
        `/api/cliproom/collections/${collection.id}`,
        { method: "DELETE" },
      );
      applyRoomState(nextState);
      setToast(`${collection.title} moved to Recently deleted.`);
      setLastDeleted({kind: "collection", id: collection.id, title: collection.title});
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not delete the Collection.");
    } finally {
      setBusyAction(null);
    }
  }

  async function addClipToCollection(collection: Collection, url: string) {
    setBusyAction(`add-collection-clip-${collection.id}`);
    try {
      const nextState = await apiTaskRequest(
        `/api/cliproom/collections/${collection.id}/clips`,
        {
          method: "POST",
          body: JSON.stringify({ url }),
        },
      );
      applyRoomState(nextState);
      setToast("Clip added to the Collection.");
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not add that clip to the Collection.");
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  async function removeClipFromCollection(collection: Collection, clip: Clip) {
    setBusyAction(`remove-collection-clip-${collection.id}`);
    try {
      const nextState = await apiTaskRequest(
        `/api/cliproom/collections/${collection.id}/clips/${clip.id}`,
        { method: "DELETE" },
      );
      applyRoomState(nextState);
      setToast(`${clip.title} is standalone again.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not remove that clip from the Collection.");
    } finally {
      setBusyAction(null);
    }
  }

  async function reorderCollectionClip(
    collection: Collection,
    clip: Clip,
    direction: "left" | "right",
  ) {
    setBusyAction(`reorder-${collection.id}`);
    try {
      const nextState = await apiTaskRequest(
        `/api/cliproom/collections/${collection.id}/clips/${clip.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ direction }),
        },
      );
      applyRoomState(nextState);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not reorder that clip.");
    } finally {
      setBusyAction(null);
    }
  }

  async function updateCollectionDetails(
    collection: Collection,
    input: { title: string; notes: string; category: Category },
  ) {
    setBusyAction(`update-collection-${collection.id}`);
    const rollback = updateTaskOptimistically(collection, input);
    try {
      const nextState = await apiTaskRequest(
        `/api/cliproom/collections/${collection.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "update", ...input }),
        },
      );
      applyRoomState(nextState);
      setToast("Collection details updated.");
      return true;
    } catch (error) {
      rollback();
      setToast(error instanceof Error ? error.message : "Could not update the Collection.");
      return false;
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
        body: JSON.stringify({
          channel: channelInput,
          trustedClippers: trustedClippersInput,
        }),
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
    if (!roomState?.twitchSyncAvailable) return;

    setBusyAction("sync");
    try {
      const response = await apiRequest<SyncResponse>("/api/cliproom/twitch/sync", {
        method: "POST",
      });
      applyRoomState(response.state);
      setToast(
        `Checked ${response.checked} recent clips, matched ${response.matched} trusted clippers, imported ${response.imported} new clips.`,
      );
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
          <p className="mt-2 text-sm text-white/48">Loading the private library.</p>
        </div>
      </main>
    );
  }

  if (!roomState || !currentMember) {
    const configured = authStatus?.configured ?? false;
    const needsSetup = authStatus?.needsSetup ?? false;

    return (
      <main className="min-h-screen overflow-hidden bg-[#0b0b0d] text-white">
        <div className="relative grid min-h-screen place-items-center px-4 py-10 sm:px-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(145,70,255,0.13),transparent_29rem),radial-gradient(circle_at_12%_90%,rgba(145,70,255,0.055),transparent_24rem)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-[18%] h-36 w-36 -translate-x-1/2 rounded-full bg-[#9146ff]/10 blur-3xl"
          />

          <section className="relative w-full max-w-[370px]">
            <div className="mb-7 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-[13px] bg-[#9146ff] shadow-[0_14px_42px_rgba(145,70,255,0.27)] ring-1 ring-white/10">
                <Clapperboard aria-hidden="true" size={24} strokeWidth={2.15} />
              </div>
              <p className="mt-4 text-[22px] font-black">ClipRoom</p>
              <p className="mt-1 text-[13px] font-medium text-white/38">Private creator library</p>
            </div>

            <div className="rounded-[18px] border border-white/[0.075] bg-[#151518]/92 p-5 shadow-[0_26px_90px_rgba(0,0,0,0.34)] backdrop-blur-xl sm:p-6">
              <div className="text-center">
                <h1 className="text-[19px] font-extrabold">Sign in to ClipRoom</h1>
                <p className="mt-1.5 text-[13px] leading-5 text-white/42">
                  Private access for your creator team.
                </p>
              </div>

              <form autoComplete="off" className="mt-5 space-y-3.5" onSubmit={handleTwitchAuth}>
                {needsSetup ? (
                  <div className="rounded-[12px] border border-white/[0.075] bg-white/[0.025] p-3.5">
                    <div>
                      <label htmlFor="setup-code" className="mb-1.5 inline-block text-[11px] font-bold uppercase tracking-[0.08em] text-white/38">
                        First admin setup
                      </label>
                      <input autoComplete="off"
                        id="setup-code"
                        className="h-11 w-full rounded-[9px] border border-white/[0.09] bg-[#0f0f12] px-3 text-[15px] text-white outline-none placeholder:text-white/25 transition focus:border-[#9146ff]/70 focus:bg-[#111114]"
                        onChange={(event) => setSetupCode(event.target.value)}
                        placeholder="Enter setup code"
                        type="password"
                        value={setupCode}
                      />
                      <p className="mt-2 text-[11px] leading-[17px] text-white/32">
                        One-time setup to bind the first admin to their verified Twitch account.
                      </p>
                    </div>
                  </div>
                ) : null}

                <button
                  className="group inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-[10px] bg-[#9146ff] text-[14px] font-extrabold text-white shadow-[0_10px_30px_rgba(145,70,255,0.18)] hover:bg-[#9d58ff] hover:shadow-[0_12px_34px_rgba(145,70,255,0.25)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={authBusy || !configured || (needsSetup && !setupCode.trim())}
                  type="submit"
                >
                  <svg aria-hidden="true" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4.3 2 2.9 5.7v13.7h4.8V22h2.8l2.6-2.6h3.9L21.1 15V2H4.3Zm14.5 11.9-2.4 2.4h-4.1l-2.6 2.6v-2.6H6.3V4.4h12.5v9.5Zm-3.1-7.2h-2.3v6.1h2.3V6.7Zm-4.2 0H9.2v6.1h2.3V6.7Z" />
                  </svg>
                  {authBusy ? "Opening Twitch…" : "Continue with Twitch account"}
                </button>
              </form>

              {!configured ? (
                <div className="mt-3 rounded-[9px] border border-[#ffcc66]/20 bg-[#ffcc66]/[0.055] px-3 py-2.5 text-center text-[12px] leading-5 text-[#ffe4ab]">
                  Twitch login is not configured on this Worker yet.
                </div>
              ) : null}

              {toast ? (
                <p className="mt-3 text-center text-[12px] leading-5 text-white/46" role="status">
                  {toast}
                </p>
              ) : null}

              <div className="mt-5 border-t border-white/[0.055] pt-4">
                <div className="flex items-start justify-center gap-2 text-white/34">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
                  <p className="max-w-[285px] text-center text-[11px] leading-[17px]">
                    Your Twitch password is never shared with or stored by ClipRoom.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-white/22">
              <span className="h-1 w-1 rounded-full bg-[#9146ff]/65" />
              Invite-only creator workspace
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <ClipPreviewProvider>
    <main className="min-h-screen bg-[#0b0b0d] text-white">
      <div className="min-h-screen bg-[radial-gradient(circle_at_22%_-12%,rgba(145,70,255,0.16),transparent_34rem)]">
        <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#0b0b0d]/88 backdrop-blur-2xl">
          <div className="app-header flex h-[68px] items-center gap-4 px-4 sm:px-6 lg:px-7">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#9146ff] shadow-[0_8px_24px_rgba(145,70,255,0.28)]">
                <Clapperboard aria-hidden="true" size={20} strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-extrabold leading-5">ClipRoom</p>
                <p className="truncate text-[11px] font-medium text-white/38">
                  Private creator library
                </p>
              </div>
            </div>

            <div className="hidden min-w-0 flex-1 items-center justify-center md:flex">
              <QueueSearchControls query={query} onQueryChange={setQuery} options={viewOptions} onOptionsChange={setViewOptions} />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              {isAdmin ? (
                <Link
                  aria-label="Audit logs"
                  className="grid h-10 w-10 place-items-center rounded-[10px] border border-white/[0.08] bg-white/[0.035] text-white/46 hover:border-[#9146ff]/30 hover:bg-[#9146ff]/10 hover:text-[#d8c6ff]"
                  href="/audit"
                  title="Audit logs"
                >
                  <ClipboardList aria-hidden="true" size={17} />
                </Link>
              ) : null}
              <button
                className="grid h-10 w-10 place-items-center rounded-[10px] border border-white/[0.08] bg-white/[0.035] text-white/46 hover:border-white/15 hover:bg-white/[0.065] hover:text-white"
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

        <div className="app-shell px-4 py-6 sm:px-6 lg:px-5" data-panels-collapsed={rightPanelsCollapsed ? "true" : "false"}>
          <aside className="hidden xl:block">
            <div className="sticky top-[92px] border-r border-white/[0.07] pr-5">
              <div className="mb-7">
                <p className="mb-2 text-[10px] font-bold uppercase text-white/24">Signed in as</p>
                <div className="flex items-center gap-3">
                  {currentMember.avatarUrl ? (
                    <img
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-[10px] border border-[#9146ff]/25 object-cover"
                      src={currentMember.avatarUrl}
                    />
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[#9146ff]/25 bg-[#9146ff]/10 text-[#c7a8ff]">
                      <UserRound aria-hidden="true" size={17} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{currentMember.displayName}</p>
                    <p className="mt-0.5 truncate text-xs text-white/36">@{currentMember.username} · {currentMember.role}</p>
                  </div>
                </div>
              </div>

              <p className="mb-2 px-2 text-[10px] font-bold uppercase text-white/24">Room stats</p>
              <div className="space-y-1">
                {[
                  ["Clips", counts.all, false] as const,
                  ["Trusted", counts.trusted, false] as const,
                  ["Saved", counts.saved, false] as const,
                  ["Priority", priorityTasks.length, false] as const,
                  ["Posted", counts.posted, false] as const,
                  ...(isAdmin ? [["Members", roomState.memberCount, false] as const] : []),
                  ["Online", roomState.onlineMemberCount, true] as const,
                ].map(([label, count, online]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between rounded-[9px] px-2.5 py-2 text-[13px] text-white/40"
                  >
                    <span className="flex items-center gap-2">
                      {online ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.35)]" /> : null}
                      {label}
                    </span>
                    <span className="tabular-nums text-white/32">{count}</span>
                  </div>
                ))}
              </div>

              <div className="mt-8 border-t border-white/[0.07] pt-5">
                <p className="text-[11px] leading-5 text-white/30">
                  Private clip library for your creator team.
                </p>
              </div>
            </div>
          </aside>

          <section className="queue-section">
            <div className="queue-heading mb-5 flex flex-col gap-5 border-b border-white/[0.07] pb-5">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#9146ff]/25 bg-[#9146ff]/10 px-2.5 text-[11px] font-semibold text-[#cdb5ff]">
                    <ShieldCheck aria-hidden="true" size={13} />
                    Private room
                  </span>
                  <span className="text-xs text-white/28">twitch.tv/{roomState.sourceChannel}</span>
                </div>
                <h1 className="text-[30px] font-black leading-none sm:text-[36px]">
                  ClipRoom library
                </h1>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-white/38">
                  <span><strong className="font-semibold text-white/72">{counts.all}</strong> clips</span>
                  <span><strong className="font-semibold text-white/72">{counts.saved}</strong> saved</span>
                  <span><strong className="font-semibold text-white/72">{queueCounts.priority}</strong> priority</span>
                  <span><strong className="font-semibold text-white/72">{counts.posted}</strong> posted</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  aria-pressed={selectMode}
                  className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] border px-4 text-sm font-bold transition ${
                    selectMode
                      ? "border-[#9146ff]/45 bg-[#9146ff]/15 text-[#d8c6ff]"
                      : "border-white/[0.08] bg-white/[0.035] text-white/62 hover:border-white/14 hover:bg-white/[0.06] hover:text-white"
                  }`}
                  onClick={toggleSelectMode}
                  type="button"
                >
                  {selectMode ? <X aria-hidden="true" size={17} /> : <CheckCircle2 aria-hidden="true" size={17} />}
                  {selectMode ? <span>Done</span> : <span>Select</span>}
                </button>
                <button
                  className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] border px-4 text-sm font-bold transition ${
                    intakeMode === "clip"
                      ? "border-white/15 bg-white/[0.09] text-white"
                      : "border-white/[0.08] bg-white/[0.035] text-white/62 hover:border-white/14 hover:bg-white/[0.06] hover:text-white"
                  }`}
                  onClick={() => setIntakeMode((mode) => (mode === "clip" ? null : "clip"))}
                  type="button"
                >
                  <Plus aria-hidden="true" size={17} />
                  {intakeMode === "clip" ? "Close form" : "Add clip"}
                </button>
                <button
                  className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-bold text-white shadow-[0_10px_28px_rgba(145,70,255,0.18)] transition ${
                    intakeMode === "collection" ? "bg-[#a05cff]" : "bg-[#9146ff] hover:bg-[#a05cff]"
                  }`}
                  onClick={() =>
                    setIntakeMode((mode) => (mode === "collection" ? null : "collection"))
                  }
                  type="button"
                >
                  <Plus aria-hidden="true" size={17} />
                  {intakeMode === "collection" ? "Close collection" : "Create collection"}
                </button>
              </div>
            </div>

            {intakeMode === "clip" ? (
              <div className="mb-5 rounded-[14px] border border-[#9146ff]/20 bg-[linear-gradient(145deg,rgba(145,70,255,0.08),rgba(255,255,255,0.025))] p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold">Add a clip</p>
                    <p className="mt-1 text-xs text-white/36">Paste a Twitch or Kick clip URL, add context, then save it to the library.</p>
                  </div>
                </div>
                <form autoComplete="off"
                  className="clip-intake-fields"
                  onSubmit={addClip}
                >
                  <div className="min-w-0">
                    <label htmlFor="new-clip-url" className="mb-1.5 inline-block text-[11px] font-semibold text-white/38">Clip URL</label>
                    <input autoComplete="off"
                      id="new-clip-url"
                      aria-label="Clip URL"
                      className="h-11 w-full rounded-[10px] border border-white/[0.08] bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/22 focus:border-[#9146ff]/60 focus:bg-white/[0.045]"
                      maxLength={maxClipUrlLength}
                      onChange={(event) =>
                        setClipForm((current) => ({ ...current, url: event.target.value }))
                      }
                      placeholder="Paste a Twitch or Kick clip URL"
                      value={clipForm.url}
                    />
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="new-clip-title" className="mb-1.5 inline-block text-[11px] font-semibold text-white/38">Title</label>
                    <input autoComplete="off"
                      id="new-clip-title"
                      aria-label="Clip title"
                      className="h-11 w-full rounded-[10px] border border-white/[0.08] bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/22 focus:border-[#9146ff]/60 focus:bg-white/[0.045]"
                      maxLength={maxClipTitleLength}
                      onChange={(event) =>
                        setClipForm((current) => ({ ...current, title: event.target.value }))
                      }
                      placeholder="What happened?"
                      value={clipForm.title}
                    />
                  </div>
                  <div>
                    <span className="mb-1.5 block text-[11px] font-semibold text-white/38">Category</span>
                    <div
                      aria-label="Clip category"
                      className="grid grid-cols-2 gap-1 rounded-[10px] border border-white/[0.08] bg-black/20 p-1"
                      role="radiogroup"
                    >
                      {categories.map((category) => (
                        <button
                          key={category.id}
                          aria-checked={clipForm.category === category.id}
                          className={`h-9 rounded-[7px] px-2 text-xs font-semibold ${
                            clipForm.category === category.id
                              ? "bg-white/[0.11] text-white"
                              : "text-white/36 hover:bg-white/[0.05] hover:text-white/70"
                          }`}
                          onClick={() => setClipForm((current) => ({ ...current, category: category.id }))}
                          onKeyDown={submitParentFormOnEnter}
                          role="radio"
                          type="button"
                        >
                          {category.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="clip-notes-field min-w-0">
                    <label htmlFor="new-clip-notes" className="mb-1.5 inline-block text-[11px] font-semibold text-white/38">Notes</label>
                    <textarea
                      autoComplete="off"
                      id="new-clip-notes"
                      aria-label="Clip notes"
                      className="h-[4.5rem] w-full resize-none overflow-hidden rounded-[10px] border border-white/[0.08] bg-black/20 px-3 py-2.5 text-sm leading-5 text-white outline-none placeholder:text-white/22 focus:border-[#9146ff]/60 focus:bg-white/[0.045]"
                      maxLength={maxClipNotesLength}
                      onChange={(event) => setClipForm((current) => ({ ...current, notes: event.target.value }))}
                      placeholder="Hook, caption idea, context, edit direction..."
                      value={clipForm.notes}
                    />
                  </div>
                  <button
                    className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-white px-4 text-sm font-bold text-[#111114] hover:bg-[#eee8f7] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busyAction === "add-clip"}
                    type="submit"
                  >
                    <Plus aria-hidden="true" size={17} />
                    {busyAction === "add-clip" ? "Adding" : "Add to library"}
                  </button>
                </form>
              </div>
            ) : null}

            {intakeMode === "collection" ? (
              <CollectionIntake
                busy={busyAction === "create-collection"}
                onSubmit={createCollection}
              />
            ) : null}

            <div className="mb-4">
              <div className="mb-3 flex flex-col gap-3 md:hidden">
                <QueueSearchControls query={query} onQueryChange={setQuery} options={viewOptions} onOptionsChange={setViewOptions} />
              </div>
              <div className="flex gap-2 overflow-x-auto">
                {filters.map((filter) => (
                  <button
                    key={filter.id}
                    aria-pressed={categoryFilter === filter.id}
                    className={`h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold ${
                      categoryFilter === filter.id
                        ? "border-[#9146ff]/45 bg-[#9146ff]/15 text-[#d8c6ff]"
                        : "border-white/[0.07] bg-white/[0.025] text-white/38 hover:border-white/12 hover:bg-white/[0.045] hover:text-white/70"
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
              {query.trim() || hasViewOptions ? (
                <p className="mt-3 text-xs text-white/48" role="status" aria-live="polite" aria-atomic="true">
                  {filteredTasks.length} {filteredTasks.length === 1 ? "result" : "results"} in {filters.find((filter) => filter.id === categoryFilter)?.label}
                </p>
              ) : null}
            </div>

            {restoreCandidate ? (
              <div className="mb-4 flex flex-col gap-3 rounded-[12px] border border-[#9146ff]/30 bg-[linear-gradient(135deg,rgba(145,70,255,0.12),rgba(145,70,255,0.05))] px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white">This clip was recently deleted. Restore it to the library?</p>
                  <p className="mt-1 truncate text-xs text-white/45" title={restoreCandidate.title}>{restoreCandidate.title}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button className="h-9 rounded-[9px] border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-white/60 hover:bg-white/[0.08] hover:text-white" onClick={() => setRestoreCandidate(null)} type="button">Cancel</button>
                  <button className="h-9 rounded-[9px] bg-[#9146ff] px-3 text-xs font-bold text-white hover:bg-[#a970ff] disabled:opacity-50" disabled={busyAction === `restore-${restoreCandidate.id}`} onClick={() => void restoreDeletedCandidate()} type="button">Restore</button>
                </div>
              </div>
            ) : null}

            {toast ? (
              <div className="mb-4 flex items-center gap-2.5 rounded-[10px] border border-[#9146ff]/18 bg-[#9146ff]/8 px-3.5 py-2.5 text-[13px] text-[#d8c8f7]">
                <Sparkles aria-hidden="true" size={17} />
                <p className="min-w-0 flex-1">{toast}</p>
                {lastDeleted && (roomState.trash?.clips.some((clip) => clip.id === lastDeleted.id) || roomState.trash?.collections.some((collection) => collection.id === lastDeleted.id)) ? <button className="shrink-0 rounded-md px-2 py-1 text-xs font-bold text-white hover:bg-[#9146ff]/25 disabled:opacity-50" disabled={busyAction === `restore-${lastDeleted.id}`} onClick={() => void restoreTask(lastDeleted.kind, lastDeleted.id, lastDeleted.title)} type="button">Undo delete</button> : null}
              </div>
            ) : null}

            <RecentlyDeleted
              trash={roomState.trash}
              busyAction={busyAction}
              onRestore={restoreTask}
              onPermanentDelete={isAdmin ? permanentlyDeleteTask : undefined}
              isAdmin={isAdmin}
            />

            {selectMode ? (
              <div className="selection-bar" role="status" aria-live="polite">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">
                    {selectedTaskKeys.size} selected
                  </p>
                  <p className="mt-0.5 text-xs text-white/36">
                    Pick the cards you want to move to Recently deleted.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    className="h-9 rounded-[9px] border border-white/[0.08] bg-white/[0.035] px-3 text-xs font-bold text-white/52 hover:bg-white/[0.065] hover:text-white"
                    onClick={selectAllVisibleTasks}
                    type="button"
                  >
                    Select all visible
                  </button>
                  <button
                    className="h-9 rounded-[9px] border border-white/[0.08] bg-white/[0.035] px-3 text-xs font-bold text-white/52 hover:bg-white/[0.065] hover:text-white"
                    onClick={clearSelectedTasks}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#ff6b6b]/35 bg-[#ff6b6b]/10 px-3 text-xs font-bold text-[#ffb4b4] hover:bg-[#ff6b6b]/16 disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!selectedTaskKeys.size || busyAction === "bulk-delete"}
                    onClick={() => void deleteSelectedTasks()}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={14} />
                    Delete selected
                  </button>
                </div>
              </div>
            ) : null}

            {filteredTasks.length > 0 ? (
              <div className="task-grid">
                {filteredTasks.map((task) =>
                  task.kind === "clip" ? (
                    <StandaloneClipCard
                      key={`clip-${task.clip.id}`}
                      busyAction={busyAction}
                      clip={task.clip}
                      embedHost={embedHost}
                      isAdmin={isAdmin}
                      onDelete={removeClip}
                      onToggleSelected={() => toggleTaskSelected(task)}
                      onToggleSaved={toggleSavedClip}
                      onTogglePriority={togglePriority}
                      onUpdate={updateClipDetails}
                      selected={selectedTaskKeys.has(taskSelectionKey(task))}
                      selectMode={selectMode}
                    />
                  ) : (
                    <CollectionCard
                      key={`collection-${task.collection.id}`}
                      busyAction={busyAction}
                      collection={task.collection}
                      embedHost={embedHost}
                      isAdmin={isAdmin}
                      onAddClip={addClipToCollection}
                      onDelete={dissolveCollection}
                      onRemoveClip={removeClipFromCollection}
                      onReorderClip={reorderCollectionClip}
                      onToggleSelected={() => toggleTaskSelected(task)}
                      onToggleSaved={toggleSavedCollection}
                      onTogglePriority={toggleCollectionPriority}
                      onUpdate={updateCollectionDetails}
                      selected={selectedTaskKeys.has(taskSelectionKey(task))}
                      selectMode={selectMode}
                    />
                  ),
                )}
              </div>
            ) : (
              <div className="rounded-[14px] border border-dashed border-white/[0.09] bg-white/[0.015] p-12 text-center">
                <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-[12px] border border-[#9146ff]/20 bg-[#9146ff]/8 text-[#c9b0ff]">
                  <Clapperboard aria-hidden="true" size={26} />
                </div>
                <p className="text-xl font-black">No clips found</p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/50">
                  {query.trim() || hasViewOptions
                    ? "No matches in this category. Try fewer keywords, reset your filters, or choose another category."
                    : categoryFilter === "trusted"
                    ? isAdmin
                      ? "Add trusted Twitch usernames, then sync clips from the source channel."
                      : "No trusted-source clips are in the library yet."
                    : "Try a different search or category."}
                </p>
              </div>
            )}

          </section>

          <aside className="workspace-panels" data-collapsed={rightPanelsCollapsed ? "true" : "false"}>
            <button
              aria-label={rightPanelsCollapsed ? "Expand right panel" : "Collapse right panel"}
              className="workspace-panel-toggle"
              onClick={toggleRightPanels}
              title={rightPanelsCollapsed ? "Expand right panel" : "Collapse right panel"}
              type="button"
            >
              {rightPanelsCollapsed ? <ChevronLeft aria-hidden="true" size={16} /> : <ChevronRight aria-hidden="true" size={16} />}
            </button>
            <div className="workspace-panel-rail" aria-hidden="true" />
            <div
              aria-hidden={rightPanelsCollapsed ? "true" : undefined}
              className="workspace-panel-viewport"
              inert={rightPanelsCollapsed}
            >
              <div className="workspace-panel-content">
                <section className="rounded-[14px] border border-white/[0.075] bg-[#141416] p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold">Twitch source</p>
                      <p className="text-xs text-white/44">
                        {roomState.trustedClipperLogins.length} trusted clipper
                        {roomState.trustedClipperLogins.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Clapperboard
                      aria-hidden="true"
                      className="text-[#b68cff]"
                      size={24}
                    />
                  </div>
                  <form autoComplete="off" className="space-y-3" onSubmit={saveChannel}>
                    {isAdmin ? (
                      <>
                        <label className="flex h-11 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white/54">
                          <span className="text-white/36">twitch.tv/</span>
                          <input autoComplete="off"
                            aria-label="Twitch channel"
                            className="h-full min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                            maxLength={maxTwitchLoginLength}
                            onChange={(event) => setChannelInput(event.target.value)}
                            placeholder="channel"
                            value={channelInput}
                          />
                        </label>
                        <div>
                          <label htmlFor="trusted-clippers" className="mb-1.5 inline-block text-xs font-semibold text-white/48">
                            Trusted clippers
                          </label>
                          <textarea autoComplete="off"
                            id="trusted-clippers"
                            aria-label="Trusted Twitch clippers"
                            className="block min-h-16 max-h-48 w-full resize-y overflow-y-auto rounded-lg border border-white/10 bg-white/[0.06] px-3 py-3 text-sm leading-5 text-white outline-none placeholder:text-white/30 focus:border-[#9146ff]/60 [field-sizing:content]"
                            maxLength={maxTrustedClippersTextLength}
                            onChange={(event) => setTrustedClippersInput(event.target.value)}
                            placeholder="username, anotherusername"
                            rows={2}
                            value={trustedClippersInput}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="space-y-3">
                        <div
                          aria-label="Twitch channel value"
                          className="flex h-11 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.045] px-3 text-sm text-white/54"
                        >
                          <span className="text-white/34">twitch.tv/</span>
                          <span className="min-w-0 truncate text-white/64">{roomState.sourceChannel}</span>
                        </div>
                        <div>
                          <span className="mb-1.5 block text-xs font-semibold text-white/48">
                            Trusted clippers
                          </span>
                          <div
                            aria-label="Trusted Twitch clippers value"
                            className="min-h-11 rounded-lg border border-white/10 bg-white/[0.045] px-3 py-3 text-sm leading-5 text-white/64"
                          >
                            {roomState.trustedClipperLogins.length
                              ? roomState.trustedClipperLogins.join(", ")
                              : "No trusted clippers yet"}
                          </div>
                        </div>
                      </div>
                    )}
                    <p className="text-xs leading-5 text-white/42">
                      Import clips from {roomState.sourceChannel}&apos;s channel from the last 24 hours, made by the listed clippers. New clips appear under Trusted clippers; existing clips are not duplicated.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {isAdmin ? (
                        <button
                          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-[#a970ff]/35 bg-[linear-gradient(135deg,#9146ff,#a855f7)] px-3 text-[13px] font-bold text-white shadow-[0_10px_24px_rgba(145,70,255,0.2)] hover:brightness-110 disabled:opacity-60"
                          disabled={busyAction === "source"}
                          type="submit"
                        >
                          <RefreshCw aria-hidden="true" size={17} />
                          Save source
                        </button>
                      ) : null}
                      <button
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-[9px] border border-white/[0.07] bg-white/[0.025] px-3 text-[13px] font-semibold text-white/48 hover:border-white/13 hover:bg-white/[0.05] hover:text-white/76 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={
                          busyAction === "sync" || !roomState.twitchSyncAvailable
                        }
                        onClick={syncTwitch}
                        title={
                          roomState.twitchSyncAvailable
                            ? "Sync recent clips from trusted Twitch clippers"
                            : "Add Twitch API secrets to enable sync"
                        }
                        type="button"
                      >
                        <Clapperboard aria-hidden="true" size={17} />
                        Sync clips
                      </button>
                    </div>
                    {!roomState.twitchSyncAvailable ? (
                      <p className="text-xs leading-5 text-white/42">
                        Twitch sync is not available in this room yet. You can still add clips by pasting a Twitch URL.
                      </p>
                    ) : null}
                  </form>
                </section>

            {isAdmin ? (
              <section className="rounded-[14px] border border-white/[0.075] bg-[#141416] p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold">Team</p>
                    <p className="text-xs text-white/44">
                      {roomState.memberCount}/{roomState.maxMembers} people · Twitch verified
                    </p>
                  </div>
                  <span className="grid h-9 w-9 place-items-center rounded-[10px] border border-[#9146ff]/20 bg-[#9146ff]/9 text-[#c9b0ff]">
                    <UserRound aria-hidden="true" size={18} />
                  </span>
                </div>

                <form autoComplete="off" className="space-y-3" onSubmit={addMember}>
                  <input
                    aria-label="Twitch username"
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect="off"
                    className="h-11 w-full rounded-[10px] border border-white/[0.075] bg-white/[0.035] px-3 text-sm text-white outline-none placeholder:text-white/24 focus:border-[#9146ff]/55 focus:bg-white/[0.05]"
                    maxLength={maxTwitchLoginLength}
                    onChange={(event) => setMemberUsername(event.target.value)}
                    placeholder="Twitch username"
                    spellCheck={false}
                    type="text"
                    value={memberUsername}
                  />
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div
                      aria-label="Member role"
                      className="grid h-11 grid-cols-2 gap-1 rounded-[10px] border border-white/[0.075] bg-white/[0.035] p-1"
                      role="radiogroup"
                    >
                      {(["Clipper", "Admin"] as MemberRole[]).map((role) => (
                        <button
                          key={role}
                          aria-checked={memberRole === role}
                          className={`rounded-md px-2 text-xs font-bold ${
                            memberRole === role
                              ? "bg-[#9146ff] text-white"
                              : "text-white/38 hover:bg-white/[0.05] hover:text-white/72"
                          }`}
                          onClick={() => setMemberRole(role)}
                          onKeyDown={submitParentFormOnEnter}
                          role="radio"
                          type="button"
                        >
                          {role}
                        </button>
                      ))}
                    </div>
                    <button
                      className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#9146ff] px-4 text-sm font-bold text-white hover:bg-[#a05cff] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busyAction === "add-member"}
                      type="submit"
                    >
                      <Plus aria-hidden="true" size={17} />
                      Add
                    </button>
                  </div>
                </form>

                <div className="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-[10px] border border-white/[0.065] bg-white/[0.018]">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3"
                    >
                      {member.avatarUrl ? (
                        <img
                          alt=""
                          className="h-9 w-9 shrink-0 rounded-[9px] border border-white/[0.07] object-cover"
                          src={member.avatarUrl}
                        />
                      ) : (
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] border border-[#9146ff]/20 bg-[#9146ff]/10 text-[#d7c5ff]">
                          {member.role === "Admin" ? (
                            <Crown aria-hidden="true" size={16} />
                          ) : (
                            <UserRound aria-hidden="true" size={16} />
                          )}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                          <p className="break-words text-sm font-semibold leading-5">{member.displayName}</p>
                          <span
                            className={`inline-flex h-5 min-w-[54px] items-center justify-center rounded border px-1.5 text-[10px] font-bold leading-none ${
                              member.role === "Admin"
                                ? "border-[#9146ff]/28 bg-[#9146ff]/10 text-[#dacaff]"
                                : "border-[#2dd4bf]/28 bg-[#2dd4bf]/8 text-[#b9fff7]"
                            }`}
                          >
                            {member.role}
                          </span>
                        </div>
                        <p className="mt-0.5 break-words text-xs leading-5 text-white/40">
                          @{member.username} · added {formatUserDate(member.addedAt)}
                        </p>
                      </div>
                      <button
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-white/[0.07] bg-white/[0.02] text-white/32 hover:border-[#ff6b6b]/30 hover:bg-[#ff6b6b]/5 hover:text-[#ffaaaa] disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={
                          currentMember.id === member.id ||
                          busyAction === `remove-${member.id}`
                        }
                        onClick={() => removeAccess(member)}
                        title="Remove access"
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
    </ClipPreviewProvider>
  );
}
