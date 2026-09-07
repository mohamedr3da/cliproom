"use client";

import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";

const badgeOverflowEvent = "cliproom:badge-overflow-open";

type Props = {
  badges: ReactNode[];
  compactPrimaryIndex: number;
  label: string;
};

export function TaskBadgeOverflow({ badges, compactPrimaryIndex, label }: Props) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const primaryBadge = badges[compactPrimaryIndex] ?? badges[0] ?? null;
  const hiddenBadges = badges.filter((_, index) => index !== compactPrimaryIndex);

  useEffect(() => {
    function handleOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || rootRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleOtherOverflowOpen(event: Event) {
      if (!(event instanceof CustomEvent) || event.detail === id) return;
      setOpen(false);
    }

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    window.addEventListener(badgeOverflowEvent, handleOtherOverflowOpen);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
      window.removeEventListener(badgeOverflowEvent, handleOtherOverflowOpen);
    };
  }, [id]);

  function toggleOverflow() {
    setOpen((current) => {
      const next = !current;
      if (next) window.dispatchEvent(new CustomEvent(badgeOverflowEvent, { detail: id }));
      return next;
    });
  }

  return (
    <div ref={rootRef} className="task-badge-overflow relative min-w-0">
      <div className="task-badges-wide flex flex-wrap items-center gap-2">
        {badges.map((badge, index) => <Fragment key={index}>{badge}</Fragment>)}
      </div>
      <div className="task-badges-compact hidden items-center gap-2">
        {primaryBadge}
        {hiddenBadges.length > 0 ? (
          <span className="relative inline-flex">
            <button
              aria-expanded={open}
              aria-label={`Show ${hiddenBadges.length} more badges for ${label}`}
              className="inline-flex h-[26px] min-w-[34px] items-center justify-center rounded border border-white/10 bg-white/[0.045] px-2 text-xs font-semibold text-white/52 hover:border-[#9146ff]/35 hover:bg-[#9146ff]/10 hover:text-[#d8c6ff]"
              onClick={toggleOverflow}
              type="button"
            >
              +{hiddenBadges.length}
            </button>
            {open ? (
              <span className="task-badge-overflow-popover absolute left-0 top-[calc(100%+6px)] z-40 flex max-w-[220px] flex-wrap gap-2 rounded-[9px] border border-white/10 bg-[#1a1a1f]/98 p-2 shadow-[0_14px_34px_rgba(0,0,0,0.38)] backdrop-blur-xl">
                {hiddenBadges.map((badge, index) => <Fragment key={index}>{badge}</Fragment>)}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
