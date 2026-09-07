import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("narrow task cards collapse secondary badges into a Discord-style +N popover", async () => {
  const [css, overflow, standalone, collection] = await Promise.all([
    read("app/globals.css"),
    read("components/cliproom/TaskBadgeOverflow.tsx"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
  ]);

  assert.match(overflow, /aria-label=\{`Show \$\{hiddenBadges\.length\} more/);
  assert.match(overflow, />\s*\+\{hiddenBadges\.length\}\s*</);
  assert.match(overflow, /task-badge-overflow-popover/);
  assert.match(overflow, /document\.addEventListener\("pointerdown", handleOutsidePointerDown\)/);
  assert.match(overflow, /new CustomEvent\(badgeOverflowEvent/);
  assert.match(css, /@container task-card \(max-width:\s*21\.5rem\)[\s\S]*?\.task-badges-wide\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /@container task-card \(max-width:\s*21\.5rem\)[\s\S]*?\.task-badges-compact\s*\{[\s\S]*?display:\s*flex/);
  assert.doesNotMatch(css, /@container task-card \(max-width:\s*21\.5rem\)[\s\S]*?\.task-card-title-actions\s*\{[\s\S]*?grid-row:\s*2/);
  assert.match(standalone, /TaskBadgeOverflow/);
  assert.match(collection, /TaskBadgeOverflow/);
});

test("Twitch iframe tracks its actual container size without remounting playback", async () => {
  const player = await read("components/cliproom/TwitchEmbedFrame.tsx");

  assert.match(player, /useRef/);
  assert.match(player, /new ResizeObserver/);
  assert.match(player, /containerRef/);
  assert.match(player, /iframeRef/);
  assert.match(player, /setAttribute\("width"/);
  assert.match(player, /setAttribute\("height"/);
  assert.match(player, /observer\.observe\(container\)/);
  assert.match(player, /observer\.disconnect\(\)/);
  const syncIframeSize = player.match(/function syncIframeSize[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(syncIframeSize, /setAttribute\("width"[\s\S]*?setAttribute\("height"/);
  assert.doesNotMatch(syncIframeSize, /setAttempt/);
});
