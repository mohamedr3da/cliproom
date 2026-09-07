import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  cleanClipTitle,
  defaultTaskNotes,
  normaliseTaskNotes,
} from "../lib/cliproom/shared.ts";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("empty task notes consistently normalise to N/A in forms, writes, and old rows", async () => {
  assert.equal(defaultTaskNotes, "N/A");
  assert.equal(normaliseTaskNotes(""), "N/A");
  assert.equal(normaliseTaskNotes("   "), "N/A");
  assert.equal(normaliseTaskNotes("  editing note  "), "editing note");

  const [page, intake, server] = await Promise.all([
    read("app/page.tsx"),
    read("components/cliproom/CollectionIntake.tsx"),
    read("lib/cliproom/server.ts"),
  ]);

  assert.match(page, /notes:\s*defaultTaskNotes/);
  assert.match(intake, /useState\(defaultTaskNotes\)/);
  assert.match(server, /notes:\s*normaliseTaskNotes\(row\.notes\)/);
  assert.match(server, /const rawNotes = normaliseTaskNotes\(input\.notes\)/);
  assert.match(server, /const notes = normaliseTaskNotes\(input\.notes\)/);
});

test("card title regions reserve the same collapsed height before notes", async () => {
  const [standalone, collection, css] = await Promise.all([
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(standalone, /task-card-title-copy/);
  assert.match(collection, /task-card-title-copy/);
  assert.match(css, /\.task-card-title-copy\s*\{[\s\S]*?min-height:\s*2\.5rem/);
  assert.match(standalone, /task-card-title-text/);
  assert.match(collection, /task-card-title-text/);
  assert.doesNotMatch(standalone, /overlayCollapsedControl/);
  assert.doesNotMatch(collection, /overlayCollapsedControl/);
});

test("task info is a lightweight draggable floating panel with only useful metadata", async () => {
  const info = await read("components/cliproom/TaskInfoPopover.tsx");

  for (const label of ["Title", "Added", "Added by", "Platform", "Last updated"]) {
    assert.match(info, new RegExp(`\\[\"${label}\"`));
  }
  for (const label of ["Status", "Assigned", "Priority", "Category", "Claimed", "Posted", "Clips"]) {
    assert.doesNotMatch(info, new RegExp(`\\[\"${label}\"`));
  }

  assert.doesNotMatch(info, /task-info-backdrop/);
  assert.doesNotMatch(info, /backdrop-blur/);
  assert.match(info, /pointer-events-none fixed inset-0/);
  assert.match(info, /pointer-events-auto/);
  assert.match(info, /function refreshInfo\(/);
  assert.match(info, /fetch\("\/api\/cliproom"/);
  assert.match(info, /onClick=\{refreshInfo\}/);

  const refreshStart = info.indexOf("function refreshInfo(");
  const refreshEnd = info.indexOf("\n  function ", refreshStart + 1);
  const refreshBody = info.slice(refreshStart, refreshEnd === -1 ? undefined : refreshEnd);
  assert.doesNotMatch(refreshBody, /setPanelPosition/);
});

test("Room Stats restores Clips and Trusted before the requested remaining order", async () => {
  const page = await read("app/page.tsx");
  const start = page.indexOf(">Room stats<");
  const end = page.indexOf("Private workspace for your creator team.", start);
  const stats = page.slice(start, end);

  const labels = [
    '["Clips", counts.all',
    '["Trusted", counts.trusted',
    '["Priority", priorityTasks.length',
    '["Posted", counts.posted',
    '["Members", roomState.memberCount',
    '["Online", roomState.onlineMemberCount',
  ];
  const positions = labels.map((label) => stats.indexOf(label));
  positions.forEach((position, index) => assert.ok(position !== -1, `${labels[index]} should be present`));
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index - 1] < positions[index], `${labels[index - 1]} should come before ${labels[index]}`);
  }
});

test("blank manual clip titles resolve from Twitch or Kick before a task is inserted", async () => {
  assert.notEqual(cleanClipTitle("https://kick.com/creator/clips/clip_01ABC"), "Untitled Kick clip");
  assert.notEqual(cleanClipTitle("https://clips.twitch.tv/ExampleSlug"), "Untitled Twitch clip");

  const server = await read("lib/cliproom/server.ts");
  assert.match(server, /async function resolveManualClipTitle\(/);
  assert.match(server, /fetchKickClipMetadata/);
  assert.match(server, /clips\?id=/);
  assert.match(server, /Couldn.t retrieve this clip.s title from (?:Kick|Twitch)/);
  assert.match(server, /const title = normaliseTaskTitle\(await resolveManualClipTitle\(url, rawTitle\)/);
  assert.match(server, /function visibleClipTitle\(/);
  assert.match(server, /title:\s*visibleClipTitle\(row\)/);
  assert.doesNotMatch(server, /clip\.title \|\| "Untitled Twitch clip"/);
});
