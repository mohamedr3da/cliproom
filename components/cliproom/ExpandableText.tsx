"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";

type Props = {
  text: string;
  label: string;
  as?: "h2" | "p";
  lines?: number;
  expandedLines?: number;
  className?: string;
};

const controlClassName =
  "shrink-0 rounded text-[11px] font-semibold leading-5 text-[#cdb5ff] hover:text-[#e7dbff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9146ff]";

function ExpandableTextSurface({
  text,
  label,
  as: Text = "p",
  lines = 3,
  expandedLines,
  className = "",
}: Props) {
  const textId = useId();
  const textRef = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    let disposed = false;

    function measure() {
      if (disposed || !element) return;

      // Measure the title at its real card width with clamping temporarily
      // removed. Chromium can report equal scroll/client heights for an
      // already-clamped element even while painting an ellipsis, which used to
      // hide the Read more control on some normal/collapsed card widths.
      const computed = getComputedStyle(element);
      const lineHeight = Number.parseFloat(computed.lineHeight);
      const fallbackLineHeight = Number.parseFloat(computed.fontSize) * 1.25;
      const collapsedHeight = (Number.isFinite(lineHeight) ? lineHeight : fallbackLineHeight) * lines;
      const previousDisplay = element.style.display;
      const previousClamp = element.style.webkitLineClamp;
      const previousOverflow = element.style.overflow;
      const previousMinHeight = element.style.minHeight;
      const previousMaxHeight = element.style.maxHeight;
      const previousHeight = element.style.height;
      const previousOrient = element.style.getPropertyValue("-webkit-box-orient");

      element.style.display = "block";
      element.style.webkitLineClamp = "unset";
      element.style.overflow = "visible";
      element.style.minHeight = "0";
      element.style.maxHeight = "none";
      element.style.height = "auto";
      element.style.removeProperty("-webkit-box-orient");
      const naturalHeight = element.scrollHeight;

      element.style.display = previousDisplay;
      element.style.webkitLineClamp = previousClamp;
      element.style.overflow = previousOverflow;
      element.style.minHeight = previousMinHeight;
      element.style.maxHeight = previousMaxHeight;
      element.style.height = previousHeight;
      if (previousOrient) element.style.setProperty("-webkit-box-orient", previousOrient);
      else element.style.removeProperty("-webkit-box-orient");

      setHasOverflow(naturalHeight > collapsedHeight + 1);
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      disposed = true;
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [expanded, lines]);

  const commonProps = {
    id: textId,
    ref: (element: HTMLElement | null) => { textRef.current = element; },
    title: expandedLines ? text : undefined,
  };

  if (expanded) {
    return (
      <div className="min-w-0">
        <Text
          {...commonProps}
          className={className}
          style={{
            overflowWrap: "anywhere",
            whiteSpace: "pre-wrap",
          }}
        >
          {text}
          {hasOverflow ? (
            <>
              {" "}
              <button
                aria-controls={textId}
                aria-expanded="true"
                aria-label={`Show less of ${label}`}
                className={`${controlClassName} inline align-baseline`}
                onClick={() => setExpanded(false)}
                type="button"
              >
                Show less
              </button>
            </>
          ) : null}
        </Text>
      </div>
    );
  }

  const collapsedText = (
    <Text
      {...commonProps}
      className={`${className}${hasOverflow ? " min-w-0 flex-1" : ""}`}
      style={{
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: String(lines),
        overflow: "hidden",
        overflowWrap: "anywhere",
        whiteSpace: "pre-wrap",
      }}
    >
      {text}
    </Text>
  );

  return (
    <div className="min-w-0">
      <div className={hasOverflow ? "flex min-w-0 items-end gap-1" : "min-w-0"}>
        {collapsedText}
        {hasOverflow ? (
          <button
            aria-controls={textId}
            aria-expanded="false"
            aria-label={`Read more of ${label}`}
            className={controlClassName}
            onClick={() => setExpanded(true)}
            type="button"
          >
            Read more
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ExpandableText(props: Props) {
  return <ExpandableTextSurface key={props.text} {...props} />;
}
