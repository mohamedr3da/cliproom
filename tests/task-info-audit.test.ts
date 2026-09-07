import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function readMaybe(path: string) {
  try {
    return await read(path);
  } catch {
    return "";
  }
}

test("task cards expose a compact info popover backed by creator metadata", async () => {
  const [shared, server, infoPopover, standalone, collection] = await Promise.all([
    read("lib/cliproom/shared.ts"),
    read("lib/cliproom/server.ts"),
    readMaybe("components/cliproom/TaskInfoPopover.tsx"),
    read("components/cliproom/StandaloneClipCard.tsx"),
    read("components/cliproom/CollectionCard.tsx"),
  ]);

  assert.match(shared, /createdBy:\s*string\s*\|\s*null/);
  assert.match(server, /created_by_display_name/);
  assert.match(infoPopover, /Info/);
  assert.match(infoPopover, /Added by/);
  assert.match(infoPopover, /Last updated/);
  assert.match(infoPopover, /aria-label=\{`Show info for/);
  assert.doesNotMatch(infoPopover, /aria-modal="true"/);
  assert.doesNotMatch(infoPopover, /task-info-backdrop/);
  assert.doesNotMatch(infoPopover, /backdrop-blur/);
  assert.match(infoPopover, /pointer-events-none fixed inset-0/);
  assert.match(infoPopover, /onPointerDown/);
  assert.match(infoPopover, /Refresh info/);
  assert.doesNotMatch(infoPopover, /<details/);
  assert.match(standalone, /<TaskInfoPopover[\s\S]*task=\{clip\}/);
  assert.match(collection, /<TaskInfoPopover[\s\S]*task=\{collection\}/);
});

test("admin audit logs have a schema, API route, page, and main-page entry point", async () => {
  const [schema, server, route, auditPage, homePage] = await Promise.all([
    read("db/schema.ts"),
    read("lib/cliproom/server.ts"),
    readMaybe("app/api/cliproom/audit/route.ts"),
    readMaybe("app/audit/page.tsx"),
    read("app/page.tsx"),
  ]);

  assert.match(schema, /CREATE TABLE IF NOT EXISTS audit_logs/i);
  assert.match(schema, /idx_audit_logs_created_at/i);
  assert.match(server, /auditSchemaVersionSettingKey/);
  assert.match(server, /recordAuditLog/);
  assert.match(server, /export async function getAuditLogs/);
  assert.match(server, /requireAdmin\(actor\)/);
  assert.match(server, /clip\.reset/);
  assert.match(server, /collection\.reset/);
  assert.match(route, /getAuditLogs/);
  assert.match(route, /requireMember/);
  assert.match(auditPage, /Back to ClipRoom/);
  assert.match(auditPage, /\/api\/cliproom\/audit/);
  assert.match(homePage, /href="\/audit"/);
  assert.match(homePage, /Audit logs/);
});

test("audit logs prune old entries automatically after a retention window", async () => {
  const [schema, server, shared] = await Promise.all([
    read("db/schema.ts"),
    read("lib/cliproom/server.ts"),
    read("lib/cliproom/shared.ts"),
  ]);

  assert.match(schema, /CREATE TRIGGER IF NOT EXISTS audit_logs_prune_after_insert/i);
  assert.match(schema, /DELETE FROM audit_logs\s+WHERE created_at < strftime\('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days'\)/i);
  assert.match(server, /currentAuditSchemaVersion\s*=\s*"audit-v2"/);
  assert.match(shared, /auditLogRetentionDays\s*=\s*90/);
  assert.match(server, /function auditLogRetentionCutoff/);
  assert.match(server, /async function pruneExpiredAuditLogs/);
  assert.match(server, /DELETE FROM audit_logs WHERE created_at < \?/);
  assert.match(server, /getAuditLogs[\s\S]*?pruneExpiredAuditLogs/);
});
