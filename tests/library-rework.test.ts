import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getQueueCounts, taskMatchesFilter } from "../lib/cliproom/task-helpers.ts";
import type { Clip, Collection } from "../lib/cliproom/shared.ts";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const clip = (overrides: Partial<Clip> = {}): Clip => ({
  id: "clip_one",
  url: "https://clips.twitch.tv/ClipOne",
  title: "Clip one",
  category: "social",
  intakeSource: "manual",
  twitchCreatorLogin: null,
  status: "New",
  priority: false,
  saved: false,
  assignee: "Unclaimed",
  notes: "N/A",
  createdBy: "iseven",
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  claimedAt: null,
  postedAt: null,
  ...overrides,
});

const collection = (overrides: Partial<Collection> = {}): Collection => ({
  id: "collection_one",
  title: "Collection one",
  category: "gameplay",
  status: "New",
  priority: false,
  saved: false,
  assignee: "Unclaimed",
  notes: "N/A",
  createdBy: "iseven",
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  claimedAt: null,
  postedAt: null,
  clips: [clip()],
  ...overrides,
});

test("library filter replaces My tasks with Saved and matches saved clips or collections", async () => {
  const shared = await read("lib/cliproom/shared.ts");

  assert.match(shared, /export type CategoryFilter = "all" \| "saved" \| "trusted" \| Category/);
  assert.match(shared, /\{ id: "all", label: "All clips" \},\s*\{ id: "saved", label: "Saved" \},/);
  assert.doesNotMatch(shared, /My tasks/);

  assert.equal(taskMatchesFilter({ kind: "clip", clip: clip({ saved: true }) }, "saved", "iseven"), true);
  assert.equal(taskMatchesFilter({ kind: "clip", clip: clip({ saved: false }) }, "saved", "iseven"), false);
  assert.equal(taskMatchesFilter({ kind: "collection", collection: collection({ saved: true }) }, "saved", "iseven"), true);
  assert.equal(getQueueCounts([
    { kind: "clip", clip: clip({ saved: true }) },
    { kind: "collection", collection: collection({ saved: false }) },
  ]).saved, 1);
});

test("task cards use saved hearts and hide task-claiming workflow chrome", async () => {
  const [standalone, collectionCard] = await Promise.all([
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
  ]);

  for (const card of [standalone, collectionCard]) {
    assert.match(card, /Heart/);
    assert.match(card, /onToggleSaved/);
    assert.match(card, /saved \?/);
    assert.doesNotMatch(card, /Claim/);
    assert.doesNotMatch(card, /taskActionLabel/);
    assert.doesNotMatch(card, /canAdvanceTask/);
    assert.doesNotMatch(card, /onAdvance/);
    assert.doesNotMatch(card, /onResetProgress/);
    assert.doesNotMatch(card, /task-card-meta-assignee/);
    assert.doesNotMatch(card, /Unclaimed/);
    assert.doesNotMatch(card, /Reset progress/);
  }
});

test("page routes saved toggle actions and library copy away from task claims", async () => {
  const page = await read("app/page.tsx");

  assert.match(page, /toggleSavedClip/);
  assert.match(page, /toggleSavedCollection/);
  assert.match(page, /ClipRoom library/);
  assert.match(page, /Private creator library/);
  assert.doesNotMatch(page, /My tasks/);
  assert.doesNotMatch(page, /\bclaimed\b/);
  assert.doesNotMatch(page, /onAdvance=\{/);
  assert.doesNotMatch(page, /onResetProgress=\{/);
});

test("server persists saved tasks per member and exposes clip and collection toggle actions", async () => {
  const [schema, server, clipRoute, collectionRoute] = await Promise.all([
    read("db/schema.ts"),
    read("lib/cliproom/server.ts"),
    read("app/api/cliproom/clips/[id]/route.ts"),
    read("app/api/cliproom/collections/[id]/route.ts"),
  ]);

  assert.match(schema, /CREATE TABLE IF NOT EXISTS saved_tasks/);
  assert.match(schema, /PRIMARY KEY \(member_id, target_kind, target_id\)/);
  assert.match(server, /currentSavedSchemaVersion/);
  assert.match(server, /saved:\s*Boolean\(row\.saved\)/);
  assert.match(server, /export async function toggleClipSaved/);
  assert.match(server, /export async function toggleCollectionSaved/);
  assert.match(clipRoute, /action === "toggleSaved"/);
  assert.match(collectionRoute, /action === "toggleSaved"/);
});
