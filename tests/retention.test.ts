import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { TestContext } from "node:test";

import { schemaStatements } from "../db/schema.ts";
import {
  buildRetentionStatements,
  buildRestoreStatements,
  buildSoftDeleteStatements,
  buildPermanentDeleteStatements,
} from "../lib/cliproom/retention.ts";
import type { RetentionStatement } from "../lib/cliproom/retention.ts";

const now = "2026-09-12T12:00:00.000Z";
const oldCreatedAt = "2025-01-01T00:00:00.000Z";
const oldPostedAt = "2026-09-10T12:00:00.000Z";
const recoverableDeletedAt = "2026-09-12T06:00:00.000Z";
const expiredDeletedAt = "2026-09-11T12:00:00.000Z";
type TaskTable = "clips" | "collections";
type Values = Record<string, string | number | null>;

function database(t: TestContext) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("PRAGMA foreign_keys = ON");
  for (const sql of schemaStatements) db.exec(sql);
  // Also runs against the pre-migration schema during the initial red phase.
  for (const table of ["clips", "collections"]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((column) => column.name === "deleted_at")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_at TEXT`);
    }
  }
  db.prepare(`INSERT INTO members (id, username, role, created_at)
    VALUES ('editor', 'editor', 'Admin', ?)`).run(oldCreatedAt);
  db.prepare(`INSERT INTO sessions (id, member_id, session_hash, created_at, expires_at)
    VALUES ('session', 'editor', 'hash', ?, '2027-01-01T00:00:00.000Z')`).run(oldCreatedAt);
  db.prepare(`INSERT INTO settings (key, value, updated_at)
    VALUES ('room_name', 'Keep this room', ?)`).run(oldCreatedAt);
  return db;
}

function addTask(db: DatabaseSync, table: TaskTable, id: string, overrides: Values = {}) {
  const values: Values = {
    id,
    ...(table === "clips" ? { url: `https://clips.twitch.tv/${id}` } : {}),
    title: `${id} title`,
    category: "gameplay",
    status: "Editing",
    priority: 1,
    assignee: "editor",
    assignee_member_id: "editor",
    notes: `${id} notes`,
    created_at: oldCreatedAt,
    updated_at: oldCreatedAt,
    created_by: "editor",
    claimed_at: "2026-09-01T10:00:00.000Z",
    posted_at: null,
    deleted_at: null,
    ...overrides,
  };
  db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(", ")})
    VALUES (${Object.keys(values).map(() => "?").join(", ")})`).run(...Object.values(values));
}

function addChild(db: DatabaseSync, collectionId: string, clipId: string, position: number) {
  db.prepare(`INSERT INTO collection_clips (collection_id, clip_id, position, created_at)
    VALUES (?, ?, ?, ?)`).run(collectionId, clipId, position, oldCreatedAt);
}

function execute(db: DatabaseSync, statements: RetentionStatement[]) {
  db.exec("BEGIN");
  try {
    for (const { sql, params } of statements) db.prepare(sql).run(...params);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function row(db: DatabaseSync, table: TaskTable, id: string) {
  const result = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  assert.ok(result, `${table}/${id} should exist`);
  return { ...result };
}

function workflow(db: DatabaseSync, table: TaskTable, id: string) {
  return Object.fromEntries(
    Object.entries(row(db, table, id)).filter(([key]) => !["deleted_at", "updated_at"].includes(key)),
  );
}

function membership(db: DatabaseSync) {
  return db.prepare("SELECT * FROM collection_clips ORDER BY collection_id, position").all();
}

test("automatic expiry uses valid Posted timestamps at the 24-hour boundary, never creation time", (t) => {
  const db = database(t);
  const cases = [
    { id: "older", status: "Posted", postedAt: oldPostedAt, deletedAt: now },
    { id: "boundary", status: "Posted", postedAt: "2026-09-11T12:00:00.000Z", deletedAt: now },
    { id: "recent", status: "Posted", postedAt: "2026-09-11T12:00:00.001Z", deletedAt: null },
    { id: "old-offset", status: "Posted", postedAt: "2026-09-11T13:00:00.000+02:00", deletedAt: now },
    { id: "recent-offset", status: "Posted", postedAt: "2026-09-11T11:30:00.000-01:00", deletedAt: null },
    { id: "future", status: "Posted", postedAt: "2026-09-13T12:00:00.000Z", deletedAt: null },
    { id: "missing", status: "Posted", postedAt: null, deletedAt: null },
    { id: "invalid", status: "Posted", postedAt: "not-a-date", deletedAt: null },
    { id: "empty", status: "Posted", postedAt: "", deletedAt: null },
    { id: "new", status: "New", postedAt: oldPostedAt, deletedAt: null },
    { id: "prioritised", status: "Prioritised", postedAt: oldPostedAt, deletedAt: null },
    { id: "claimed", status: "Claimed", postedAt: oldPostedAt, deletedAt: null },
    { id: "editing", status: "Editing", postedAt: oldPostedAt, deletedAt: null },
  ];
  for (const table of ["clips", "collections"] as const) {
    for (const fixture of cases) {
      addTask(db, table, fixture.id, { status: fixture.status, posted_at: fixture.postedAt });
    }
    addTask(db, table, "newly-created-old-post", {
      status: "Posted", posted_at: oldPostedAt, created_at: now,
    });
  }

  execute(db, buildRetentionStatements(now));

  for (const table of ["clips", "collections"] as const) {
    for (const fixture of cases) {
      assert.equal(row(db, table, fixture.id).deleted_at, fixture.deletedAt, `${table}/${fixture.id}`);
    }
    assert.equal(row(db, table, "newly-created-old-post").deleted_at, now);
  }
});

test("automatic standalone expiry preserves the posted workflow and clip content", (t) => {
  const db = database(t);
  addTask(db, "clips", "posted", { status: "Posted", posted_at: oldPostedAt });
  const before = workflow(db, "clips", "posted");

  execute(db, buildRetentionStatements(now));

  assert.equal(row(db, "clips", "posted").deleted_at, now);
  assert.deepEqual(workflow(db, "clips", "posted"), before);
});

test("expiry treats a collection as one task and preserves every child's workflow and order", (t) => {
  const db = database(t);
  addTask(db, "collections", "posted-group", { status: "Posted", posted_at: oldPostedAt });
  addTask(db, "collections", "active-group");
  addTask(db, "clips", "editing-child");
  addTask(db, "clips", "new-child", { status: "New", priority: 0 });
  addTask(db, "clips", "posted-in-active-group", { status: "Posted", posted_at: oldPostedAt });
  addChild(db, "posted-group", "editing-child", 5);
  addChild(db, "posted-group", "new-child", 2);
  addChild(db, "active-group", "posted-in-active-group", 0);
  const beforeParent = workflow(db, "collections", "posted-group");
  const beforeChildren = ["editing-child", "new-child"].map((id) => workflow(db, "clips", id));
  const beforeMembership = membership(db);

  execute(db, buildRetentionStatements(now));

  assert.equal(row(db, "collections", "posted-group").deleted_at, now);
  assert.deepEqual(workflow(db, "collections", "posted-group"), beforeParent);
  for (const [index, id] of ["editing-child", "new-child"].entries()) {
    assert.equal(row(db, "clips", id).deleted_at, now);
    assert.deepEqual(workflow(db, "clips", id), beforeChildren[index]);
  }
  assert.equal(row(db, "collections", "active-group").deleted_at, null);
  assert.equal(row(db, "clips", "posted-in-active-group").deleted_at, null);
  assert.deepEqual(membership(db), beforeMembership);
});

test("repeated retention and manual deletion do not extend an existing recovery window", (t) => {
  const db = database(t);
  for (const table of ["clips", "collections"] as const) {
    addTask(db, table, "already-deleted", {
      status: "Posted", posted_at: oldPostedAt, deleted_at: recoverableDeletedAt,
    });
  }
  execute(db, buildRetentionStatements(now));
  execute(db, buildSoftDeleteStatements("clip", "already-deleted", now));
  execute(db, buildSoftDeleteStatements("collection", "already-deleted", now));
  execute(db, buildRetentionStatements("2026-09-12T13:00:00.000Z"));

  for (const table of ["clips", "collections"] as const) {
    assert.equal(row(db, table, "already-deleted").deleted_at, recoverableDeletedAt);
  }
});

test("manual standalone deletion preserves workflow and cannot delete a grouped clip", (t) => {
  const db = database(t);
  addTask(db, "clips", "standalone");
  addTask(db, "clips", "child");
  addTask(db, "collections", "group");
  addChild(db, "group", "child", 0);
  const beforeStandalone = workflow(db, "clips", "standalone");
  const beforeChild = row(db, "clips", "child");

  execute(db, buildSoftDeleteStatements("clip", "standalone", now));
  execute(db, buildSoftDeleteStatements("clip", "child", now));
  execute(db, buildSoftDeleteStatements("clip", "missing", now));

  assert.equal(row(db, "clips", "standalone").deleted_at, now);
  assert.deepEqual(workflow(db, "clips", "standalone"), beforeStandalone);
  assert.deepEqual(row(db, "clips", "child"), beforeChild);
  assert.equal(row(db, "collections", "group").deleted_at, null);
  assert.equal(membership(db).length, 1);
});

test("manual collection deletion marks all children while retaining content and membership", (t) => {
  const db = database(t);
  addTask(db, "collections", "group");
  addTask(db, "clips", "first", { status: "Posted", posted_at: oldPostedAt });
  addTask(db, "clips", "second", { status: "New", priority: 0 });
  addTask(db, "clips", "unrelated");
  addChild(db, "group", "first", 3);
  addChild(db, "group", "second", 1);
  const before = [workflow(db, "collections", "group"), workflow(db, "clips", "first"), workflow(db, "clips", "second")];
  const beforeMembership = membership(db);

  execute(db, buildSoftDeleteStatements("collection", "group", now));

  assert.equal(row(db, "collections", "group").deleted_at, now);
  assert.equal(row(db, "clips", "first").deleted_at, now);
  assert.equal(row(db, "clips", "second").deleted_at, now);
  assert.equal(row(db, "clips", "unrelated").deleted_at, null);
  assert.deepEqual([workflow(db, "collections", "group"), workflow(db, "clips", "first"), workflow(db, "clips", "second")], before);
  assert.deepEqual(membership(db), beforeMembership);
});

test("purge uses the 24-hour deleted timestamp boundary and preserves unrelated room data", (t) => {
  const db = database(t);
  addTask(db, "clips", "expired", { deleted_at: "2026-09-01T00:00:00.000Z" });
  addTask(db, "clips", "boundary", { deleted_at: expiredDeletedAt });
  addTask(db, "clips", "recoverable", { deleted_at: "2026-09-11T12:00:00.001Z" });
  addTask(db, "clips", "active");
  addTask(db, "clips", "invalid", { deleted_at: "not-a-date" });
  addTask(db, "clips", "recently-deleted-old-post", {
    status: "Posted", posted_at: oldPostedAt, deleted_at: recoverableDeletedAt,
  });
  const beforeMembers = db.prepare("SELECT * FROM members").all();
  const beforeSessions = db.prepare("SELECT * FROM sessions").all();
  const beforeSettings = db.prepare("SELECT * FROM settings").all();

  execute(db, buildRetentionStatements(now));

  assert.equal(db.prepare("SELECT id FROM clips WHERE id = 'expired'").get(), undefined);
  assert.equal(db.prepare("SELECT id FROM clips WHERE id = 'boundary'").get(), undefined);
  assert.equal(row(db, "clips", "recoverable").deleted_at, "2026-09-11T12:00:00.001Z");
  assert.equal(row(db, "clips", "active").deleted_at, null);
  assert.equal(row(db, "clips", "invalid").deleted_at, "not-a-date");
  assert.equal(row(db, "clips", "recently-deleted-old-post").deleted_at, recoverableDeletedAt);
  assert.deepEqual(db.prepare("SELECT * FROM members").all(), beforeMembers);
  assert.deepEqual(db.prepare("SELECT * FROM sessions").all(), beforeSessions);
  assert.deepEqual(db.prepare("SELECT * FROM settings").all(), beforeSettings);
});

test("purge removes expired collections and children but retains children linked to a retained parent", (t) => {
  const db = database(t);
  addTask(db, "collections", "expired-group", { deleted_at: expiredDeletedAt });
  addTask(db, "collections", "recoverable-group", { deleted_at: recoverableDeletedAt });
  addTask(db, "collections", "active-group");
  addTask(db, "clips", "expired-child", { deleted_at: expiredDeletedAt });
  addTask(db, "clips", "retained-deleted-child", { deleted_at: expiredDeletedAt });
  addTask(db, "clips", "active-parent-child", { deleted_at: expiredDeletedAt });
  addChild(db, "expired-group", "expired-child", 0);
  addChild(db, "recoverable-group", "retained-deleted-child", 4);
  addChild(db, "active-group", "active-parent-child", 2);

  execute(db, buildRetentionStatements(now));

  assert.equal(db.prepare("SELECT id FROM collections WHERE id = 'expired-group'").get(), undefined);
  assert.equal(db.prepare("SELECT id FROM clips WHERE id = 'expired-child'").get(), undefined);
  assert.equal(row(db, "collections", "recoverable-group").deleted_at, recoverableDeletedAt);
  assert.equal(row(db, "clips", "retained-deleted-child").deleted_at, expiredDeletedAt);
  assert.equal(row(db, "clips", "active-parent-child").deleted_at, expiredDeletedAt);
  assert.deepEqual(membership(db).map((link) => [link.collection_id, link.clip_id, link.position]), [
    ["active-group", "active-parent-child", 2],
    ["recoverable-group", "retained-deleted-child", 4],
  ]);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("restoring a Posted standalone task resets its workflow so retention cannot immediately delete it", (t) => {
  const db = database(t);
  addTask(db, "clips", "posted", { status: "Posted", posted_at: oldPostedAt, deleted_at: recoverableDeletedAt });
  const before = workflow(db, "clips", "posted");

  execute(db, buildRestoreStatements("clip", "posted", now));
  execute(db, buildRetentionStatements(now));

  assert.equal(row(db, "clips", "posted").deleted_at, null);
  assert.deepEqual(workflow(db, "clips", "posted"), {
    ...before, status: "New", priority: 0, assignee: "Unclaimed", assignee_member_id: null,
    claimed_at: null, posted_at: null,
  });
});

test("restoring non-Posted standalone tasks preserves their original workflow", (t) => {
  const db = database(t);
  for (const status of ["New", "Prioritised", "Claimed", "Editing"]) {
    addTask(db, "clips", status, { status, deleted_at: recoverableDeletedAt });
    const before = workflow(db, "clips", status);

    execute(db, buildRestoreStatements("clip", status, now));

    assert.equal(row(db, "clips", status).deleted_at, null);
    assert.deepEqual(workflow(db, "clips", status), before);
  }
});

test("standalone restore rejects expired, active, invalid, and grouped records", (t) => {
  const db = database(t);
  addTask(db, "collections", "group", { deleted_at: recoverableDeletedAt });
  for (const fixture of [
    { id: "expired", deletedAt: expiredDeletedAt },
    { id: "older", deletedAt: "2026-09-01T00:00:00.000Z" },
    { id: "active", deletedAt: null },
    { id: "invalid", deletedAt: "not-a-date" },
    { id: "grouped", deletedAt: recoverableDeletedAt },
  ]) {
    addTask(db, "clips", fixture.id, { status: "Posted", posted_at: oldPostedAt, deleted_at: fixture.deletedAt });
    if (fixture.id === "grouped") addChild(db, "group", fixture.id, 0);
    const before = row(db, "clips", fixture.id);

    execute(db, buildRestoreStatements("clip", fixture.id, now));

    assert.deepEqual(row(db, "clips", fixture.id), before, fixture.id);
  }
  execute(db, buildRestoreStatements("clip", "missing", now));
});

test("restore remains available one millisecond before the 24-hour deadline", (t) => {
  const db = database(t);
  for (const [kind, table] of [["clip", "clips"], ["collection", "collections"]] as const) {
    addTask(db, table, "last-moment", { deleted_at: "2026-09-11T12:00:00.001Z" });

    execute(db, buildRestoreStatements(kind, "last-moment", now));

    assert.equal(row(db, table, "last-moment").deleted_at, null);
  }
});

test("restoring a Posted collection resets only the parent and preserves child workflow and order", (t) => {
  const db = database(t);
  addTask(db, "collections", "group", {
    status: "Posted", posted_at: oldPostedAt, deleted_at: recoverableDeletedAt,
  });
  addTask(db, "clips", "posted-child", {
    status: "Posted", posted_at: oldPostedAt, deleted_at: recoverableDeletedAt,
  });
  addTask(db, "clips", "editing-child", { deleted_at: recoverableDeletedAt });
  addChild(db, "group", "posted-child", 9);
  addChild(db, "group", "editing-child", 1);
  const beforeParent = workflow(db, "collections", "group");
  const beforeChildren = ["posted-child", "editing-child"].map((id) => workflow(db, "clips", id));
  const beforeMembership = membership(db);

  execute(db, buildRestoreStatements("collection", "group", now));
  execute(db, buildRetentionStatements(now));

  assert.equal(row(db, "collections", "group").deleted_at, null);
  assert.deepEqual(workflow(db, "collections", "group"), {
    ...beforeParent, status: "New", priority: 0, assignee: "Unclaimed", assignee_member_id: null,
    claimed_at: null, posted_at: null,
  });
  for (const [index, id] of ["posted-child", "editing-child"].entries()) {
    assert.equal(row(db, "clips", id).deleted_at, null);
    assert.deepEqual(workflow(db, "clips", id), beforeChildren[index]);
  }
  assert.deepEqual(membership(db), beforeMembership);
});

test("restoring a non-Posted collection retains its workflow and revives its children", (t) => {
  const db = database(t);
  addTask(db, "collections", "group", { deleted_at: recoverableDeletedAt });
  addTask(db, "clips", "child", { deleted_at: recoverableDeletedAt });
  addChild(db, "group", "child", 0);
  const before = workflow(db, "collections", "group");

  execute(db, buildRestoreStatements("collection", "group", now));

  assert.equal(row(db, "collections", "group").deleted_at, null);
  assert.equal(row(db, "clips", "child").deleted_at, null);
  assert.deepEqual(workflow(db, "collections", "group"), before);
});

test("an ineligible collection restore leaves every child untouched", (t) => {
  const db = database(t);
  for (const fixture of [
    { id: "expired", deletedAt: expiredDeletedAt },
    { id: "active", deletedAt: null },
    { id: "invalid", deletedAt: "not-a-date" },
  ]) {
    addTask(db, "collections", fixture.id, {
      status: "Posted", posted_at: oldPostedAt, deleted_at: fixture.deletedAt,
    });
    addTask(db, "clips", `${fixture.id}-child`, { deleted_at: recoverableDeletedAt });
    addChild(db, fixture.id, `${fixture.id}-child`, 0);
    const beforeParent = row(db, "collections", fixture.id);
    const beforeChild = row(db, "clips", `${fixture.id}-child`);

    execute(db, buildRestoreStatements("collection", fixture.id, now));

    assert.deepEqual(row(db, "collections", fixture.id), beforeParent, fixture.id);
    assert.deepEqual(row(db, "clips", `${fixture.id}-child`), beforeChild, fixture.id);
  }
});

test("permanent deletion removes only deleted standalone tasks and complete deleted collections", (t) => {
  const db = database(t);
  addTask(db, "clips", "deleted", { deleted_at: recoverableDeletedAt });
  addTask(db, "clips", "active");
  addTask(db, "collections", "deleted-group", { deleted_at: recoverableDeletedAt });
  addTask(db, "collections", "active-group");
  addTask(db, "clips", "deleted-child", { deleted_at: recoverableDeletedAt });
  addTask(db, "clips", "active-child");
  addChild(db, "deleted-group", "deleted-child", 0);
  addChild(db, "active-group", "active-child", 0);
  execute(db, buildPermanentDeleteStatements("clip", "active"));
  execute(db, buildPermanentDeleteStatements("clip", "deleted-child"));
  execute(db, buildPermanentDeleteStatements("collection", "active-group"));
  assert.equal(db.prepare("SELECT count(*) AS count FROM clips").get()?.count, 4);
  execute(db, buildPermanentDeleteStatements("clip", "deleted"));
  execute(db, buildPermanentDeleteStatements("collection", "deleted-group"));
  assert.deepEqual(db.prepare("SELECT id FROM clips ORDER BY id").all().map((item) => item.id), ["active", "active-child"]);
  assert.deepEqual(membership(db).map((link) => link.collection_id), ["active-group"]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM sessions").get()?.count, 1);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});
