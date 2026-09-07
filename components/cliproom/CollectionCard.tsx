"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock3,
  ExternalLink,
  Layers3,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Star,
  Tags,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { taskDomId } from "@/lib/cliproom/task-helpers";
import type { FormEvent, KeyboardEvent } from "react";

import {
  categories,
  collectionClipLabel,
  formatTaskTitleForDisplay,
  getClipEmbedUrl,
  getClipPlatform,
  maxClipUrlLength,
  maxCollectionNotesLength,
  maxCollectionTitleLength,
} from "@/lib/cliproom/shared";
import type { Category, Clip, Collection } from "@/lib/cliproom/shared";
import {
  canAdvanceTask,
  categoryLabel,
  formatTaskDate,
  statusStyles,
  taskActionLabel,
} from "@/components/cliproom/task-card-shared";
import { KickClipPlayer } from "@/components/cliproom/KickClipPlayer";
import { TaskInfoPopover } from "@/components/cliproom/TaskInfoPopover";
import { TaskBadgeOverflow } from "@/components/cliproom/TaskBadgeOverflow";
import { TwitchEmbedFrame, ExternalClipPreview } from "@/components/cliproom/TwitchEmbedFrame";

type Props = {
  collection: Collection;
  currentUsername: string;
  isAdmin: boolean;
  embedHost: string;
  busyAction: string | null;
  onAdvance: (collection: Collection) => void;
  onResetProgress: (collection: Collection) => void;
  onDelete: (collection: Collection) => void;
  onTogglePriority: (collection: Collection) => void;
  onAddClip: (collection: Collection, url: string) => Promise<boolean>;
  onRemoveClip: (collection: Collection, clip: Clip) => void;
  onReorderClip: (collection: Collection, clip: Clip, direction: "left" | "right") => void;
  onUpdate: (
    collection: Collection,
    input: { title: string; notes: string; category: Category },
  ) => Promise<boolean>;
};

