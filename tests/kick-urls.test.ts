import assert from "node:assert/strict";
import test from "node:test";
import { getKickClipId, getClipPlatform, isSupportedClipUrl, collectionClipLabel, cleanClipTitle } from "../lib/cliproom/shared.ts";

test("Kick submissions accept current and legacy shared clip links", () => {
  for (const url of ["https://kick.com/creator/clips/clip_01ABC", "https://www.kick.com/creator?clip=clip_01ABC", "https://kick.com/creator/?foo=1&clip=clip_01ABC"]) {
    assert.equal(getKickClipId(url), "clip_01ABC");
    assert.equal(getClipPlatform(url), "Kick");
    assert.equal(isSupportedClipUrl(url), true);
  }
});
test("channel pages, video links, deceptive hosts and non-web schemes are rejected", () => {
  for (const url of ["https://kick.com/creator", "https://kick.com/creator/videos/abc", "https://kick.com.evil.test/creator/clips/clip_a", "https://evil.test/creator?clip=clip_a", "https://user@kick.com/creator?clip=clip_a", "ftp://kick.com/creator?clip=clip_a", "https://kick.com/creator?clip=", "https://kick.com/creator/clips/not-a-clip", "https://kick.com/creator/clips/clip_a/extra", "javascript:alert(1)"]) assert.equal(isSupportedClipUrl(url), false, url);
  assert.equal(isSupportedClipUrl("https://clips.twitch.tv/ARealSlug"), true);
  assert.equal(getClipPlatform("https://clips.twitch.tv/ARealSlug"), "Twitch");
});
test("Kick fallback titles avoid user-visible untitled copy while legacy placeholders still get numbered labels", () => {
  assert.equal(cleanClipTitle("https://kick.com/creator?clip=clip_01ABC"), "Kick clip");
  assert.equal(collectionClipLabel({title: "Untitled Kick clip"}, 2), "Clip 3");
});
