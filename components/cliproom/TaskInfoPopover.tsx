"use client";

import { Check, Copy, GripHorizontal, Info, Link2, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, PointerEvent } from "react";

import { formatUserDateTime } from "@/components/cliproom/date-format";
import { buildTaskLink } from "@/lib/cliproom/task-helpers";
import { getClipPlatform } from "@/lib/cliproom/shared";
import type { Clip, Collection, RoomState } from "@/lib/cliproom/shared";

type Task = Clip | Collection;

type Props = {
  task: Task;
  kind: "clip" | "collection";
};

function metadataRows(task: Task, kind: Props["kind"]) {
  const rows: [string, string][] = [
    ["Title", task.title],
    ["Added", formatUserDateTime(task.createdAt)],
    ["Added by", task.createdBy ?? "Unknown"],
  ];

  if (kind === "clip") {
    rows.push(["Platform", getClipPlatform((task as Clip).url) ?? "Source"]);
  }

  rows.push(["Last updated", formatUserDateTime(task.updatedAt)]);
  return rows;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function findTask(state: RoomState, kind: Props["kind"], id: string): Task | null {
  if (kind === "collection") {
    return state.collections.find((collection) => collection.id === id)
      ?? state.trash?.collections.find((collection) => collection.id === id)
      ?? null;
  }

  return state.clips.find((clip) => clip.id === id)
    ?? state.collections.flatMap((collection) => collection.clips).find((clip) => clip.id === id)
    ?? state.trash?.clips.find((clip) => clip.id === id)
    ?? null;
}

export function TaskInfoPopover({ task, kind }: Props) {
  const [open, setOpen] = useState(false);
  const [refreshedTask, setRefreshedTask] = useState<Task | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleOutsidePointerDown(event: globalThis.PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (dialogRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [open]);

  function anchoredPosition() {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return { x: 16, y: 16 };
    const width = Math.min(360, window.innerWidth - 16);
    const x = clamp(trigger.right - width, 8, Math.max(8, window.innerWidth - width - 8));
    const y = clamp(trigger.bottom + 8, 8, Math.max(8, window.innerHeight - 260));
    return { x, y };
  }

  function openInfo() {
    if (open) {
      setOpen(false);
      return;
    }
    setRefreshedTask(null);
    setLinkCopied(false);
    setPanelPosition(anchoredPosition());
    setOpen(true);
  }

  function closeInfo() {
    setOpen(false);
  }

  async function refreshInfo() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/cliproom", { credentials: "same-origin" });
      if (!response.ok) return;
      const state = await response.json() as RoomState;
      const refreshed = findTask(state, kind, task.id);
      if (refreshed) setRefreshedTask(refreshed);
    } finally {
      setRefreshing(false);
    }
  }

  async function copyTaskLink() {
    const link = buildTaskLink(window.location.origin, window.location.pathname, kind, task.id);
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      setLinkCopied(false);
    }
  }

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    dragPointerIdRef.current = event.pointerId;
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    setPanelPosition({ x: rect.left, y: rect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    if (dragPointerIdRef.current !== event.pointerId) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    setPanelPosition({
      x: clamp(event.clientX - dragOffsetRef.current.x, 8, window.innerWidth - rect.width - 8),
      y: clamp(event.clientY - dragOffsetRef.current.y, 8, window.innerHeight - rect.height - 8),
    });
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    if (dragPointerIdRef.current !== event.pointerId) return;
    dragPointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const displayTask = refreshedTask ?? task;

  const dialogStyle: CSSProperties = {
    left: panelPosition?.x ?? 16,
    top: panelPosition?.y ?? 16,
  };

  return (
    <>
      <button
        aria-label={`Show info for ${task.title}`}
        aria-expanded={open}
        className="grid h-10 w-10 list-none place-items-center rounded-lg border border-white/10 bg-white/[0.045] text-white/46 hover:bg-white/[0.08] hover:text-white"
        onClick={openInfo}
        ref={triggerRef}
        title="Task info"
        type="button"
      >
        <Info aria-hidden="true" size={16} />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="pointer-events-none fixed inset-0 z-50">
              <section
                aria-label={`Info for ${displayTask.title}`}
                className="task-info-dialog pointer-events-auto fixed w-[min(22rem,calc(100vw-1rem))] max-h-[min(28rem,calc(100vh-1rem))] overflow-y-auto rounded-[12px] border border-white/[0.09] bg-[#17171b]/[0.985] p-3 text-left shadow-[0_18px_50px_rgba(0,0,0,0.42)]"
                ref={(element) => {
                  dialogRef.current = element;
                }}
                role="dialog"
                style={dialogStyle}
              >
                <div
                  className="task-info-drag-handle mb-3 grid grid-cols-[1fr_auto_auto] items-center gap-2 cursor-grab active:cursor-grabbing"
                  onPointerDown={startDrag}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  title="Drag info panel"
                >
                  <div className="min-w-0 rounded-[8px] px-1 py-1 text-white/54">
                    <div className="flex items-center gap-2">
                      <GripHorizontal aria-hidden="true" className="shrink-0" size={15} />
                      <p className="truncate text-[10px] font-bold uppercase text-white/38">
                        {kind === "collection" ? "Collection info" : "Clip info"}
                      </p>
                    </div>
                  </div>
                  <button
                    aria-label="Refresh info"
                    className="grid h-8 w-8 place-items-center rounded-[8px] border border-white/[0.08] bg-white/[0.03] text-white/38 hover:bg-white/[0.07] hover:text-white disabled:opacity-45"
                    disabled={refreshing}
                    onClick={refreshInfo}
                    onPointerDown={(event) => event.stopPropagation()}
                    title="Refresh info"
                    type="button"
                  >
                    <RefreshCw aria-hidden="true" className={refreshing ? "animate-spin motion-reduce:animate-none" : ""} size={14} />
                  </button>
                  <button
                    aria-label="Close task info"
                    className="grid h-8 w-8 place-items-center rounded-[8px] border border-white/[0.08] bg-white/[0.03] text-white/42 hover:bg-white/[0.07] hover:text-white"
                    onClick={closeInfo}
                    onPointerDown={(event) => event.stopPropagation()}
                    title="Close"
                    type="button"
                  >
                    <X aria-hidden="true" size={15} />
                  </button>
                </div>
                <dl className="space-y-1.5">
                  {metadataRows(displayTask, kind).map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[5.75rem_minmax(0,1fr)] gap-2 text-xs leading-5">
                      <dt className="text-white/34">{label}</dt>
                      <dd className="min-w-0 break-words font-semibold text-white/68" title={value}>
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3 border-t border-white/[0.07] pt-3">
                  <button
                    aria-label={linkCopied ? "Task link copied" : `Copy task link for ${displayTask.title}`}
                    className={`group flex w-full items-center gap-2.5 rounded-[9px] border px-3 py-2.5 text-left transition ${
                      linkCopied
                        ? "border-[#34d399]/20 bg-[#34d399]/[0.055] text-[#9ff3d1]"
                        : "border-[#9146ff]/20 bg-[#9146ff]/[0.055] text-[#d9c8ff] hover:border-[#9146ff]/35 hover:bg-[#9146ff]/[0.09]"
                    }`}
                    onClick={copyTaskLink}
                    type="button"
                  >
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[7px] ${linkCopied ? "bg-[#34d399]/10" : "bg-[#9146ff]/10"}`}>
                      {linkCopied ? <Check aria-hidden="true" size={14} /> : <Link2 aria-hidden="true" size={14} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-bold">{linkCopied ? "Link copied" : "Copy task link"}</span>
                      <span className="mt-0.5 block truncate text-[10px] font-medium text-white/30">Share this task with your team</span>
                    </span>
                    <Copy aria-hidden="true" className="shrink-0 text-white/28 group-hover:text-white/48" size={14} />
                  </button>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