function submitParentFormOnEnter(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

export function CollectionCard({
  collection,
  currentUsername,
  isAdmin,
  embedHost,
  busyAction,
  onAdvance,
  onResetProgress,
  onDelete,
  onTogglePriority,
  onAddClip,
  onRemoveClip,
  onReorderClip,
  onUpdate,
}: Props) {
  const [selectedClipId, setSelectedClipId] = useState(collection.clips[0]?.id ?? "");
  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(collection.title);
  const [editNotes, setEditNotes] = useState(collection.notes);
  const [editCategory, setEditCategory] = useState<Category>(collection.category);

  const selectedClip =
    collection.clips.find((clip) => clip.id === selectedClipId) ?? collection.clips[0] ?? null;
  const selectedIndex = selectedClip
    ? collection.clips.findIndex((clip) => clip.id === selectedClip.id)
    : -1;
  const selectedPlatform = selectedClip ? getClipPlatform(selectedClip.url) : null;
  const embedUrl = selectedClip && selectedPlatform === "Twitch" ? getClipEmbedUrl(selectedClip.url, embedHost) : null;
  const selectedClipLabel = selectedClip ? collectionClipLabel(selectedClip, selectedIndex) : "";
  const containsTrustedClip = collection.clips.some((clip) => clip.intakeSource === "trusted_sync");
  const actionLabel = taskActionLabel(collection, currentUsername, isAdmin);
  const canAdvance = canAdvanceTask(collection, currentUsername, isAdmin);
  const canResetProgress = isAdmin || collection.assignee === currentUsername;
  const collectionBadge = (
    <span className="inline-flex items-center gap-1 rounded border border-[#9146ff]/35 bg-[#9146ff]/12 px-2.5 py-1 text-xs font-semibold text-[#d8c6ff]">
      <Clapperboard aria-hidden="true" size={12} />
      Collection
    </span>
  );
  const trustedBadge = containsTrustedClip ? (
    <span className="inline-flex items-center gap-1 rounded border border-[#2dd4bf]/35 bg-[#2dd4bf]/10 px-2.5 py-1 text-xs font-semibold text-[#b9fff7]">
      <ShieldCheck aria-hidden="true" size={12} />
      Trusted source
    </span>
  ) : null;
  const statusBadge = (
    <span className={`rounded border px-2.5 py-1 text-xs font-semibold ${statusStyles[collection.status]}`}>
      {collection.status}
    </span>
  );
  const categoryBadge = (
    <span className="rounded border border-white/10 bg-white/[0.055] px-2.5 py-1 text-xs text-white/56">
      {categoryLabel(collection.category)}
    </span>
  );
  const titleBadges = trustedBadge
    ? [collectionBadge, trustedBadge, statusBadge, categoryBadge]
    : [collectionBadge, statusBadge, categoryBadge];
  const compactPrimaryIndex = trustedBadge ? 2 : 1;

  function openEdit() {
    if (editOpen) { setEditOpen(false); return; }
    setEditTitle(collection.title);
    setEditNotes(collection.notes);
    setEditCategory(collection.category);
    setEditOpen(true);
  }

  async function submitAddClip() {
    if (!addUrl.trim()) return;
    const saved = await onAddClip(collection, addUrl.trim());
    if (saved) {
      setAddUrl("");
      setAddOpen(false);
    }
  }

  function handleAddClipSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitAddClip();
  }

  async function submitEdit() {
    const saved = await onUpdate(collection, {
      title: editTitle,
      notes: editNotes,
      category: editCategory,
    });
    if (saved) setEditOpen(false);
  }

  function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitEdit();
  }

  function handleResetProgress() {
    setEditOpen(false);
    onResetProgress(collection);
  }

  return (
    <article
      id={taskDomId("collection", collection.id)}
      data-priority={collection.priority}
      className={`queue-card group flex h-full flex-col overflow-hidden rounded-[14px] border bg-[#141416] ${
        collection.priority
          ? "border-[#facc15]/25 shadow-[0_14px_40px_rgba(0,0,0,0.18)]"
          : "border-[#9146ff]/20"
      }`}
    >
      <div className="border-b border-white/[0.07] bg-black">
        {selectedClip && selectedPlatform === "Kick" ? (
          <KickClipPlayer clipId={selectedClip.id} title={selectedClipLabel} url={selectedClip.url} />
        ) : embedUrl && selectedClip ? (
          <TwitchEmbedFrame clipId={selectedClip.id} platform="Twitch" src={embedUrl} title={selectedClipLabel} url={selectedClip.url} />
        ) : selectedClip ? (
          <ExternalClipPreview title={selectedClipLabel} url={selectedClip.url} platform={selectedPlatform ?? "source"} />
        ) : (
          <div className="grid aspect-video place-items-center bg-[#101014] px-6 text-center">
            <div>
              <Layers3 aria-hidden="true" className="mx-auto mb-3 text-[#9146ff]" size={28} />
              <p className="text-sm font-bold text-white">Preview unavailable</p>
              <p className="mt-1 text-xs text-white/44">Add a clip to this collection.</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-[18px]">
        <div className="task-card-title-block">
          <div className="task-card-title-row flex items-start justify-between gap-3">
            <div className="task-card-title-tags min-w-0">
              <TaskBadgeOverflow
                badges={titleBadges}
                compactPrimaryIndex={compactPrimaryIndex}
                label={collection.title}
              />
            </div>
            <div className="task-card-title-actions flex shrink-0 gap-2">
              <TaskInfoPopover kind="collection" task={collection} />
              <button
                aria-label={editOpen ? `Cancel editing ${collection.title}` : `Edit ${collection.title}`}
                aria-expanded={editOpen}
                className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/[0.045] text-white/46 hover:bg-white/[0.08] hover:text-white"
                onClick={openEdit}
                title={editOpen ? "Cancel editing" : "Edit details"}
                type="button"
              >
                <Pencil aria-hidden="true" size={16} />
              </button>
              <button
                aria-label={collection.priority ? `Remove ${collection.title} from priority` : `Prioritise ${collection.title}`}
                className={`grid h-10 w-10 place-items-center rounded-lg border ${
                  collection.priority
                    ? "border-[#facc15]/55 bg-[#facc15] text-black"
                    : "border-white/12 bg-white/[0.055] text-white/60 hover:text-white"
                } disabled:cursor-not-allowed disabled:opacity-50`}
                disabled={!isAdmin || busyAction === `collection-priority-${collection.id}`}
                onClick={() => onTogglePriority(collection)}
                title={isAdmin ? "Toggle priority" : "Admins set priority"}
                type="button"
              >
                <Star aria-hidden="true" fill={collection.priority ? "currentColor" : "none"} size={18} />
              </button>
            </div>
          </div>
          <div className="task-card-title-copy">
            <h2 className="task-card-title-text" title={collection.title}>
              {formatTaskTitleForDisplay(collection.title)}
            </h2>
          </div>
          <p className="mt-2 min-h-[17px] text-xs leading-[17px] text-white/38">
            {selectedClip ? `Viewing clip ${selectedIndex + 1} of ${collection.clips.length}` : "No clips available"}
          </p>
        </div>

        {editOpen ? (
          <form autoComplete="off"
            className="mb-4 space-y-3 rounded-[10px] border border-[#9146ff]/20 bg-[#9146ff]/[0.055] p-3"
            onSubmit={handleEditSubmit}
          >
            <input autoComplete="off"
              aria-label="Collection title"
              className="h-10 w-full rounded-[8px] border border-white/[0.08] bg-black/20 px-3 text-sm text-white outline-none focus:border-[#9146ff]/55"
              maxLength={maxCollectionTitleLength}
              onChange={(event) => setEditTitle(event.target.value)}
              value={editTitle}
            />
            <textarea autoComplete="off"
              aria-label="Collection notes"
              className="h-20 w-full resize-none overflow-y-auto rounded-[8px] border border-white/[0.08] bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-[#9146ff]/55"
              maxLength={maxCollectionNotesLength}
              onChange={(event) => setEditNotes(event.target.value)}
              value={editNotes}
            />
            <div className="flex flex-wrap gap-1.5">
              {categories.map((item) => (
                <button
                  key={item.id}
                  className={`h-8 rounded-[8px] border px-2.5 text-[11px] font-semibold ${
                    editCategory === item.id
                      ? "border-[#9146ff]/45 bg-[#9146ff]/18 text-[#d8c6ff]"
                      : "border-white/[0.07] bg-white/[0.02] text-white/38"
                  }`}
                  onClick={() => setEditCategory(item.id)}
                  onKeyDown={submitParentFormOnEnter}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="h-9 rounded-[8px] border border-white/[0.08] px-3 text-xs font-semibold text-white/46"
                onClick={() => setEditOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-9 rounded-[8px] bg-[#9146ff] px-3 text-xs font-bold text-white disabled:opacity-50"
                disabled={!editTitle.trim() || busyAction === `update-collection-${collection.id}`}
                type="submit"
              >
                Save details
              </button>
            </div>
          </form>
        ) : collection.notes ? (
          <div className="task-card-notes mb-4 rounded-[10px] border border-white/[0.06] bg-white/[0.025] p-3">
            <p className="task-card-notes-text" title={collection.notes}>
              {collection.notes}
            </p>
          </div>
        ) : null}

        <div className="mb-4 rounded-[10px] border border-white/[0.06] bg-[#101012] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#c8afff]">
              <Layers3 aria-hidden="true" size={13} />
              Collection · {collection.clips.length} clips
            </span>
            {selectedClip ? (
              <span className="max-w-[45%] truncate text-[11px] text-white/28" title={selectedClip.title || selectedClipLabel}>
                {selectedClipLabel}
              </span>
            ) : null}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {collection.clips.map((clip, index) => {
              const selected = clip.id === selectedClip?.id;
              const clipLabel = collectionClipLabel(clip, index);
              return (
                <button
                  key={clip.id}
                  className={`flex h-11 min-w-[128px] max-w-[190px] shrink-0 items-center gap-2 rounded-[9px] border px-2.5 text-left transition ${
                    selected
                      ? "border-[#9146ff]/55 bg-[#9146ff]/15 text-white"
                      : "border-white/[0.07] bg-white/[0.025] text-white/42 hover:border-white/13 hover:bg-white/[0.05] hover:text-white/72"
                  }`}
                  onClick={() => setSelectedClipId(clip.id)}
                  title={clip.title || clipLabel}
                  type="button"
                >
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-black ${selected ? "bg-[#9146ff]" : "bg-white/[0.07]"}`}>
                    {index + 1}
                  </span>
                  <span className="min-w-0 truncate text-xs font-semibold">
                    {clipLabel}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedClip ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                aria-label="Move clip left"
                className="grid h-8 w-8 place-items-center rounded-[8px] border border-white/[0.07] bg-white/[0.025] text-white/40 hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
                disabled={selectedIndex <= 0 || busyAction === `reorder-${collection.id}`}
                onClick={() => onReorderClip(collection, selectedClip, "left")}
                title="Move clip left"
                type="button"
              >
                <ChevronLeft aria-hidden="true" size={15} />
              </button>
              <button
                aria-label="Move clip right"
                className="grid h-8 w-8 place-items-center rounded-[8px] border border-white/[0.07] bg-white/[0.025] text-white/40 hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
                disabled={selectedIndex >= collection.clips.length - 1 || busyAction === `reorder-${collection.id}`}
                onClick={() => onReorderClip(collection, selectedClip, "right")}
                title="Move clip right"
                type="button"
              >
                <ChevronRight aria-hidden="true" size={15} />
              </button>
              <button
                className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-white/[0.07] bg-white/[0.025] px-2.5 text-[11px] font-semibold text-white/40 hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
                disabled={collection.clips.length <= 1 || busyAction === `remove-collection-clip-${collection.id}`}
                onClick={() => onRemoveClip(collection, selectedClip)}
                title="Remove selected clip"
                type="button"
              >
                <X aria-hidden="true" className="shrink-0" size={13} />
                Remove
              </button>
              <button
                className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-[#9146ff]/20 bg-[#9146ff]/8 px-2.5 text-[11px] font-semibold text-[#cdb5ff] hover:bg-[#9146ff]/14"
                onClick={() => setAddOpen((open) => !open)}
                title="Add clip to Collection"
                type="button"
              >
                <Plus aria-hidden="true" className="shrink-0" size={13} />
                Add clip
              </button>
            </div>
          ) : null}

          {addOpen ? (
            <form autoComplete="off"
              className="mt-2 flex gap-2 rounded-[9px] border border-[#9146ff]/18 bg-[#9146ff]/[0.055] p-2"
              onSubmit={handleAddClipSubmit}
            >
              <input autoComplete="off"
                aria-label="Add Twitch or Kick clip to Collection"
                className="h-9 min-w-0 flex-1 rounded-[8px] border border-white/[0.08] bg-black/20 px-2.5 text-xs text-white outline-none placeholder:text-white/24 focus:border-[#9146ff]/55"
                maxLength={maxClipUrlLength}
                onChange={(event) => setAddUrl(event.target.value)}
                placeholder="Paste a Twitch or Kick clip URL"
                value={addUrl}
              />
              <button
                className="h-9 shrink-0 whitespace-nowrap rounded-[8px] bg-[#9146ff] px-3 text-xs font-bold text-white disabled:opacity-50"
                disabled={!addUrl.trim() || busyAction === `add-collection-clip-${collection.id}`}
                type="submit"
              >
                Add
              </button>
            </form>
          ) : null}
        </div>

        <div className="mt-auto pt-1">
          <div className="task-card-meta text-xs text-white/50">
            <span className="task-card-meta-date flex min-w-0 items-center gap-2">
              <Clock3 aria-hidden="true" className="shrink-0" size={14} />
              <span>{formatTaskDate(collection.createdAt)}</span>
            </span>
            <span className="task-card-meta-assignee flex min-w-0 items-center gap-2">
              <UserRound aria-hidden="true" className="shrink-0" size={14} />
              <span className="min-w-0 truncate">{collection.assignee}</span>
            </span>
            <span className="task-card-meta-priority flex min-w-0 items-center gap-2">
              <Tags aria-hidden="true" className="shrink-0" size={14} />
              <span>{collection.priority ? "Priority" : "Normal"}</span>
            </span>
          </div>

          <div className="task-card-actions mt-4 border-t border-white/[0.07] pt-4">
            <div className="task-card-workflow">
              {editOpen && collection.status !== "New" && collection.status !== "Prioritised" ? (
                <button
                  aria-label={`Reset progress for ${collection.title}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border border-[#f59e0b]/20 bg-[#f59e0b]/[0.06] text-[#f6c66e] hover:border-[#f59e0b]/35 hover:bg-[#f59e0b]/[0.1] disabled:cursor-not-allowed disabled:opacity-35"
                  disabled={!canResetProgress || busyAction === `reset-collection-${collection.id}`}
                  onClick={handleResetProgress}
                  title={canResetProgress ? "Reset progress" : "Only the assignee or an admin can reset progress"}
                  type="button"
                >
                  <RotateCcw aria-hidden="true" size={15} />
                </button>
              ) : null}
              <button
                className="task-card-primary inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[9px] bg-white px-3 text-[13px] font-bold text-[#151517] hover:bg-[#eee8f7] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canAdvance || busyAction === `collection-advance-${collection.id}`}
                onClick={() => onAdvance(collection)}
                type="button"
              >
                <CheckCircle2 aria-hidden="true" className="shrink-0" size={16} />
                {actionLabel}
              </button>
            </div>
            {selectedClip ? (
              <a
                aria-label={`Open selected clip on ${selectedPlatform ?? "source"}`}
                className="task-card-source inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-[9px] border border-white/[0.08] bg-white/[0.03] px-3 text-[13px] font-semibold text-white/48 hover:border-white/14 hover:bg-white/[0.055] hover:text-white/78"
                href={selectedClip.url}
                rel="noreferrer"
                target="_blank"
                title={`Open selected clip on ${selectedPlatform ?? "source"}`}
              >
                <ExternalLink aria-hidden="true" className="shrink-0" size={16} />
                <span className="task-card-source-label">Open selected</span>
              </a>
            ) : null}
            <button
              className="task-card-delete grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.045] text-white/48 hover:border-[#ff6b6b]/40 hover:text-[#ffb4b4] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busyAction === `delete-collection-${collection.id}`}
              onClick={() => onDelete(collection)}
              title="Delete collection and clips"
              type="button"
            >
              <Trash2 aria-hidden="true" size={16} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
