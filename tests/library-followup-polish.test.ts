import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  maxClipTitleLength,
  maxCollectionTitleLength,
} from "../lib/cliproom/shared.ts";
import {
  deletedRetentionMs,
} from "../lib/cliproom/retention.ts";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("library titles keep enough saved text for the card title space", async () => {
  assert.equal(maxClipTitleLength, 120);
  assert.equal(maxCollectionTitleLength, 120);

  const [page, standalone, collection, shared] = await Promise.all([
    read("app/page.tsx"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
    read("lib/cliproom/shared.ts"),
  ]);

  assert.match(shared, /maxClipTitleLength\s*=\s*120/);
  assert.match(shared, /maxCollectionTitleLength\s*=\s*120/);
  assert.match(page, /maxLength=\{maxClipTitleLength\}/);
  assert.match(standalone, /maxLength=\{maxClipTitleLength\}/);
  assert.match(collection, /maxLength=\{maxCollectionTitleLength\}/);
});

test("library page copy and sidebar panels match the library workflow", async () => {
  const page = await read("app/page.tsx");
  const sourceStart = page.indexOf(">Twitch source<");
  const teamStart = page.indexOf(">Team<");

  assert.match(page, /ClipRoom library/);
  assert.doesNotMatch(page, /Review library/);
  assert.doesNotMatch(page, />Priority clips</);
  assert.ok(sourceStart !== -1, "Twitch source panel should exist");
  assert.ok(teamStart !== -1, "Team panel should exist");
  assert.ok(sourceStart < teamStart, "Twitch source should render above Team");
});

test("selection mode blocks media playback and turns the player area into a selector", async () => {
  const [standalone, collection, css] = await Promise.all([
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
    read("app/globals.css"),
  ]);

  for (const card of [standalone, collection]) {
    assert.match(card, /className="relative border-b border-white\/\[0\.07\] bg-black"/);
    assert.match(card, /task-card-media-select-cover/);
    assert.match(card, /onToggleSelected\(/);
  }

  assert.match(css, /\.task-card-media-select-cover/);
  assert.match(css, /position:\s*absolute/);
  assert.match(css, /inset:\s*0/);
});

test("Twitch embeds mount only after measured dimensions are available", async () => {
  const frame = await read("components/cliproom/TwitchEmbedFrame.tsx");

  assert.match(frame, /const \[frameSize, setFrameSize\]/);
  assert.match(frame, /frameReady/);
  assert.match(frame, /width=\{frameSize\.width\}/);
  assert.match(frame, /height=\{frameSize\.height\}/);
  assert.match(frame, /frameReady \? <iframe/);
});

test("recently deleted library items purge after seven days", async () => {
  assert.equal(deletedRetentionMs, 7 * 24 * 60 * 60 * 1000);

  const [shared, retention, page, deletedPanel] = await Promise.all([
    read("lib/cliproom/shared.ts"),
    read("lib/cliproom/retention.ts"),
    read("app/page.tsx"),
    read("components/cliproom/RecentlyDeleted.tsx"),
  ]);

  assert.match(shared, /deletedTaskRetentionDays\s*=\s*7/);
  assert.match(retention, /deletedTaskRetentionDays \* 24 \* 60 \* 60 \* 1000/);
  assert.match(page, /deletedTaskRetentionDays \* 24 \* 60 \* 60 \* 1000/);
  assert.match(deletedPanel, /deletedTaskRetentionDays\} days/);
  assert.doesNotMatch(deletedPanel, /another 24 hours/);
});
