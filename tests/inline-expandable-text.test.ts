import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("expandable text keeps read-more controls inline without adding a separate row", async () => {
  const expandable = await read("components/cliproom/ExpandableText.tsx");

  assert.match(expandable, /"flex min-w-0 items-end gap-1"/);
  assert.match(expandable, /"shrink-0 rounded text-\[11px\]/);
  assert.match(expandable, /\{text\}[\s\S]*?\{" "\}[\s\S]*?Show less/);
  assert.doesNotMatch(expandable, /className="mt-1 rounded text-\[11px\]/);
});

test("card note previews clamp to three lines without read-more controls", async () => {
  const [standalone, collection, css] = await Promise.all([
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(css, /\.task-card-notes\s*\{[\s\S]*?min-height:\s*4\.25rem/);
  assert.match(css, /\.task-card-notes-text\s*\{[\s\S]*?-webkit-line-clamp:\s*3/);

  for (const card of [standalone, collection]) {
    assert.match(card, /className="task-card-notes/);
    assert.match(card, /className="task-card-notes-text"/);
    assert.doesNotMatch(card, /label=\{`notes for/);
    assert.doesNotMatch(card, /collapsedControl/);
  }
});

test("task title surfaces retain the compact reserved height that keeps neighbouring notes aligned", async () => {
  const [css, standalone, collection] = await Promise.all([
    read("app/globals.css"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
  ]);

  assert.match(css, /\.task-card-title-copy\s*\{[\s\S]*?min-height:\s*2\.5rem/);
  assert.match(css, /\.task-card-title-text\s*\{[\s\S]*?font-size:\s*0\.875rem/);
  for (const card of [standalone, collection]) {
    assert.match(card, /className="task-card-title-text"/);
    assert.doesNotMatch(card, /overlayCollapsedControl/);
  }
});


test("expandable text measures the natural unclamped height so ellipsis never appears without Read more", async () => {
  const expandable = await read("components/cliproom/ExpandableText.tsx");

  assert.match(expandable, /element\.style\.webkitLineClamp\s*=\s*"unset"/);
  assert.match(expandable, /const naturalHeight = element\.scrollHeight/);
  assert.match(expandable, /const lineHeight = Number\.parseFloat\(computed\.lineHeight\)/);
  assert.match(expandable, /naturalHeight > collapsedHeight \+ 1/);
  assert.doesNotMatch(expandable, /const clipped = element\.scrollHeight > element\.clientHeight \+ 1/);
});
