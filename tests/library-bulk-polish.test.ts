import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("library selection mode supports Apple Photos style bulk deletion", async () => {
  const [page, standalone, collection, css] = await Promise.all([
    read("app/page.tsx"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(page, /selectMode/);
  assert.match(page, /selectedTaskKeys/);
  assert.match(page, /toggleTaskSelected/);
  assert.match(page, /deleteSelectedTasks/);
  assert.match(page, />Select</);
  assert.match(page, /Delete selected/);
  assert.match(page, /Select all visible/);
  assert.match(page, /bulk-delete/);

  for (const card of [standalone, collection]) {
    assert.match(card, /selectMode/);
    assert.match(card, /selected/);
    assert.match(card, /onToggleSelected/);
    assert.match(card, /data-selected=\{selected\}/);
    assert.match(card, /task-card-select-toggle/);
  }

  assert.match(css, /\.queue-card\[data-selected="true"\]/);
  assert.match(css, /\.task-card-select-toggle/);
  assert.match(css, /\.selection-bar/);
});

test("manual notes fields start empty but submit N/A when left blank", async () => {
  const [page, intake, standalone, collection] = await Promise.all([
    read("app/page.tsx"),
    read("components/cliproom/CollectionIntake.tsx"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
  ]);

  assert.match(page, /notes:\s*""/);
  assert.match(page, /normaliseTaskNotes\(clipForm\.notes\)/);
  assert.doesNotMatch(page, /notes:\s*defaultTaskNotes/);
  assert.match(intake, /useState\(""\)/);
  assert.match(intake, /normaliseTaskNotes\(notes\)/);

  for (const card of [standalone, collection]) {
    assert.match(card, /notesInputValue/);
    assert.match(card, /normaliseTaskNotes\(editNotes\)/);
  }
});

test("trusted clip badges are compact and title space is favoured over notes", async () => {
  const [standalone, css] = await Promise.all([
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(standalone, /`@\$\{clip\.twitchCreatorLogin\}`/);
  assert.doesNotMatch(standalone, /Trusted: @/);
  assert.match(standalone, /trustedBadge \? \[trustedBadge\] : \[categoryBadge\]/);
  assert.match(css, /\.task-card-title-copy\s*\{[\s\S]*?min-height:\s*3\.75rem/);
  assert.match(css, /\.task-card-title-text\s*\{[\s\S]*?-webkit-line-clamp:\s*3/);
  assert.match(css, /\.task-card-notes\s*\{[\s\S]*?min-height:\s*3rem/);
  const notesTextStart = css.indexOf(".task-card-notes-text");
  const notesTextEnd = css.indexOf("}", notesTextStart);
  const notesTextRule = css.slice(notesTextStart, notesTextEnd);
  assert.match(notesTextRule, /display:\s*block/);
  assert.match(notesTextRule, /max-height:\s*2\.5rem/);
  assert.match(notesTextRule, /text-overflow:\s*clip/);
  assert.doesNotMatch(notesTextRule, /-webkit-line-clamp/);
});

test("notes editors use a simple fixed character cap instead of visual measuring", async () => {
  const [shared, page, intake, standalone, collection] = await Promise.all([
    read("lib/cliproom/shared.ts"),
    read("app/page.tsx"),
    read("components/cliproom/CollectionIntake.tsx"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
  ]);

  assert.match(shared, /maxClipNotesLength\s*=\s*92/);
  assert.match(shared, /maxCollectionNotesLength\s*=\s*92/);

  for (const source of [page, intake, standalone, collection]) {
    assert.doesNotMatch(source, /VisualNotesTextarea/);
  }

  assert.match(page, /maxLength=\{maxClipNotesLength\}/);
  assert.match(intake, /maxLength=\{maxCollectionNotesLength\}/);
  assert.match(standalone, /maxLength=\{maxClipNotesLength\}/);
  assert.match(collection, /maxLength=\{maxCollectionNotesLength\}/);
});
