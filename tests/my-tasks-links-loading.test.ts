import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { taskMatchesFilter } from "../lib/cliproom/task-helpers.ts";
import type { Clip } from "../lib/cliproom/shared.ts";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const clip = (overrides: Partial<Clip> = {}): Clip => ({
  id: "clip_one",
  url: "https://clips.twitch.tv/ClipOne",
  title: "Clip one",
  category: "social",
  intakeSource: "manual",
  twitchCreatorLogin: null,
  status: "Claimed",
  priority: false,
  saved: false,
  assignee: "iseven",
  notes: "N/A",
  createdBy: "iseven",
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
  claimedAt: "2026-09-07T00:01:00.000Z",
  postedAt: null,
  ...overrides,
});

test("Saved is a first-class library lane immediately after All clips", async () => {
  const [shared, page] = await Promise.all([
    read("lib/cliproom/shared.ts"),
    read("app/page.tsx"),
  ]);

  assert.equal(taskMatchesFilter({ kind: "clip", clip: clip({ saved: true }) }, "saved", "iseven"), true);
  assert.equal(taskMatchesFilter({ kind: "clip", clip: clip() }, "saved", "iseven"), false);
  assert.equal(taskMatchesFilter({ kind: "clip", clip: clip({ intakeSource: "trusted_sync", saved: true }) }, "saved", "iseven"), true);
  assert.match(shared, /\{ id: "all", label: "All clips" \},\s*\{ id: "saved", label: "Saved" \},/);
  assert.match(page, /taskMatchesFilter\(task, categoryFilter, currentMember\?\.username \?\? ""\)/);
});

test("Clip Info exposes a polished copy-task-link action and deep links reveal the task", async () => {
  const [info, page, standalone, collection, helpers, css] = await Promise.all([
    read("components/cliproom/TaskInfoPopover.tsx"),
    read("app/page.tsx"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
    read("lib/cliproom/task-helpers.ts"),
    read("app/globals.css"),
  ]);

  assert.match(info, /Copy task link/);
  assert.match(info, /Link copied/);
  assert.match(info, /navigator\.clipboard\.writeText/);
  assert.match(info, /buildTaskLink/);
  assert.match(helpers, /export function taskDomId/);
  assert.match(helpers, /export function parseTaskLinkTarget/);
  assert.match(standalone, /id=\{taskDomId\("clip", clip\.id\)\}/);
  assert.match(collection, /id=\{taskDomId\("collection", collection\.id\)\}/);
  assert.match(page, /searchParams\.get\("task"\)/);
  assert.match(page, /scrollIntoView/);
  assert.match(page, /task-link-highlight/);
  assert.match(css, /\.task-link-highlight/);
});

test("initial room loading restores the original compact ClipRoom splash with no progress bar", async () => {
  const page = await read("app/page.tsx");

  assert.doesNotMatch(page, /RoomLoadingSkeleton/);
  assert.match(page, /<main className="grid min-h-screen place-items-center bg-\[#0e0e10\] px-6 text-white">/);
  assert.match(page, /h-14 w-14[\s\S]*?Opening ClipRoom[\s\S]*?Loading the private library\./);
  assert.doesNotMatch(page, /h-1 w-24/);
  assert.doesNotMatch(page, /animate-pulse/);
});

test("card titles use plain clamped text with no read-more overlay", async () => {
  const [standalone, collection, css] = await Promise.all([
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(standalone, /className="task-card-title-text"/);
  assert.match(collection, /className="task-card-title-text"/);
  const titleTextStart = css.indexOf(".task-card-title-text");
  const titleTextEnd = css.indexOf("}", titleTextStart);
  const titleTextRule = css.slice(titleTextStart, titleTextEnd);
  assert.match(titleTextRule, /-webkit-line-clamp:\s*3/);
  assert.doesNotMatch(standalone, /overlayCollapsedControl/);
  assert.doesNotMatch(collection, /overlayCollapsedControl/);
});
