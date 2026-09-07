import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function route(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("collection create route uses the existing mutation/auth/error pattern", async () => {
  const source = await route("app/api/cliproom/collections/route.ts");
  assert.match(source, /assertMutationRequest\(request\)/);
  assert.match(source, /requireMember\(request\)/);
  assert.match(source, /readJson/);
  assert.match(source, /createCollection/);
  assert.match(source, /jsonOk/);
  assert.match(source, /jsonError/);
});

test("collection task route exposes update priority advance and dissolve", async () => {
  const source = await route("app/api/cliproom/collections/[id]/route.ts");
  assert.match(source, /updateCollection/);
  assert.match(source, /toggleCollectionPriority/);
  assert.match(source, /advanceCollection/);
  assert.match(source, /deleteCollection/);
});

test("collection child routes expose add remove and reorder", async () => {
  const addSource = await route("app/api/cliproom/collections/[id]/clips/route.ts");
  const childSource = await route("app/api/cliproom/collections/[id]/clips/[clipId]/route.ts");
  assert.match(addSource, /addCollectionClip/);
  assert.match(childSource, /removeCollectionClip/);
  assert.match(childSource, /reorderCollectionClip/);
  assert.match(childSource, /assertMutationRequest\(request\)/);
  assert.match(childSource, /requireMember\(request\)/);
});
