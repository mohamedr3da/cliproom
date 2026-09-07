import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("narrow task cards keep one primary badge and collapse the rest into +N", async () => {
  const [css, standalone, collection, overflow] = await Promise.all([
    read("app/globals.css"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
    read("components/cliproom/TaskBadgeOverflow.tsx"),
  ]);

  assert.match(css, /@container task-card \(max-width:\s*21\.5rem\)[\s\S]*?\.task-badges-wide\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /@container task-card \(max-width:\s*21\.5rem\)[\s\S]*?\.task-badges-compact\s*\{[\s\S]*?display:\s*flex/);
  assert.match(overflow, /\+\{hiddenBadges\.length\}/);
  assert.match(overflow, /task-badge-overflow-popover/);

  for (const card of [standalone, collection]) {
    assert.match(card, /TaskBadgeOverflow/);
    assert.match(card, /task-card-title-actions/);
  }
});

test("only the task info header strip starts dragging while its buttons remain interactive", async () => {
  const info = await read("components/cliproom/TaskInfoPopover.tsx");

  assert.match(info, /className="task-info-drag-handle[^\"]*grid grid-cols-\[1fr_auto_auto\]/);
  assert.match(info, /className="task-info-drag-handle[^\"]*"[\s\S]*?onPointerDown=\{startDrag\}[\s\S]*?onPointerMove=\{moveDrag\}[\s\S]*?onPointerUp=\{endDrag\}[\s\S]*?onPointerCancel=\{endDrag\}/);
  assert.match(info, /aria-label="Refresh info"[\s\S]*?onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(info, /aria-label="Close task info"[\s\S]*?onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  const sectionTag = info.match(/<section[\s\S]*?>/)?.[0] ?? "";
  assert.doesNotMatch(sectionTag, /onPointerDown=\{startDrag\}/);
});
