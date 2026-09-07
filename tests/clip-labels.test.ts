import assert from "node:assert/strict";
import test from "node:test";

import { collectionClipLabel } from "../lib/cliproom/shared.ts";

test("collection clip labels replace generic Twitch placeholders with numbered clips", () => {
  assert.equal(collectionClipLabel({ title: "Untitled Twitch clip" }, 0), "Clip 1");
  assert.equal(collectionClipLabel({ title: "   " }, 1), "Clip 2");
  assert.equal(collectionClipLabel({ title: "Saving this for when he cries" }, 2), "Saving this for when he cries");
});
