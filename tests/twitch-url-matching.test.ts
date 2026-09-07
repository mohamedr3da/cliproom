import assert from "node:assert/strict";
import test from "node:test";

import { getTwitchClipSlug, twitchClipUrlsMatch } from "../lib/cliproom/shared.ts";

const clipUrl = "https://www.twitch.tv/rawdogmoon/clip/VastEnticingEggPartyTime-EZ8L6iDvK0_Wi3PL";
const clipSlug = "VastEnticingEggPartyTime-EZ8L6iDvK0_Wi3PL";

test("Twitch clip slug matching handles underscores without SQL pattern matching", () => {
  assert.equal(getTwitchClipSlug(clipUrl), clipSlug);
  assert.equal(twitchClipUrlsMatch(clipUrl, `https://clips.twitch.tv/${clipSlug}`), true);
  assert.equal(
    twitchClipUrlsMatch(
      clipUrl,
      `https://www.twitch.tv/rawdogmoon/clip/${clipSlug}?filter=clips&range=24hr&sort=time`,
    ),
    true,
  );
  assert.equal(twitchClipUrlsMatch(clipUrl, "https://www.twitch.tv/rawdogmoon/clip/OtherSlug"), false);
  assert.equal(twitchClipUrlsMatch(clipUrl, "https://clips.twitch.tv/OtherSlug"), false);
});
