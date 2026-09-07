import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("audit log subtitle states the shared 90-day retention window", async () => {
  const [shared, server, auditPage] = await Promise.all([
    read("lib/cliproom/shared.ts"),
    read("lib/cliproom/server.ts"),
    read("app/audit/page.tsx"),
  ]);

  assert.match(shared, /export const auditLogRetentionDays\s*=\s*90/);
  assert.match(server, /auditLogRetentionDays,/);
  assert.doesNotMatch(server, /const auditLogRetentionDays\s*=\s*90/);
  assert.match(auditPage, /auditLogRetentionDays/);
  assert.match(auditPage, /Logs are automatically deleted after \{auditLogRetentionDays\} days\./);
});

test("card title spacing moves the new title strip away from controls and closer to notes", async () => {
  const [css, standalone, collection] = await Promise.all([
    read("app/globals.css"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
  ]);

  assert.match(css, /\.task-card-title-block\s*\{[\s\S]*?margin-bottom:\s*0\.25rem/);
  assert.match(css, /\.task-card-title-row\s*\{[\s\S]*?margin-bottom:\s*0\.5rem/);
  assert.match(css, /\.task-card-title-copy\s*\{[\s\S]*?min-height:\s*2\.5rem/);
  assert.match(css, /\.task-card-title-text\s*\{[\s\S]*?-webkit-line-clamp:\s*2/);
  for (const card of [standalone, collection]) {
    assert.match(card, /className="task-card-title-block"/);
    assert.match(card, /className="task-card-title-text"/);
    assert.doesNotMatch(card, /overlayCollapsedControl/);
    assert.doesNotMatch(card, /task-card-title-block mb-3/);
  }
});

test("task info closes on outside pointer interaction so only one popover remains open", async () => {
  const info = await read("components/cliproom/TaskInfoPopover.tsx");

  assert.match(info, /import \{ useEffect, useRef, useState \} from "react"/);
  assert.match(info, /document\.addEventListener\("pointerdown", handleOutsidePointerDown\)/);
  assert.match(info, /document\.removeEventListener\("pointerdown", handleOutsidePointerDown\)/);
  assert.match(info, /dialogRef\.current\?\.contains\(target\)/);
  assert.match(info, /triggerRef\.current\?\.contains\(target\)/);
  assert.match(info, /setOpen\(false\)/);
});

test("narrow task cards use a +N overflow instead of rearranging the card header", async () => {
  const [css, standalone, collection, overflow] = await Promise.all([
    read("app/globals.css"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
    read("components/cliproom/TaskBadgeOverflow.tsx"),
  ]);

  assert.match(css, /@container task-card \(max-width:\s*21\.5rem\)[\s\S]*?\.task-badges-compact\s*\{[\s\S]*?display:\s*flex/);
  assert.doesNotMatch(css, /@container task-card \(max-width:\s*21\.5rem\)[\s\S]*?\.task-card-title-row\s*\{[\s\S]*?display:\s*grid/);
  assert.match(overflow, /aria-expanded=\{open\}/);
  assert.match(overflow, /top-\[calc\(100%\+6px\)\]/);

  for (const card of [standalone, collection]) {
    assert.match(card, /TaskBadgeOverflow/);
    assert.match(card, /task-card-title-actions/);
  }
});
