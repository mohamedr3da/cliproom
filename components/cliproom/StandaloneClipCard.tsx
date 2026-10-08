"use client";

import {
  Check,
  Clock3,
  ExternalLink,
  Heart,
  Pencil,
  ShieldCheck,
  Star,
  Tags,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { taskDomId } from "@/lib/cliproom/task-helpers";
import type { FormEvent, KeyboardEvent, MouseEvent } from "react";

import {
  categories,
  defaultTaskNotes,
  formatTaskTitleForDisplay,
  getClipEmbedUrl,
  getClipPlatform,
  maxClipNotesLength,
  maxClipTitleLength,
  normaliseTaskNotes,
} from "@/lib/cliproom/shared";
import type { Category, Clip } from "@/lib/cliproom/shared";
import {
  categoryLabel,
  formatTaskDate,
} from "@/components/cliproom/task-card-shared";
import { KickClipPlayer } from "@/components/cliproom/KickClipPlayer";
import { TaskInfoPopover } from "@/components/cliproom/TaskInfoPopover";
import { TaskBadgeOverflow } from "@/components/cliproom/TaskBadgeOverflow";
import { TwitchEmbedFrame, ExternalClipPreview } from "@/components/cliproom/TwitchEmbedFrame";

type Props = {
  clip: Clip;
  isAdmin: boolean;
  embedHost: string;
  busyAction: string | null;
  selectMode: boolean;
  selected: boolean;
  onDelete: (clip: Clip) => void;
  onToggleSelected: (clip: Clip) => void;
  onToggleSaved: (clip: Clip) => void;
  onTogglePriority: (clip: Clip) => void;
  onUpdate: (clip: Clip, input: { title: string; notes: string; category: Category }) => Promise<boolean>;
};

function submitParentFormOnEnter(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function shouldIgnoreSelectionToggle(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("a,button,input,textarea,select,label"));
}

function notesInputValue(notes: string) {
  return notes === defaultTaskNotes ? "" : notes;
}

export function StandaloneClipCard({
  clip,
  isAdmin,
  embedHost,
  busyAction,
  selectMode,
  selected,
  onDelete,
  onToggleSelected,
  onToggleSaved,
  onTogglePriority,
  onUpdate,
}: Props) {
  const platform = getClipPlatform(clip.url);
  const embedUrl = platform === "Twitch" ? getClipEmbedUrl(clip.url, embedHost) : null;
  const isTrustedSync = clip.intakeSource === "trusted_sync";
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(clip.title);
  const [editNotes, setEditNotes] = useState(clip.notes);
  const [editCategory, setEditCategory] = useState<Category>(clip.category);
  const trustedBadge = isTrustedSync ? (
    <span className="inline-flex min-w-0 items-center gap-1 rounded border border-[#2dd4bf]/40 bg-[#2dd4bf]/12 px-2.5 py-1 text-xs font-semibold text-[#b9fff7]">
      <ShieldCheck aria-hidden="true" className="shrink-0" size={12} />
      <span className="max-w-[180px] truncate">
        {clip.twitchCreatorLogin ? `@${clip.twitchCreatorLogin}` : "Trusted clipper"}
      </span>
    </span>
  ) : null;
  const categoryBadge = (
    <span className="rounded border border-white/10 bg-white/[0.055] px-2.5 py-1 text-xs text-white/56">
      {categoryLabel(clip.category)}
    </span>
  );
  const titleBadges = trustedBadge ? [trustedBadge] : [categoryBadge];
  const compactPrimaryIndex = 0;

  function openEdit() {
    if (editOpen) { setEditOpen(false); return; }
    setEditTitle(clip.title);
    setEditNotes(notesInputValue(clip.notes));
    setEditCategory(clip.category);
    setEditOpen(true);
  }

  async function submitEdit() {
    const saved = await onUpdate(clip, {
      title: editTitle,
      notes: normaliseTaskNotes(editNotes),
      category: editCategory,
    });
    if (saved) setEditOpen(false);
  }

  function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitEdit();
  }

  function handleSelectionClick(event: MouseEvent<HTMLElement>) {
    if (!selectMode || shouldIgnoreSelectionToggle(event.target)) return;
    onToggleSelected(clip);
  }

  return (
    <article
      id={taskDomId("clip", clip.id)}
      data-priority={clip.priority}
      data-select-mode={selectMode}
      data-selected={selected}
      onClick={handleSelectionClick}
      className={`queue-card group relative flex h-full flex-col overflow-hidden rounded-[14px] border bg-[#141416] ${
        clip.priority
          ? "border-[#facc15]/25 shadow-[0_14px_40px_rgba(0,0,0,0.18)]"
          : "border-white/[0.075]"
      }`}
    >
      {selectMode ? (
        <button
          aria-label={`${selected ? "Deselect" : "Select"} ${clip.title}`}
          aria-pressed={selected}
          className="task-card-select-toggle"
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelected(clip);
          }}
          type="button"
        >
          <Check aria-hidden="true" size={15} />
        </button>
      ) : null}
      <div className="relative border-b border-white/[0.07] bg-black">
        {platform === "Kick" ? (
          <KickClipPlayer clipId={clip.id} title={clip.title} url={clip.url} />
        ) : embedUrl ? (
          <TwitchEmbedFrame clipId={clip.id} platform="Twitch" src={embedUrl} title={clip.title} url={clip.url} />
        ) : (
          <ExternalClipPreview title={clip.title} url={clip.url} platform={platform ?? "source"} />
        )}
        {selectMode ? (
          <button
            aria-label={`${selected ? "Deselect" : "Select"} ${clip.title}`}
            aria-pressed={selected}
            className="task-card-media-select-cover"
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelected(clip);
            }}
            type="button"
          />
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-[18px]">
        <div className="task-card-title-block">
          <div className="task-card-title-row flex items-start justify-between gap-3">
            <div className="task-card-title-tags min-w-0">
              <TaskBadgeOverflow
                badges={titleBadges}
                compactPrimaryIndex={compactPrimaryIndex}
                label={clip.title}
              />
            </div>
            <div className="task-card-title-actions flex shrink-0 gap-2">
              <TaskInfoPopover kind="clip" task={clip} />
              <button
                aria-label={editOpen ? `Cancel editing ${clip.title}` : `Edit ${clip.title}`}
                aria-expanded={editOpen}
                className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/[0.045] text-white/46 hover:bg-white/[0.08] hover:text-white"
                onClick={openEdit}
                title={editOpen ? "Cancel editing" : "Edit details"}
                type="button"
              >
                <Pencil aria-hidden="true" size={16} />
              </button>
              <button
                aria-label={clip.priority ? `Remove ${clip.title} from priority` : `Prioritise ${clip.title}`}
                className={`grid h-10 w-10 place-items-center rounded-lg border ${
                  clip.priority
                    ? "border-[#facc15]/55 bg-[#facc15] text-black"
                    : "border-white/12 bg-white/[0.055] text-white/60 hover:text-white"
                } disabled:cursor-not-allowed disabled:opacity-50`}
                disabled={!isAdmin || busyAction === `priority-${clip.id}`}
                onClick={() => onTogglePriority(clip)}
                title={isAdmin ? "Toggle priority" : "Admins set priority"}
                type="button"
              >
                <Star aria-hidden="true" fill={clip.priority ? "currentColor" : "none"} size={18} />
              </button>
            </div>
          </div>
          <div className="task-card-title-copy">
            <h2 className="task-card-title-text" title={clip.title}>
              {formatTaskTitleForDisplay(clip.title)}
            </h2>
          </div>
        </div>

        {editOpen ? (
          <form autoComplete="off"
            className="mb-4 space-y-3 rounded-[10px] border border-[#9146ff]/20 bg-[#9146ff]/[0.055] p-3"
            onSubmit={handleEditSubmit}
          >
            <input autoComplete="off"
              aria-label="Clip title"
              className="h-10 w-full rounded-[8px] border border-white/[0.08] bg-black/20 px-3 text-sm text-white outline-none focus:border-[#9146ff]/55"
              maxLength={maxClipTitleLength}
              onChange={(event) => setEditTitle(event.target.value)}
              value={editTitle}
            />
            <textarea
              autoComplete="off"
              aria-label="Clip notes"
              className="h-16 w-full resize-none overflow-hidden rounded-[8px] border border-white/[0.08] bg-black/20 px-3 py-2 text-xs leading-5 text-white outline-none focus:border-[#9146ff]/55"
              maxLength={maxClipNotesLength}
              onChange={(event) => setEditNotes(event.target.value)}
              value={editNotes}
            />
            <div className="flex flex-wrap gap-1.5">
              {categories.map((item) => (
                <button
                  key={item.id}
                  aria-checked={editCategory === item.id}
                  className={`h-8 rounded-[8px] border px-2.5 text-[11px] font-semibold ${
                    editCategory === item.id
                      ? "border-[#9146ff]/45 bg-[#9146ff]/18 text-[#d8c6ff]"
                      : "border-white/[0.07] bg-white/[0.02] text-white/38"
                  }`}
                  onClick={() => setEditCategory(item.id)}
                  onKeyDown={submitParentFormOnEnter}
                  role="radio"
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
                disabled={!editTitle.trim() || busyAction === `update-clip-${clip.id}`}
                type="submit"
              >
                Save details
              </button>
            </div>
          </form>
        ) : clip.notes ? (
          <div className="task-card-notes mb-4 rounded-[10px] border border-white/[0.06] bg-white/[0.025] p-3">
            <p className="task-card-notes-text" title={clip.notes}>
              {clip.notes}
            </p>
          </div>
        ) : null}

        <div className="mt-auto pt-1">
          <div className="task-card-meta text-xs text-white/50">
            <span className="task-card-meta-date flex min-w-0 items-center gap-2">
              <Clock3 aria-hidden="true" className="shrink-0" size={14} />
              <span>{formatTaskDate(clip.createdAt)}</span>
            </span>
            <span className="task-card-meta-priority flex min-w-0 items-center gap-2">
              <Tags aria-hidden="true" className="shrink-0" size={14} />
              <span>{clip.priority ? "Priority" : "Normal"}</span>
            </span>
          </div>

          <div className="task-card-actions mt-4 border-t border-white/[0.07] pt-4">
            <div className="task-card-workflow">
              <button
                aria-pressed={clip.saved}
                className={`task-card-primary inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
                  clip.saved
                    ? "bg-[#ff5c93] text-white hover:bg-[#ff77a7]"
                    : "bg-white text-[#151517] hover:bg-[#eee8f7]"
                }`}
                disabled={busyAction === `save-${clip.id}`}
                onClick={() => onToggleSaved(clip)}
                type="button"
              >
                <Heart aria-hidden="true" className="shrink-0" fill={clip.saved ? "currentColor" : "none"} size={16} />
                {clip.saved ? "Saved" : "Save"}
              </button>
            </div>
            <a
              aria-label={`Open on ${platform ?? "source"}`}
              className="task-card-source inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-[9px] border border-white/[0.08] bg-white/[0.03] px-3 text-[13px] font-semibold text-white/48 hover:border-white/14 hover:bg-white/[0.055] hover:text-white/78"
              href={clip.url}
              rel="noreferrer"
              target="_blank"
              title={`Open on ${platform ?? "source"}`}
            >
              <ExternalLink aria-hidden="true" className="shrink-0" size={16} />
              <span className="task-card-source-label">Open on {getClipPlatform(clip.url) ?? "source"}</span>
            </a>
            <button
              className="task-card-delete grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.045] text-white/48 hover:border-[#ff6b6b]/40 hover:text-[#ffb4b4] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busyAction === `delete-${clip.id}`}
              onClick={() => onDelete(clip)}
              title="Remove clip"
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
