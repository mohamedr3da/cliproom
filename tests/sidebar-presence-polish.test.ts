import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("right workspace panels collapse without reflowing their text", async () => {
  const [page, css] = await Promise.all([read("app/page.tsx"), read("app/globals.css")]);

  assert.match(page, /workspace-panel-viewport/);
  assert.match(page, /workspace-panel-content/);
  assert.match(css, /--workspace-panel-width:\s*300px/);
  assert.match(css, /\.workspace-panel-viewport\s*\{[\s\S]*?overflow:\s*clip/);
  assert.match(css, /\.workspace-panel-content\s*\{[\s\S]*?width:\s*var\(--workspace-panel-width\)/);
  assert.match(css, /\.workspace-panel-content\s*\{[\s\S]*?transition:[\s\S]*?opacity[\s\S]*?transform/);
  assert.doesNotMatch(css, /\.workspace-panels\[data-collapsed="true"\]\s*>\s*section\s*\{[\s\S]*?display:\s*none/);
});

test("room state reports an online member count from recent last-seen activity", async () => {
  const [shared, server, page] = await Promise.all([
    read("lib/cliproom/shared.ts"),
    read("lib/cliproom/server.ts"),
    read("app/page.tsx"),
  ]);

  assert.match(shared, /onlineMemberCount:\s*number/);
  assert.match(server, /onlineWindowMs\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
  assert.match(server, /presenceHeartbeatMs\s*=\s*2\s*\*\s*60\s*\*\s*1000/);
  assert.match(server, /last_seen_at\s*>?=\s*\?/);
  assert.match(server, /onlineMemberCount:/);

  const statsStart = page.indexOf(">Room stats<");
  const statsEnd = page.indexOf("Private clip library for your creator team.", statsStart);
  const stats = page.slice(statsStart, statsEnd);
  assert.match(stats, /\["Online", roomState\.onlineMemberCount/);
  assert.match(stats, /bg-emerald-400/);
  const clipsIndex = stats.indexOf('["Clips", counts.all');
  const trustedIndex = stats.indexOf('["Trusted", counts.trusted');
  const savedIndex = stats.indexOf('["Saved", counts.saved');
  const priorityIndex = stats.indexOf('["Priority", priorityTasks.length');
  const postedIndex = stats.indexOf('["Posted", counts.posted');
  const membersIndex = stats.indexOf('["Members", roomState.memberCount');
  const onlineIndex = stats.indexOf('["Online", roomState.onlineMemberCount');

  for (const index of [clipsIndex, trustedIndex, savedIndex, priorityIndex, postedIndex, membersIndex, onlineIndex]) assert.ok(index !== -1);
  assert.ok(clipsIndex < trustedIndex);
  assert.ok(trustedIndex < savedIndex);
  assert.ok(savedIndex < priorityIndex);
  assert.ok(priorityIndex < postedIndex);
  assert.ok(postedIndex < membersIndex);
  assert.ok(membersIndex < onlineIndex);
});

test("library metadata preserves date and priority without assignment copy", async () => {
  const [css, standalone, collection] = await Promise.all([
    read("app/globals.css"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
  ]);

  assert.match(css, /\.task-card-meta\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content/);
  for (const card of [standalone, collection]) {
    assert.match(card, /className="task-card-meta/);
    assert.match(card, /task-card-meta-date/);
    assert.doesNotMatch(card, /task-card-meta-assignee/);
    assert.match(card, /task-card-meta-priority/);
  }
});

test("library cards use saved heart actions instead of workflow reset controls", async () => {
  for (const path of ["components/cliproom/StandaloneClipCard.tsx", "components/cliproom/CollectionCard.tsx"]) {
    const card = await read(path);
    const formStart = card.indexOf("{editOpen ? (");
    const actionsStart = card.indexOf('className="task-card-actions', formStart);
    const editForm = card.slice(formStart, actionsStart);
    const actions = card.slice(actionsStart);

    assert.doesNotMatch(editForm, /Reset progress/);
    assert.match(actions, /task-card-workflow/);
    assert.match(actions, /Heart/);
    assert.match(actions, /onToggleSaved/);
    assert.doesNotMatch(actions, /Reset progress/);
  }
});

test("library cards have no workflow reset handler left open during editing", async () => {
  for (const path of ["components/cliproom/StandaloneClipCard.tsx", "components/cliproom/CollectionCard.tsx"]) {
    const card = await read(path);
    assert.doesNotMatch(card, /function handleResetProgress\(\)/);
    assert.doesNotMatch(card, /onResetProgress/);
    assert.doesNotMatch(card, /Reset progress/);
  }
});

test("task titles stay capped and plain across normal and collapsed card grids", async () => {
  const [shared, standalone, collection, css] = await Promise.all([
    read("lib/cliproom/shared.ts"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(shared, /maxClipTitleLength\s*=\s*120/);
  assert.match(shared, /maxCollectionTitleLength\s*=\s*120/);
  const titleTextStart = css.indexOf(".task-card-title-text");
  const titleTextEnd = css.indexOf("}", titleTextStart);
  const titleTextRule = css.slice(titleTextStart, titleTextEnd);
  assert.match(titleTextRule, /-webkit-line-clamp:\s*3/);
  for (const card of [standalone, collection]) {
    assert.match(card, /task-card-title-block/);
    assert.match(card, /task-card-title-row/);
    assert.match(card, /className="task-card-title-text"/);
    assert.doesNotMatch(card, /overlayCollapsedControl/);
    assert.doesNotMatch(card, /expandedLines=\{4\}/);
  }
});
