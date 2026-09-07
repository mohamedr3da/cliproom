import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getClipEmbedUrl,
  getKickClipId,
  supportedClipUrlsMatch,
} from "../lib/cliproom/shared.ts";

const kickCurrent = "https://kick.com/creator/clips/clip_01ABC";
const kickLegacy = "https://www.kick.com/creator?clip=clip_01ABC";

test("Kick clips avoid the invalid iframe embed and equivalent share URLs match", () => {
  assert.equal(getKickClipId(kickCurrent), "clip_01ABC");
  assert.equal(getClipEmbedUrl(kickLegacy, "cliproom.example"), null);
  assert.equal(supportedClipUrlsMatch(kickCurrent, kickLegacy), true);
  assert.equal(supportedClipUrlsMatch(kickCurrent, "https://kick.com/creator/clips/clip_OTHER"), false);
});

test("manual clip and collection intake validate Twitch or Kick instead of Twitch only", async () => {
  const server = await readFile(new URL("../lib/cliproom/server.ts", import.meta.url), "utf8");
  const addClipBody = server.match(/export async function addClip[\s\S]*?\n}\n\nfunction parseClipDetails/)?.[0] ?? "";
  const parseCollectionBody = server.match(/function parseCollectionClipUrl[\s\S]*?\n}\n/)?.[0] ?? "";

  assert.match(server, /isSupportedClipUrl/);
  assert.match(addClipBody, /isSupportedClipUrl\(url\)/);
  assert.doesNotMatch(addClipBody, /!getTwitchClipSlug\(url\)/);
  assert.match(parseCollectionBody, /isSupportedClipUrl\(url\)/);
  assert.match(addClipBody, /Twitch or Kick clip URL/);
  assert.match(parseCollectionBody, /Twitch or Kick clip URL/);
  assert.match(server, /supportedClipUrlsMatch\(existingUrl, url\)/);
});

test("standalone and collection cards use the dedicated Kick player and Twitch embed surface", async () => {
  const [standalone, collection, kickPlayer, frame] = await Promise.all([
    readFile(new URL("../components/cliproom/StandaloneClipCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/cliproom/CollectionCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/cliproom/KickClipPlayer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/cliproom/TwitchEmbedFrame.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(standalone, /KickClipPlayer/);
  assert.match(collection, /KickClipPlayer/);
  assert.match(standalone, /getClipEmbedUrl\(clip\.url, embedHost\)/);
  assert.match(collection, /getClipEmbedUrl\(selectedClip\.url, embedHost\)/);
  assert.match(kickPlayer, /Opening Kick player/);
  assert.match(kickPlayer, /Open on Kick/);
  assert.match(frame, /Opening \$\{platform\} player/);
});
