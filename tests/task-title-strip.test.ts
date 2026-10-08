import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("task cards use plain clamped titles without expandable controls", async () => {
  const [standalone, collection, css] = await Promise.all([
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
    read("app/globals.css"),
  ]);

  for (const card of [standalone, collection]) {
    assert.match(card, /className="task-card-title-copy"/);
    assert.match(card, /<h2/);
    assert.match(card, /className="task-card-title-text"/);
    assert.match(card, /formatTaskTitleForDisplay\(/);
    assert.doesNotMatch(card, /as="h2"/);
    assert.doesNotMatch(card, /overlayCollapsedControl/);
    assert.doesNotMatch(card, /TaskTitleStrip/);
  }

  assert.match(css, /\.task-card-title-text\s*\{[\s\S]*?-webkit-line-clamp:\s*3/);
  assert.doesNotMatch(css, /\.task-title-strip/);
});

test("task title limits preserve useful title context while cards visually clamp overflow", async () => {
  const sharedModule = await import("../lib/cliproom/shared.ts");
  const normaliseTaskTitle = sharedModule.normaliseTaskTitle as
    | ((value: unknown, fallback?: string) => string)
    | undefined;
  const formatTaskTitleForDisplay = sharedModule.formatTaskTitleForDisplay as
    | ((value: string) => string)
    | undefined;
  const [shared, server] = await Promise.all([
    read("lib/cliproom/shared.ts"),
    read("lib/cliproom/server.ts"),
  ]);

  assert.equal(sharedModule.maxClipTitleLength, 120);
  assert.equal(sharedModule.maxCollectionTitleLength, 120);
  assert.equal(sharedModule.maxTaskTitleSegmentLength, 14);
  assert.equal(typeof normaliseTaskTitle, "function");
  assert.equal(typeof formatTaskTitleForDisplay, "function");
  assert.equal(normaliseTaskTitle(` ${"a".repeat(150)} `).length, 120);
  assert.match(normaliseTaskTitle("a".repeat(150)), /\.\.\.$/);
  assert.equal(normaliseTaskTitle("   ", "Fallback title"), "Fallback title");
  const usefulLongTitle = Array.from({ length: 8 }, () => "740 to 11k!!!").join(" ");
  assert.equal(normaliseTaskTitle(usefulLongTitle), usefulLongTitle);

  const joinedChunk = "ome67 ome67 ome67 ome67vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv";
  const spacedWords = "asdsd asdsd asdsd asdsd asdsd asdsd asdsd asdsd asdsd asdsd2";
  const formattedJoinedChunk = formatTaskTitleForDisplay(joinedChunk);
  assert.equal(formattedJoinedChunk.replaceAll("\u200B", ""), joinedChunk);
  assert.notEqual(formattedJoinedChunk, joinedChunk);
  assert.equal(formatTaskTitleForDisplay(spacedWords), spacedWords);
  assert.ok(
    Math.max(...formattedJoinedChunk.split(/[\s\u200B]+/u).map((part) => Array.from(part).length)) <= 14,
  );

  assert.match(shared, /export function normaliseTaskTitle/);
  assert.match(shared, /export function formatTaskTitleForDisplay/);
  assert.match(server, /normaliseTaskTitle\(row\.title/);
  assert.match(server, /normaliseTaskTitle\(await resolveManualClipTitle/);
});
