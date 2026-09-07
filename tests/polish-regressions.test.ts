import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Twitch access copy uses This instead of That", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /This Twitch account does not have access to this ClipRoom\./);
  assert.doesNotMatch(page, /That Twitch account does not have access to this ClipRoom\./);
});

test("Room Stats is neutral instead of styling Clips as selected", async () => {
  const page = await source("app/page.tsx");
  const statsStart = page.indexOf(">Room stats<");
  const statsEnd = page.indexOf("Private workspace for your creator team.", statsStart);
  const stats = page.slice(statsStart, statsEnd);
  assert.doesNotMatch(stats, /index === 0/);
  assert.doesNotMatch(stats, /bg-white\/\[0\.055\]/);
});

test("Team member identity metadata wraps instead of truncating", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /break-words text-sm font-semibold/);
  assert.match(page, /break-words text-xs leading-5 text-white\/40/);
  assert.doesNotMatch(page, /truncate text-xs text-white\/40/);
});

test("Team member access list uses compact rows with inline removal", async () => {
  const page = await source("app/page.tsx");
  const teamStart = page.indexOf(">Team<");
  const sourceStart = page.indexOf(">Twitch source<", teamStart);
  const teamSection = page.slice(teamStart, sourceStart);

  assert.match(teamSection, /divide-y divide-white\/\[0\.06\]/);
  assert.match(teamSection, /grid grid-cols-\[auto_minmax\(0,1fr\)_auto\] items-center/);
  assert.match(teamSection, /min-w-\[54px\]/);
  assert.doesNotMatch(teamSection, /rounded-\[10px\] border border-white\/\[0\.065\] bg-white\/\[0\.025\] p-3/);
  assert.doesNotMatch(teamSection, /<div className="flex justify-end">/);
});

