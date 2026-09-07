import assert from "node:assert/strict";
import test from "node:test";
import {
  isHlsMediaUrl,
  mergeKickMetadata,
  parseKickMetadata,
  requireKickPlayback,
} from "../lib/cliproom/kick-playback.ts";

test("a successful metadata response without media is a playback error", () => {
  assert.throws(() => requireKickPlayback({ title: "A clip", mediaUrl: null }), /playable media/i);
  assert.throws(() => requireKickPlayback(null), /playable media/i);
});

test("playback accepts signed HTTPS media while rejecting unsafe or malformed URLs", () => {
  const mediaUrl = "https://clips.kick.com/video.m3u8?token=abc&expires=123";
  assert.deepEqual(requireKickPlayback({ mediaUrl, title: " A clip ", thumbnailUrl: "https://clips.kick.com/poster.jpg" }), {
    mediaUrl, title: "A clip", thumbnailUrl: "https://clips.kick.com/poster.jpg",
  });
  for (const mediaUrl of ["", "javascript:alert(1)", "http://clips.kick.com/video.mp4", "https://user:pass@clips.kick.com/video.mp4", "not a URL"]) {
    assert.throws(() => requireKickPlayback({ mediaUrl }), /playable media/i);
  }
});

test("metadata fallback keeps a first endpoint's poster while finding the other endpoint's video", () => {
  const first = parseKickMetadata({ clip: { title: " A clip ", thumbnail_url: "https://clips.kick.com/poster.jpg" } });
  const next = parseKickMetadata({ video_url: "https://clips.kick.com/video.mp4" });
  assert.deepEqual(mergeKickMetadata(first, next), {
    title: "A clip", thumbnailUrl: "https://clips.kick.com/poster.jpg", mediaUrl: "https://clips.kick.com/video.mp4",
  });
  assert.equal(first.mediaUrl, null);
});

test("metadata accepts current and fallback Kick field names without trusting invalid types", () => {
  assert.deepEqual(parseKickMetadata({ clip: { title: "Title", clip_url: "https://clips.kick.com/clip.mp4", thumbnail: "https://clips.kick.com/clip.jpg" } }), {
    title: "Title", mediaUrl: "https://clips.kick.com/clip.mp4", thumbnailUrl: "https://clips.kick.com/clip.jpg",
  });
  assert.deepEqual(parseKickMetadata({ clip: { title: {}, clip_url: "javascript:bad", thumbnail_url: [] } }), {
    title: null, mediaUrl: null, thumbnailUrl: null,
  });
});

test("HLS detection uses only the media pathname, including signed and fragment URLs", () => {
  assert.equal(isHlsMediaUrl("https://clips.kick.com/video.M3U8?token=abc#start"), true);
  assert.equal(isHlsMediaUrl("https://clips.kick.com/video.mp4?label=.m3u8"), false);
  assert.equal(isHlsMediaUrl("https://clips.kick.com/video.mp4"), false);
});
