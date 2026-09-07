"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import {
  categories,
  defaultTaskNotes,
  maxClipUrlLength,
  maxCollectionNotesLength,
  maxCollectionTitleLength,
} from "@/lib/cliproom/shared";
import type { Category } from "@/lib/cliproom/shared";

export type CollectionCreateInput = {
  title: string;
  notes: string;
  category: Category;
  urls: string[];
};

type Props = {
  busy: boolean;
  onSubmit: (input: CollectionCreateInput) => Promise<void>;
};

function submitParentFormOnEnter(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

export function CollectionIntake({ busy, onSubmit }: Props) {
  const fieldId = useId();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState(defaultTaskNotes);
  const [category, setCategory] = useState<Category>("social");
  const [urls, setUrls] = useState([""]);

  function updateUrl(index: number, value: string) {
    setUrls((current) => current.map((url, itemIndex) => (itemIndex === index ? value : url)));
  }

  function removeUrl(index: number) {
    setUrls((current) => {
      if (current.length === 1) return [""];
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      title,
      notes,
      category,
      urls: urls.map((url) => url.trim()).filter(Boolean),
    });
  }

  return (
    <div className="mb-5 rounded-[14px] border border-[#9146ff]/20 bg-[linear-gradient(145deg,rgba(145,70,255,0.08),rgba(255,255,255,0.025))] p-4 sm:p-5">
      <div className="mb-4">
        <p className="text-sm font-bold">Create a collection</p>
        <p className="mt-1 text-xs leading-5 text-white/36">
          One editing task, as many Twitch or Kick clips as you need. You can add more later.
        </p>
      </div>

      <form autoComplete="off" className="space-y-4" onSubmit={submit}>
        <div className="collection-intake-fields grid gap-3">
          <div className="min-w-0">
            <label className="mb-1.5 inline-block text-[11px] font-semibold text-white/38" htmlFor={`${fieldId}-title`}>
              Collection title
            </label>
            <input
              autoComplete="off"
              className="h-11 w-full rounded-[10px] border border-white/[0.08] bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/22 focus:border-[#9146ff]/60 focus:bg-white/[0.045]"
              id={`${fieldId}-title`}
              maxLength={maxCollectionTitleLength}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Wholesome SU moments"
              required
              value={title}
            />
          </div>
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold text-white/38">Category</span>
            <div
              aria-label="Collection category"
              className="grid grid-cols-2 gap-1 rounded-[10px] border border-white/[0.08] bg-black/20 p-1"
              role="radiogroup"
            >
              {categories.map((item) => (
                <button
                  key={item.id}
                  aria-checked={category === item.id}
                  className={`h-9 rounded-[7px] px-2 text-xs font-semibold ${
                    category === item.id
                      ? "bg-white/[0.11] text-white"
                      : "text-white/36 hover:bg-white/[0.05] hover:text-white/70"
                  }`}
                  onClick={() => setCategory(item.id)}
                  onKeyDown={submitParentFormOnEnter}
                  role="radio"
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1.5 inline-block text-[11px] font-semibold text-white/38" htmlFor={`${fieldId}-notes`}>
            Notes
          </label>
          <textarea
            autoComplete="off"
            className="h-24 w-full resize-none overflow-y-auto rounded-[10px] border border-white/[0.08] bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/22 focus:border-[#9146ff]/60 focus:bg-white/[0.045]"
            id={`${fieldId}-notes`}
            maxLength={maxCollectionNotesLength}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Hook, caption idea, context, edit direction..."
            value={notes}
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold text-white/38">Twitch or Kick clips</span>
            <span className="text-[11px] text-white/26">No clip-count limit</span>
          </div>
          <div className="space-y-2">
            {urls.map((url, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] border border-white/[0.07] bg-white/[0.03] text-xs font-black text-white/42">
                  {index + 1}
                </span>
                <input
                  aria-label={`Collection clip ${index + 1} URL`}
                  autoComplete="off"
                  className="h-11 min-w-0 flex-1 rounded-[10px] border border-white/[0.08] bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/22 focus:border-[#9146ff]/60 focus:bg-white/[0.045]"
                  maxLength={maxClipUrlLength}
                  onChange={(event) => updateUrl(index, event.target.value)}
                  placeholder="Paste a Twitch or Kick clip URL"
                  required={index === 0}
                  value={url}
                />
                <button
                  aria-label={`Remove clip ${index + 1}`}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-[9px] border border-white/[0.08] bg-white/[0.025] text-white/36 hover:border-[#ff6b6b]/30 hover:bg-[#ff6b6b]/5 hover:text-[#ffb4b4]"
                  onClick={() => removeUrl(index)}
                  title="Remove clip"
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="mt-2 inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[9px] border border-white/[0.08] bg-white/[0.025] px-3 text-xs font-semibold text-white/48 hover:bg-white/[0.055] hover:text-white/76"
            onClick={() => setUrls((current) => [...current, ""])}
            type="button"
          >
            <Plus aria-hidden="true" className="shrink-0" size={15} />
            Add another clip
          </button>
        </div>

        <div className="flex justify-end">
          <button
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-white px-5 text-sm font-bold text-[#111114] hover:bg-[#eee8f7] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy}
            type="submit"
          >
            <Plus aria-hidden="true" className="shrink-0" size={17} />
            {busy ? "Creating" : "Create collection"}
          </button>
        </div>
      </form>
    </div>
  );
}
