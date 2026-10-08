"use client";

import { ChevronDown, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatUserDate } from "@/components/cliproom/date-format";
import { deletedTaskRetentionDays } from "@/lib/cliproom/shared";
import type { Clip, Collection, RoomState } from "@/lib/cliproom/shared";

type DeletedTask = Clip | Collection;

function deletedMeta(task: DeletedTask) {
  const parts: string[] = [];
  if (task.deletedAt) {
    parts.push(`Deleted ${formatUserDate(task.deletedAt)}`);
  }
  if (task.deletedBy) parts.push(`Deleted by @${task.deletedBy}`);
  else if (task.status === "Posted") parts.push("Moved automatically");
  else parts.push("Deleted by unavailable");
  return parts.join(" · ");
}

export function RecentlyDeleted({ trash, busyAction, onRestore, onPermanentDelete, isAdmin }: {
  trash: RoomState["trash"];
  busyAction: string | null;
  onRestore: (kind: "clip" | "collection", id: string, title: string) => Promise<boolean>;
  onPermanentDelete?: (kind: "clip" | "collection", id: string, title: string) => Promise<boolean>;
  isAdmin: boolean;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const tasks = [...(trash?.clips ?? []).map((task) => ({ kind: "clip" as const, task })), ...(trash?.collections ?? []).map((task) => ({ kind: "collection" as const, task }))].sort((a, b) => (b.task.deletedAt ?? "").localeCompare(a.task.deletedAt ?? ""));
  return <details className="group/trash mb-4 rounded-[10px] border border-white/[0.07] bg-white/[0.02]">
    <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-3 text-xs font-semibold text-white/50 hover:text-white/80 [&::-webkit-details-marker]:hidden">
      <Trash2 aria-hidden="true" size={14} />Recently deleted
      {tasks.length ? <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[10px]">{tasks.length}</span> : null}
      <ChevronDown aria-hidden="true" className="ml-auto transition-transform group-open/trash:rotate-180" size={14} />
    </summary>
    <div className="border-t border-white/[0.06] px-3.5 pb-3.5 pt-3">
      <p className="mb-3 text-xs leading-5 text-white/40">Deleted clips and collections stay here for {deletedTaskRetentionDays} days before being removed forever. Restore them before then to keep them.</p>
      {tasks.length ? <ul className="max-h-80 space-y-2 overflow-y-auto">{tasks.map(({ kind, task }) => <li className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.06] bg-[#17161c] p-3" key={`${kind}-${task.id}`}>
        <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-white/80" title={task.title}>{task.title}</p><p className="mt-1 text-[11px] text-white/35">{kind === "collection" ? "Collection" : "Clip"} · {deletedMeta(task)}</p></div>
        <button className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[#9146ff]/25 bg-[#9146ff]/10 px-2.5 text-xs font-semibold text-[#cdb5ff] hover:bg-[#9146ff]/20 disabled:opacity-40" disabled={busyAction === `restore-${task.id}`} onClick={() => void onRestore(kind, task.id, task.title)} type="button"><RotateCcw aria-hidden="true" size={13} />Restore<span className="sr-only"> {task.title}</span></button>
        {isAdmin && onPermanentDelete ? <button aria-label={`Permanently delete ${task.title}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-white/40 hover:border-red-400/35 hover:bg-red-400/10 hover:text-red-300" onClick={() => setConfirmId(confirmId === task.id ? null : task.id)} title="Delete permanently" type="button"><Trash2 aria-hidden="true" size={14} /></button> : null}
        {isAdmin && onPermanentDelete && confirmId === task.id ? <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-red-400/20 bg-red-400/[0.04] p-3" role="alert">
          <p className="min-w-0 flex-1 text-xs leading-5 text-red-200/80">Permanently delete “{task.title}”{kind === "collection" ? " and all its clips" : ""}? This cannot be undone.</p>
          <button className="h-8 rounded-md px-2.5 text-xs font-semibold text-white/55 hover:bg-white/5" onClick={() => setConfirmId(null)} type="button">Cancel</button>
          <button className="h-8 rounded-md bg-red-400/15 px-2.5 text-xs font-bold text-red-200 hover:bg-red-400/25 disabled:opacity-40" disabled={busyAction === `permanent-delete-${task.id}`} onClick={async () => { if (await onPermanentDelete(kind, task.id, task.title)) setConfirmId(null); }} type="button">{busyAction === `permanent-delete-${task.id}` ? "Deleting…" : "Delete forever"}</button>
        </div> : null}
      </li>)}</ul> : <p className="py-2 text-xs text-white/45">Nothing in Recently deleted.</p>}
    </div>
  </details>;
}
