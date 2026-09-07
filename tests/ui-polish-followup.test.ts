import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Kick clips use a dedicated ClipRoom player instead of the broken Kick iframe", async () => {
  const [standalone, collection, player, shared] = await Promise.all([
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
    read("components/cliproom/KickClipPlayer.tsx"),
    read("lib/cliproom/shared.ts"),
  ]);
  assert.match(standalone, /KickClipPlayer/);
  assert.match(collection, /KickClipPlayer/);
  assert.match(player, /import\("hls\.js"\)/);
  assert.doesNotMatch(player, /import (?!type\b).*from "hls\.js"/);
  assert.match(player, /\/api\/cliproom\/kick\/clip/);
  assert.doesNotMatch(shared, /player\.kick\.com\/video/);
});

test("the passive clip preview no longer says Watch clip", async () => {
  const preview = await read("components/cliproom/TwitchEmbedFrame.tsx");
  assert.doesNotMatch(preview, />Watch clip</);
});

test("Recently deleted records expose who deleted them", async () => {
  const [shared, schema, server, recent] = await Promise.all([
    read("lib/cliproom/shared.ts"),
    read("db/schema.ts"),
    read("lib/cliproom/server.ts"),
    read("components/cliproom/RecentlyDeleted.tsx"),
  ]);
  assert.match(shared, /deletedBy\??: string \| null/);
  assert.match(schema, /deleted_by_member_id TEXT/);
  assert.match(server, /deletedBy:/);
  assert.match(recent, /Deleted by @/);
  assert.match(recent, /Moved automatically/);
});

test("blank manual titles resolve from the source before they enter the queue", async () => {
  const server = await read("lib/cliproom/server.ts");
  assert.match(server, /async function resolveManualClipTitle/);
  assert.match(server, /const title = normaliseTaskTitle\(await resolveManualClipTitle\(url, rawTitle\)/);
  assert.match(server, /fetchKickClipMetadata/);
  assert.match(server, /clips\?id=/);
  assert.match(server, /normaliseTaskTitle\(await resolveManualClipTitle\(url, ""\)/);
});

test("re-adding a recently deleted standalone clip offers restore or cancel", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /restoreCandidate/);
  assert.match(page, /This clip was recently deleted\. Restore it to the queue\?/);
  assert.match(page, />Restore</);
  assert.match(page, />Cancel</);
});

test("trusted sync copy and matching are limited to the listed clippers", async () => {
  const [page, server] = await Promise.all([read("app/page.tsx"), read("lib/cliproom/server.ts")]);
  assert.match(page, /made by the listed clippers\. New clips appear under Trusted clippers; existing clips are not duplicated\./);
  assert.doesNotMatch(page, /listed clippers, you, or the broadcaster/);
  assert.match(server, /const matchLogins = Array\.from\(\s*new Set\(\s*trustedClipperLogins/);
});

test("desktop task grid keeps the four-card collapsed-panel layout", async () => {
  const [css, standalone, collection] = await Promise.all([
    read("app/globals.css"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
  ]);

  assert.match(css, /@container queue \(min-width: 56rem\)[\s\S]*?\.task-grid\s*\{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@container queue \(min-width: 76rem\)[\s\S]*?\.task-grid\s*\{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /@container queue \(min-width: 124rem\)[\s\S]*?\.task-grid\s*\{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@container queue \(min-width: 38rem\)[\s\S]*?\.task-grid\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(standalone, /task-card-title-block/);
  assert.match(collection, /task-card-title-block/);
  assert.match(standalone, /h-10 w-10/);
});
