import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("permanent delete is wired only for admins in the deleted-task UI", async () => {
  const [page, recent] = await Promise.all([
    read("app/page.tsx"),
    read("components/cliproom/RecentlyDeleted.tsx"),
  ]);

  assert.match(page, /if \(!isAdmin\)[\s\S]*?return false/);
  assert.match(page, /onPermanentDelete=\{isAdmin \? permanentlyDeleteTask : undefined\}/);
  assert.match(recent, /onPermanentDelete\?:/);
  assert.match(recent, /isAdmin && onPermanentDelete/);
  assert.match(recent, /await onPermanentDelete/);
});

test("display dates are formatted in the current viewer timezone with labels where useful", async () => {
  const [dateFormat, taskShared, auditPage, recent, homePage] = await Promise.all([
    read("components/cliproom/date-format.ts"),
    read("components/cliproom/task-card-shared.ts"),
    read("app/audit/page.tsx"),
    read("components/cliproom/RecentlyDeleted.tsx"),
    read("app/page.tsx"),
  ]);

  assert.match(dateFormat, /export function formatUserDate/);
  assert.match(dateFormat, /export function formatUserDateTime/);
  assert.doesNotMatch(dateFormat, /timeZone:/);
  assert.match(dateFormat, /timeZoneName:\s*"short"/);
  assert.match(taskShared, /formatUserDate/);
  assert.match(auditPage, /formatUserDateTime/);
  assert.match(recent, /formatUserDate/);
  assert.match(homePage, /formatUserDate/);
});
