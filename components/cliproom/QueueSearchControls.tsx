"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { defaultQueueViewOptions, type QueueViewOptions } from "@/lib/cliproom/task-helpers";

type Props = { query: string; onQueryChange: (value: string) => void; options: QueueViewOptions; onOptionsChange: (value: QueueViewOptions) => void };
const fields: { key: keyof QueueViewOptions; label: string; choices: readonly (readonly [string, string])[] }[] = [
  { key: "priority", label: "Priority", choices: [["all", "All priorities"], ["priority", "Prioritised"], ["normal", "Normal"]] },
  { key: "assignment", label: "Assignment", choices: [["all", "Anyone"], ["unclaimed", "Unclaimed"], ["claimed", "Claimed"], ["mine", "Assigned to me"]] },
  { key: "status", label: "Status", choices: [["all", "Any status"], ...["New", "Prioritised", "Claimed", "Editing", "Posted"].map((value) => [value, value] as const)] },
  { key: "kind", label: "Task type", choices: [["all", "Clips & collections"], ["clip", "Clips"], ["collection", "Collections"]] },
  { key: "sort", label: "Sort by", choices: [["queue", "Queue order"], ["newest", "Newest first"], ["oldest", "Oldest first"]] },
];

export function QueueSearchControls({ query, onQueryChange, options, onOptionsChange }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const activeCount = fields.filter(({ key }) => options[key] !== defaultQueueViewOptions[key]).length;
  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);
  return (
    <div className="relative flex w-full min-w-0 max-w-[720px] gap-2" ref={root}>
      <div className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-white/[0.08] bg-white/[0.045] px-3 text-white/44 transition focus-within:border-[#9146ff]/65 focus-within:bg-white/[0.065]">
        <Search aria-hidden="true" className="shrink-0" size={16} />
        <input aria-label="Search tasks" autoComplete="off" className="h-full min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/28" onChange={(event) => onQueryChange(event.target.value)} placeholder="Search titles, notes, people…" value={query} />
        {query ? <button aria-label="Clear search" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-white/45 hover:bg-white/10 hover:text-white" onClick={() => onQueryChange("")} type="button"><X size={14} /></button> : null}
      </div>
      <button aria-controls={`${id}-panel`} aria-expanded={open} className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] border px-3 text-xs font-bold ${open || activeCount ? "border-[#9146ff]/55 bg-[#9146ff]/15 text-[#dac8ff]" : "border-white/[0.09] bg-white/[0.045] text-white/60 hover:bg-white/[0.09] hover:text-white"}`} onClick={() => setOpen(!open)} ref={trigger} type="button">
        <SlidersHorizontal aria-hidden="true" size={16} />Filters
        {activeCount ? <span className="grid h-5 min-w-5 place-items-center rounded-md bg-[#9146ff] px-1 text-[10px] text-white">{activeCount}</span> : null}
      </button>
      {open ? <section aria-label="Queue filters" className="absolute right-0 top-12 z-40 w-[360px] max-w-[calc(100vw-2rem)] rounded-[14px] border border-[#9146ff]/25 bg-[#18161e] p-4 shadow-[0_16px_60px_rgba(0,0,0,0.55)]" id={`${id}-panel`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><h2 className="text-sm font-bold">Refine your queue</h2><p className="mt-1 text-xs text-white/40">Filters apply as you choose.</p></div>
          <button aria-label="Close filters" className="grid h-8 w-8 place-items-center rounded-lg text-white/45 hover:bg-white/10 hover:text-white" onClick={() => { setOpen(false); trigger.current?.focus(); }} type="button"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">{fields.map(({ key, label, choices }) => <div className={key === "sort" ? "col-span-2" : "min-w-0"} key={key}>
          <label className="mb-1.5 inline-block text-[11px] font-semibold text-white/50" htmlFor={`${id}-${key}`}>{label}</label>
          <select autoComplete="off" className="h-10 w-full rounded-[9px] border border-white/10 bg-[#24212b] px-2.5 text-xs text-white outline-none focus:border-[#9146ff]/65" id={`${id}-${key}`} onChange={(event) => onOptionsChange({ ...options, [key]: event.target.value })} value={options[key]}>{choices.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
        </div>)}</div>
        <div className="mt-4 flex items-center justify-between border-t border-white/[0.07] pt-3">
          <span className="text-[11px] text-white/35">{activeCount ? `${activeCount} active ${activeCount === 1 ? "setting" : "settings"}` : "All tasks in this category"}</span>
          <button className="rounded-md px-2 py-1 text-xs font-semibold text-[#cdb5ff] hover:bg-[#9146ff]/15 disabled:opacity-35" disabled={!activeCount} onClick={() => onOptionsChange({ ...defaultQueueViewOptions })} type="button">Reset filters</button>
        </div>
      </section> : null}
    </div>
  );
}
