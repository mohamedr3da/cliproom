import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getKickChannelSlug } from "../lib/cliproom/shared.ts";
import { parseKickChannelClipMetadata } from "../lib/cliproom/kick-playback.ts";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Kick clip URLs expose their channel slug for the channel-list playback fallback", () => {
  assert.equal(getKickChannelSlug("https://kick.com/rawdogmoon/clips/clip_01ABCDEF"), "rawdogmoon");
  assert.equal(getKickChannelSlug("https://www.kick.com/Some_Channel/clips/clip_01ABCDEF?x=1"), "some_channel");
  assert.equal(getKickChannelSlug("https://kick.com/rawdogmoon?clip=clip_01ABCDEF"), "rawdogmoon");
  assert.equal(getKickChannelSlug("https://kick.com/?clip=clip_01ABCDEF"), null);
  assert.equal(getKickChannelSlug("https://example.com/rawdogmoon/clips/clip_01ABCDEF"), null);
});

test("channel clip listings can recover playable media for the requested Kick clip", () => {
  const payload = {
    clips: [
      { id: "clip_OTHER", title: "Other", clip_url: "https://clips.kick.com/clips/zz/clip_OTHER/playlist.m3u8" },
      { id: "clip_01ABCDEF", title: "Recovered title", clip_url: "https://clips.kick.com/clips/aa/clip_01ABCDEF/playlist.m3u8", thumbnail_url: "https://clips.kick.com/aa.jpg" },
    ],
    nextCursor: { id: "next-page" },
  };
  assert.deepEqual(parseKickChannelClipMetadata(payload, "clip_01ABCDEF"), {
    metadata: {
      title: "Recovered title",
      mediaUrl: "https://clips.kick.com/clips/aa/clip_01ABCDEF/playlist.m3u8",
      thumbnailUrl: "https://clips.kick.com/aa.jpg",
    },
    nextCursor: "next-page",
  });
});

test("Kick playback falls back to the clip channel listing before giving up", async () => {
  const server = await read("lib/cliproom/server.ts");
  assert.match(server, /getKickChannelSlug/);
  assert.match(server, /api\/v2\/channels\/\$\{encodeURIComponent\(channel\)\}\/clips/);
  assert.match(server, /parseKickChannelClipMetadata/);
  assert.match(server, /new URLSearchParams\(\{ sort: "date", time: "all" \}\)/);
});

test("standalone clips and Collections hide reset-progress workflow in library mode", async () => {
  const [clipCard, collectionCard, clipRoute, collectionRoute, server, page] = await Promise.all([
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
    read("app/api/cliproom/clips/[id]/route.ts"),
    read("app/api/cliproom/collections/[id]/route.ts"),
    read("lib/cliproom/server.ts"),
    read("app/page.tsx"),
  ]);
  assert.doesNotMatch(clipCard, /Reset progress/);
  assert.doesNotMatch(collectionCard, /Reset progress/);
  assert.match(clipCard, /editOpen/);
  assert.match(collectionCard, /editOpen/);
  assert.match(clipRoute, /action === "resetProgress"/);
  assert.match(collectionRoute, /action === "resetProgress"/);
  assert.match(server, /export async function resetClipProgress/);
  assert.match(server, /export async function resetCollectionProgress/);
  assert.doesNotMatch(page, /resetClipProgress/);
  assert.doesNotMatch(page, /resetCollectionProgress/);
});

test("primary task actions use one stable shared geometry", async () => {
  const [css, clipCard, collectionCard] = await Promise.all([
    read("app/globals.css"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
  ]);
  assert.match(css, /\.task-card-primary\s*\{/);
  assert.match(css, /user-select:\s*none/);
  assert.match(css, /min-width:\s*max-content/);
  assert.match(clipCard, /task-card-primary/);
  assert.match(collectionCard, /task-card-primary/);
});

test("desktop right workspace panels can collapse into a remembered slim rail", async () => {
  const [page, css] = await Promise.all([read("app/page.tsx"), read("app/globals.css")]);
  assert.match(page, /rightPanelsCollapsed/);
  assert.match(page, /cliproom:right-panels-collapsed/);
  assert.match(page, /data-panels-collapsed/);
  assert.match(page, /Collapse right panel/);
  assert.match(page, /Expand right panel/);
  assert.match(css, /\.app-shell\[data-panels-collapsed="true"\]/);
  assert.match(css, /\.workspace-panel-rail/);
});