test("queue cards stretch in a row and pin actions to the bottom without empty notes", async () => {
  const page = await source("app/page.tsx");
  const standalone = await source("components/cliproom/StandaloneClipCard.tsx");
  const collection = await source("components/cliproom/CollectionCard.tsx");
  const globals = await source("app/globals.css");

  assert.match(page, /className="task-grid"/);
  assert.match(globals, /\.task-grid\s*\{[^}]*align-items: stretch/);
  assert.doesNotMatch(page, /grid items-start gap-4 2xl:grid-cols-2/);
  assert.match(standalone, /group flex h-full flex-col overflow-hidden/);
  assert.match(collection, /group flex h-full flex-col overflow-hidden/);
  assert.match(standalone, /<div className="mt-auto pt-1">/);
  assert.match(collection, /<div className="mt-auto pt-1">/);
  assert.doesNotMatch(standalone, /clip\.notes \? \([\s\S]*: \(\s*<p className="mb-4/);
});

test("Twitch embeds use a dark loading surface instead of flashing white", async () => {
  const standalone = await source("components/cliproom/StandaloneClipCard.tsx");
  const collection = await source("components/cliproom/CollectionCard.tsx");
  const frame = await source("components/cliproom/TwitchEmbedFrame.tsx");

  assert.match(standalone, /TwitchEmbedFrame/);
  assert.match(collection, /TwitchEmbedFrame/);
  assert.doesNotMatch(standalone, /<iframe/);
  assert.doesNotMatch(collection, /<iframe/);
  assert.match(frame, /onLoad/);
  assert.match(frame, /opacity-0/);
  assert.match(frame, /bg-\[#101014\]/);
  assert.match(frame, /absolute inset-0/);
});

test("Twitch source read-only view uses non-focusable display fields", async () => {
  const page = await source("app/page.tsx");
  const sourceStart = page.indexOf(">Twitch source<");
  const priorityStart = page.indexOf(">Priority queue<", sourceStart);
  const sourcePanel = page.slice(sourceStart, priorityStart);

  assert.match(sourcePanel, /aria-label="Twitch channel value"/);
  assert.match(sourcePanel, /aria-label="Trusted Twitch clippers value"/);
  assert.doesNotMatch(sourcePanel, /readOnly=\{!isAdmin\}/);
  assert.doesNotMatch(sourcePanel, /focus-within:border-\[#9146ff\]/);
});

test("standalone clip cards avoid duplicate Twitch slug metadata", async () => {
  const standalone = await source("components/cliproom/StandaloneClipCard.tsx");

  assert.doesNotMatch(standalone, /Twitch clip:/);
  assert.doesNotMatch(standalone, /getTwitchClipSlug/);
  assert.match(standalone, /Open on \{getClipPlatform\(clip\.url\) \?\? "source"\}/);
});

test("standalone clips can edit title notes and category", async () => {
  const standalone = await source("components/cliproom/StandaloneClipCard.tsx");

  assert.match(standalone, /onUpdate/);
  assert.match(standalone, /aria-label=\{editOpen \? `Cancel editing \$\{clip\.title\}` : `Edit \$\{clip\.title\}`\}/);
  assert.match(standalone, /aria-label="Clip title"/);
  assert.match(standalone, /aria-label="Clip notes"/);
  assert.match(standalone, /maxLength=\{maxClipTitleLength\}/);
  assert.match(standalone, /maxLength=\{maxClipNotesLength\}/);
  assert.match(standalone, /Save details/);
});

test("segmented controls submit their parent form on Enter", async () => {
  const files = [
    "app/page.tsx",
    "components/cliproom/CollectionCard.tsx",
    "components/cliproom/CollectionIntake.tsx",
    "components/cliproom/StandaloneClipCard.tsx",
  ];

  for (const file of files) {
    const text = await source(file);
    assert.match(text, /submitParentFormOnEnter/);
    assert.match(text, /onKeyDown=\{submitParentFormOnEnter\}/);
  }
});

test("clickable controls use a pointer cursor by default", async () => {
  const globals = await source("app/globals.css");

  assert.match(globals, /button:not\(:disabled\)/);
  assert.match(globals, /a\[href\]/);
  assert.match(globals, /cursor: pointer/);
  assert.match(globals, /button:disabled/);
  assert.match(globals, /cursor: not-allowed/);
});

test("Collection clip switcher shows clip titles instead of URL slugs", async () => {
  const card = await source("components/cliproom/CollectionCard.tsx");
  const headerStart = card.indexOf("Collection ·");
  const switcherStart = card.indexOf("{collection.clips.map", headerStart);
  const controlsStart = card.indexOf("{selectedClip ? (", switcherStart);
  const header = card.slice(headerStart, switcherStart);
  const switcher = card.slice(switcherStart, controlsStart);

  assert.match(header, /selectedClipLabel/);
  assert.doesNotMatch(header, /getTwitchClipSlug\(selectedClip\.url\)/);
  assert.match(switcher, /collectionClipLabel\(clip, index\)/);
  assert.doesNotMatch(switcher, /getTwitchClipSlug\(clip\.url\) \?\? clip\.title/);
});

test("UI typography does not use negative letter spacing", async () => {
  const files = [
    "app/page.tsx",
    "components/cliproom/StandaloneClipCard.tsx",
    "components/cliproom/CollectionCard.tsx",
    "components/cliproom/CollectionIntake.tsx",
  ];

  for (const file of files) {
    assert.doesNotMatch(await source(file), /tracking-\[-/);
  }
});

test("visible copy uses form wording instead of intake wording", async () => {
  const page = await source("app/page.tsx");
  assert.doesNotMatch(page, />Close intake</);
  assert.doesNotMatch(page, />Manual intake</);
  assert.match(page, /"Close form"/);
  assert.doesNotMatch(page, /Manual submission/);
});

test("notes fields have fixed height and reasonable limits", async () => {
  const page = await source("app/page.tsx");
  const intake = await source("components/cliproom/CollectionIntake.tsx");
  const card = await source("components/cliproom/CollectionCard.tsx");

  assert.match(page, /maxLength=\{maxClipNotesLength\}/);
  assert.match(intake, /maxLength=\{maxCollectionNotesLength\}/);
  assert.match(card, /maxLength=\{maxCollectionNotesLength\}/);
  assert.doesNotMatch(intake, /resize-y/);
  assert.doesNotMatch(card, /resize-y/);
});

test("app shell fills the available width and adapts its columns", async () => {
  const page = await source("app/page.tsx");
  const globals = await source("app/globals.css");
  assert.match(page, /className="app-shell /);
  assert.match(globals, /\.app-shell\s*\{[^}]*width: 100%/);
  assert.match(globals, /@media \(min-width: 80rem\)/);
  assert.doesNotMatch(page, /max-w-\[1900px\]/);
  assert.doesNotMatch(page, /lg:grid-cols-\[190px_minmax\(0,1fr\)_320px\]/);
});
