import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function functionBody(sourceText: string, name: string) {
  const start = sourceText.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = sourceText.indexOf("\nexport async function ", start + 1);
  return sourceText.slice(start, next === -1 ? undefined : next);
}

test("clippers can add and delete standalone clips from the server workflow", async () => {
  const server = await source("lib/cliproom/server.ts");
  assert.doesNotMatch(functionBody(server, "addClip"), /requireAdmin\(actor\)/);
  assert.doesNotMatch(functionBody(server, "deleteClip"), /requireAdmin\(actor\)/);
});

test("clippers can update standalone clip details from the server workflow", async () => {
  const server = await source("lib/cliproom/server.ts");
  const route = await source("app/api/cliproom/clips/[id]/route.ts");

  assert.doesNotMatch(functionBody(server, "updateClipDetails"), /requireAdmin\(actor\)/);
  assert.match(functionBody(server, "updateClipDetails"), /getStandaloneClip\(db, clipId\)/);
  assert.match(functionBody(server, "updateClipDetails"), /UPDATE clips SET title = \?, category = \?, notes = \?, updated_at = \? WHERE id = \?/);
  assert.match(route, /action === "updateDetails"/);
});

test("clippers can create, edit, and delete collections from the server workflow", async () => {
  const server = await source("lib/cliproom/server.ts");
  assert.doesNotMatch(functionBody(server, "createCollection"), /requireAdmin\(actor\)/);
  assert.doesNotMatch(functionBody(server, "updateCollection"), /requireAdmin\(actor\)/);
  assert.doesNotMatch(functionBody(server, "addCollectionClip"), /requireAdmin\(actor\)/);
  assert.doesNotMatch(functionBody(server, "removeCollectionClip"), /requireAdmin\(actor\)/);
  assert.doesNotMatch(functionBody(server, "reorderCollectionClip"), /requireAdmin\(actor\)/);
  assert.doesNotMatch(functionBody(server, "deleteCollection"), /requireAdmin\(actor\)/);
  assert.match(functionBody(server, "toggleCollectionPriority"), /requireAdmin\(actor\)/);
});

test("Twitch source edits stay admin-only while trusted sync is member-accessible and rate-limited", async () => {
  const server = await source("lib/cliproom/server.ts");
  assert.match(functionBody(server, "setSourceChannel"), /requireAdmin\(actor\)/);
  assert.doesNotMatch(functionBody(server, "syncTwitchClips"), /requireAdmin\(actor\)/);
  assert.match(functionBody(server, "syncTwitchClips"), /rateLimitTwitch\(actor\.id\)/);
  assert.match(functionBody(server, "syncTwitchClips"), /rateLimitTwitchSync\(db, actor\.id\)/);
  assert.match(functionBody(server, "syncTwitchClips"), /markTwitchSyncCooldown\(db, actor\.id\)/);
  assert.match(server, /twitchSyncMemberCooldownMs = 5 \* 1000/);
  assert.match(server, /twitchSyncRoomCooldownMs = 5 \* 1000/);
  assert.match(functionBody(server, "syncTwitchClips"), /trustedIds\.has\(clip\.creator_id\)/);
  assert.match(functionBody(server, "syncTwitchClips"), /findClipByTwitchUrl/);
  assert.match(functionBody(server, "syncTwitchClips"), /getSyncWindowStartedAt\(\)/);
  assert.match(server, /firstTwitchSyncWindowHours = 24/);
  assert.doesNotMatch(server, /twitchSyncOverlapHours/);
});

test("Twitch duplicate lookup avoids D1 LIKE patterns for clip slugs", async () => {
  const server = await source("lib/cliproom/server.ts");
  const lookupBody = server.slice(
    server.indexOf("async function findClipByTwitchUrl"),
    server.indexOf("export async function syncTwitchClips"),
  );

  assert.match(lookupBody, /instr\(url, \?\)/);
  assert.match(lookupBody, /twitchClipUrlsMatch/);
  assert.doesNotMatch(lookupBody, /\bLIKE\b/i);
  assert.doesNotMatch(lookupBody, /\bGLOB\b/i);
});

test("Twitch source panel is visible to clippers without editable source settings", async () => {
  const page = await source("app/page.tsx");
  const sourceStart = page.indexOf(">Twitch source<");
  const teamStart = page.indexOf(">Team<", sourceStart);
  const sourcePanel = page.slice(sourceStart, teamStart);

  assert.match(sourcePanel, /aria-label="Twitch channel value"/);
  assert.match(sourcePanel, /aria-label="Trusted Twitch clippers value"/);
  assert.match(sourcePanel, /\{isAdmin \? \(/);
  assert.match(sourcePanel, /onClick=\{syncTwitch\}/);
  assert.doesNotMatch(sourcePanel, /disabled=\{\s*busyAction === "sync" \|\| !isAdmin/);
});
