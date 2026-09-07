import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePromise = readFile(
  new URL("../lib/cliproom/server.ts", import.meta.url),
  "utf8",
);

const requiredExports = [
  "createCollection",
  "updateCollection",
  "addCollectionClip",
  "removeCollectionClip",
  "reorderCollectionClip",
  "toggleCollectionPriority",
  "advanceCollection",
  "deleteCollection",
];

test("server exports the complete collection workflow surface", async () => {
  const source = await sourcePromise;
  for (const name of requiredExports) {
    assert.match(source, new RegExp(`export async function ${name}\\b`));
  }
});

test("room state separates standalone clips and hydrates ordered collection children", async () => {
  const source = await sourcePromise;
  assert.match(source, /NOT EXISTS\s*\(SELECT 1 FROM collection_clips/i);
  assert.match(source, /JOIN clips ON clips\.id = cc\.clip_id/i);
  assert.match(source, /ORDER BY cc\.collection_id, cc\.position/i);
  assert.match(source, /collections:/);
});

test("membership operations reset standalone workflow and block cross-collection reuse", async () => {
  const source = await sourcePromise;
  assert.match(source, /That clip already belongs to another Collection\./);
  assert.match(source, /status = 'New', priority = 0, assignee = 'Unclaimed'/);
  assert.match(source, /A Collection must keep at least one clip\./);
  assert.match(source, /direction === "left"/);
  assert.match(source, /direction !== "right"/);
});

test("collection claim uses a guarded update and standalone APIs exclude grouped clips", async () => {
  const source = await sourcePromise;
  assert.match(source, /UPDATE collections SET status = 'Claimed'/);
  assert.match(source, /status IN \('New', 'Prioritised'\) AND assignee_member_id IS NULL/);
  assert.match(source, /async function getStandaloneClip/);
});
