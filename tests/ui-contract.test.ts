import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("clippers can open collection create and collection card edit controls", async () => {
  const page = await source("app/page.tsx");
  const card = await source("components/cliproom/CollectionCard.tsx");
  const createStart = page.indexOf("{intakeMode === \"clip\" ? \"Close form\"");
  const createEnd = page.indexOf("Add a clip", createStart);
  const createBlock = page.slice(createStart, createEnd);

  assert.match(createBlock, /Create collection/);
  assert.doesNotMatch(createBlock, /isAdmin \? \(/);
  assert.match(page, /intakeMode === "collection" \? \(/);
  assert.doesNotMatch(page, /isAdmin && intakeMode === "collection"/);
  assert.doesNotMatch(card, /isAdmin && selectedClip/);
  assert.doesNotMatch(card, /isAdmin && addOpen/);
  assert.match(card, /Delete collection and clips/);
});

test("page offers collection intake and renders unified queue tasks", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /Create collection/);
  assert.match(page, /getQueueTasks/);
  assert.match(page, /filteredTasks\.map/);
  assert.match(page, /CollectionCard/);
  assert.match(page, /StandaloneClipCard/);
});


test("collection intake supports adding and removing arbitrary URL rows", async () => {
  const intake = await source("components/cliproom/CollectionIntake.tsx");
  assert.match(intake, /Add another clip/);
  assert.match(intake, /urls\.map/);
  assert.match(intake, /setUrls/);
  assert.match(intake, /Remove clip/);
});

test("collection card renders one player and a horizontal child switcher", async () => {
  const card = await source("components/cliproom/CollectionCard.tsx");
  const frameCount = (card.match(/<TwitchEmbedFrame/g) ?? []).length;
  assert.equal(frameCount, 1);
  assert.match(card, /overflow-x-auto/);
  assert.match(card, /Collection ·/);
  assert.match(card, /Move clip left/);
  assert.match(card, /Move clip right/);
  assert.match(card, /Remove selected clip/);
  assert.match(card, /Add clip to Collection/);
  assert.match(card, /Delete collection and clips/);
});
