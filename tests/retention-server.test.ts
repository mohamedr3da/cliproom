import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { schemaStatements } from "../db/schema.ts";
import type { CurrentMember } from "../lib/cliproom/shared.ts";
import { buildSoftDeleteStatements } from "../lib/cliproom/retention.ts";

const testBindings: { DB?: object } = {};
Object.assign(globalThis, { __cliproomRetentionTestBindings: testBindings });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        url: "data:text/javascript,export const env = globalThis.__cliproomRetentionTestBindings;",
        shortCircuit: true,
      };
    }
    if (specifier.startsWith("@/")) {
      return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

type QueryHooks = { afterFirst?: (sql: string) => void; executed?: string[]; batches?: string[][] };

function d1Adapter(db: DatabaseSync, hooks: QueryHooks) {
  const prepare = (sql: string, params: (string | number | null)[] = []) => ({
    bind: (...values: (string | number | null)[]) => prepare(sql, values),
    sql,
    first: async () => {
      hooks.executed?.push(sql);
      const row = db.prepare(sql).get(...params) ?? null;
      hooks.afterFirst?.(sql);
      return row;
    },
    all: async () => {
      hooks.executed?.push(sql);
      return { results: db.prepare(sql).all(...params) };
    },
    run: async () => {
      hooks.executed?.push(sql);
      const statement = db.prepare(sql);
      return statement.columns().length
        ? { results: statement.all(...params), meta: { changes: 0 } }
        : { results: [], meta: { changes: Number(statement.run(...params).changes) } };
    },
  });
  return {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      hooks.batches?.push(statements.map((statement) => statement.sql));
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const member: CurrentMember = {
  id: "member_editor",
  username: "editor",
  displayName: "Editor",
  avatarUrl: null,
  role: "Clipper",
};

let fixtureNumber = 0;
async function fixture(legacy = false) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const sql of schemaStatements) {
    db.exec(legacy ? sql.replaceAll("    deleted_at TEXT,\n", "") : sql);
  }
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run(
    "_cliproom_schema_version", "twitch-auth-v1", now,
  );
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run(
    "_cliproom_collections_schema_version", "collections-v1", now,
  );
  db.prepare(`INSERT INTO members (id, username, twitch_user_id, twitch_login, role, created_at)
    VALUES (?, 'editor', 'twitch_editor', 'editor', 'Clipper', ?)`).run(member.id, now);
  db.prepare(`INSERT INTO sessions (id, member_id, session_hash, created_at, expires_at)
    VALUES ('existing_session', ?, ?, ?, ?)`).run(
    member.id,
    createHash("sha256").update("cliproom:session:retention-test-session").digest("hex"),
    now,
    new Date(Date.now() + 86_400_000).toISOString(),
  );
  const hooks: QueryHooks = {};
  testBindings.DB = d1Adapter(db, hooks);
  const server = await import(`../lib/cliproom/server.ts?retention=${++fixtureNumber}`) as typeof import("../lib/cliproom/server.ts");
  return { db, server, hooks };
}

function insertClip(db: DatabaseSync, id: string, status = "New", postedAt: string | null = null) {
  db.prepare(`INSERT INTO clips (id, url, title, category, status, created_at, updated_at, posted_at)
    VALUES (?, ?, ?, 'gameplay', ?, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', ?)`).run(
    id, `https://clips.twitch.tv/${id}`, id, status, postedAt,
  );
}

function insertCollection(db: DatabaseSync, id: string, children: string[], status = "New", postedAt: string | null = null) {
  db.prepare(`INSERT INTO collections (id, title, category, status, created_at, updated_at, posted_at)
    VALUES (?, ?, 'gameplay', ?, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', ?)`).run(
    id, id, status, postedAt,
  );
  for (const [position, clipId] of children.entries()) {
    insertClip(db, clipId);
    db.prepare(`INSERT INTO collection_clips (collection_id, clip_id, position, created_at)
      VALUES (?, ?, ?, '2020-01-01T00:00:00.000Z')`).run(id, clipId, position);
  }
}

test("retention migration adds columns to the existing database without deleting sessions", async () => {
  const { db, server } = await fixture(true);
  try {
    await server.ensureDatabase();
    for (const table of ["clips", "collections"]) {
      assert.ok(db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === "deleted_at"));
    }
    assert.equal(db.prepare("SELECT count(*) AS count FROM sessions").get()?.count, 1);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key = '_cliproom_schema_version'").get()?.value, "twitch-auth-v1");
  } finally { db.close(); }
});

test("room reads move expired Posted tasks into recoverable trash and keep grouped children grouped", async () => {
  const { db, server } = await fixture();
  try {
    insertClip(db, "old_new");
    insertClip(db, "expired", "Posted", new Date(Date.now() - 90_000_000).toISOString());
    insertClip(db, "recent", "Posted", new Date(Date.now() - 60_000).toISOString());
    insertCollection(db, "expired_group", ["child_two", "child_one"], "Posted", new Date(Date.now() - 90_000_000).toISOString());

    const state = await server.getRoomState(member);
    assert.deepEqual(state.clips.map((clip) => clip.id), ["old_new", "recent"]);
    assert.deepEqual(state.collections, []);
    assert.deepEqual(state.trash?.clips.map((clip) => clip.id), ["expired"]);
    assert.deepEqual(state.trash?.collections.map((group) => group.id), ["expired_group"]);
    assert.deepEqual(state.trash?.collections[0]?.clips.map((clip) => clip.id), ["child_two", "child_one"]);
    assert.ok(state.trash?.clips[0]?.deletedAt);
    assert.equal(db.prepare("SELECT count(*) AS count FROM clips").get()?.count, 5);
  } finally { db.close(); }
});

test("deleted standalone clips reject editing and restore Posted work as new unclaimed work", async () => {
  const { db, server } = await fixture();
  try {
    insertClip(db, "deleted", "Posted", new Date().toISOString());
    const state = await server.deleteClip(member, "deleted");
    assert.deepEqual(state.clips, []);
    assert.equal(state.trash?.clips[0]?.id, "deleted");
    await assert.rejects(server.updateClipDetails(member, "deleted", { title: "hidden edit", category: "gameplay" }), { status: 404 });
    await assert.rejects(server.advanceClip(member, "deleted"), { status: 404 });
    await assert.rejects(server.toggleClipPriority({ ...member, role: "Admin" }, "deleted"), { status: 404 });
    await assert.rejects(server.deleteClip(member, "deleted"), { status: 404 });

    const restored = await server.restoreClip(member, "deleted");
    assert.equal(restored.clips[0]?.status, "New");
    assert.equal(restored.clips[0]?.assignee, "Unclaimed");
    assert.equal(restored.clips[0]?.postedAt, null);
    assert.equal(restored.clips[0]?.deletedAt, null);
    assert.deepEqual(restored.trash?.clips, []);
  } finally { db.close(); }
});

test("deleted collections reject all hidden mutations and restore ordered children together", async () => {
  const { db, server } = await fixture();
  try {
    insertCollection(db, "group", ["two", "one"]);
    const state = await server.deleteCollection(member, "group");
    assert.deepEqual(state.collections, []);
    assert.deepEqual(state.clips, []);
    assert.deepEqual(state.trash?.collections[0]?.clips.map((clip) => clip.id), ["two", "one"]);
    await assert.rejects(server.updateCollection(member, "group", { title: "hidden", category: "gameplay" }), { status: 404 });
    await assert.rejects(server.advanceCollection(member, "group"), { status: 404 });
    await assert.rejects(server.toggleCollectionPriority({ ...member, role: "Admin" }, "group"), { status: 404 });
    await assert.rejects(server.addCollectionClip(member, "group", { url: "https://clips.twitch.tv/new" }), { status: 404 });
    await assert.rejects(server.removeCollectionClip(member, "group", "two"), { status: 404 });
    await assert.rejects(server.reorderCollectionClip(member, "group", "two", "right"), { status: 404 });
    await assert.rejects(server.deleteCollection(member, "group"), { status: 404 });
    await assert.rejects(server.restoreClip(member, "two"), { status: 404 });

    const restored = await server.restoreCollection(member, "group");
    assert.deepEqual(restored.collections[0]?.clips.map((clip) => clip.id), ["two", "one"]);
    assert.deepEqual(restored.clips, []);
    assert.deepEqual(restored.trash?.collections, []);
  } finally { db.close(); }
});

test("deleted clips cannot be reused to create or extend a collection before restoration", async () => {
  const { db, server } = await fixture();
  try {
    insertClip(db, "deleted");
    insertCollection(db, "group", ["child"]);
    await server.deleteClip(member, "deleted");
    await assert.rejects(server.createCollection(member, {
      title: "Hidden reuse", category: "gameplay", urls: ["https://clips.twitch.tv/deleted"],
    }), { status: 409 });
    await assert.rejects(server.addCollectionClip(member, "group", { url: "https://clips.twitch.tv/deleted" }), { status: 409 });
    assert.equal(db.prepare("SELECT count(*) AS count FROM collection_clips").get()?.count, 1);
  } finally { db.close(); }
});

test("a concurrent deletion cannot be overwritten by a stale clip or collection edit", async () => {
  for (const kind of ["clip", "collection"] as const) {
    const { db, server, hooks } = await fixture();
    try {
      if (kind === "clip") insertClip(db, "race");
      else insertCollection(db, "race", ["child"]);
      await server.ensureDatabase();
      const table = kind === "clip" ? "clips" : "collections";
      hooks.afterFirst = (sql) => {
        if (!sql.startsWith(`SELECT * FROM ${table}`)) return;
        hooks.afterFirst = undefined;
        db.prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = 'race'`).run(new Date().toISOString());
      };
      const update = kind === "clip"
        ? server.updateClipDetails(member, "race", { title: "stale edit", category: "gameplay" })
        : server.updateCollection(member, "race", { title: "stale edit", category: "gameplay" });
      await assert.rejects(update, { status: 404 });
      assert.equal(db.prepare(`SELECT title FROM ${table} WHERE id = 'race'`).get()?.title, "race");
    } finally { db.close(); }
  }
});

test("concurrent collection deletion prevents detach, reorder, or addition from changing its recoverable contents", async () => {
  for (const action of ["detach", "reorder", "add_new", "add_existing"] as const) {
    const { db, server, hooks } = await fixture();
    try {
      insertCollection(db, "race", ["first", "second"]);
      insertClip(db, "existing", "Editing");
      await server.ensureDatabase();
      hooks.afterFirst = (sql) => {
        if (!sql.startsWith("SELECT * FROM collections")) return;
        hooks.afterFirst = undefined;
        for (const statement of buildSoftDeleteStatements("collection", "race", new Date().toISOString())) {
          db.prepare(statement.sql).run(...statement.params);
        }
      };
      const operation = action === "detach" ? server.removeCollectionClip(member, "race", "first")
        : action === "reorder" ? server.reorderCollectionClip(member, "race", "first", "right")
        : server.addCollectionClip(member, "race", { url: `https://clips.twitch.tv/${action === "add_existing" ? "existing" : "new"}` });
      await assert.rejects(operation, { status: 404 }, action);
      assert.deepEqual(db.prepare("SELECT clip_id FROM collection_clips ORDER BY position").all().map((row) => row.clip_id), ["first", "second"]);
      assert.equal(db.prepare("SELECT count(*) AS count FROM clips").get()?.count, 3);
      assert.equal(db.prepare("SELECT status FROM clips WHERE id = 'existing'").get()?.status, "Editing");
    } finally { db.close(); }
  }
});

test("restore routes require a signed-in member and return updated room state for both task types", async () => {
  const { db, server } = await fixture();
  try {
    insertClip(db, "clip_restore");
    insertCollection(db, "group_restore", ["group_child"]);
    await server.deleteClip(member, "clip_restore");
    await server.deleteCollection(member, "group_restore");
    const routes = [
      { route: await import("../app/api/cliproom/clips/[id]/route.ts"), id: "clip_restore" },
      { route: await import("../app/api/cliproom/collections/[id]/route.ts"), id: "group_restore" },
    ];
    for (const { route, id } of routes) {
      const request = (authenticated: boolean) => new Request("http://localhost/api/cliproom/test", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
          ...(authenticated ? { Cookie: "cliproom_session=retention-test-session" } : {}),
        },
        body: JSON.stringify({ action: "restore" }),
      });
      assert.equal((await route.PATCH(request(false), { params: { id } })).status, 401);
      const restored = await route.PATCH(request(true), { params: { id } });
      assert.equal(restored.status, 200);
      const body = await restored.json() as { clips: { id: string }[]; collections: { id: string }[] };
      assert.ok(body.clips.some((clip: { id: string }) => clip.id === id) || body.collections.some((group: { id: string }) => group.id === id));
    }
  } finally { db.close(); }
});

test("compact clip mutations return only their affected card without full room or retention reads", async () => {
  const { db, server, hooks } = await fixture();
  try {
    for (let index = 0; index < 500; index++) insertClip(db, `clip_${index}`);
    await server.ensureDatabase();
    hooks.executed = [];
    const patch = await server.toggleClipPriority({ ...member, role: "Admin" }, "clip_0", true);
    assert.equal(patch.kind, "mutation");
    assert.equal(patch.clips.length, 1);
    assert.equal(patch.clips[0].id, "clip_0");
    assert.equal(patch.clips[0].priority, true);
    assert.deepEqual(patch.collections, []);
    assert.deepEqual(patch.removedClipIds, []);
    assert.deepEqual(Object.keys(patch).sort(), ["clips", "collections", "kind", "removedClipIds", "removedCollectionIds"]);
    assert.equal(hooks.executed.length, 4, "one task read, one guarded update, one audit write, one task response read");
    assert.ok(hooks.executed.some((sql) => sql.includes("INSERT INTO audit_logs")));
    assert.ok(hooks.executed.every((sql) => !sql.includes("FROM settings") && !sql.includes("SET deleted_at") && !sql.includes("FROM collections")));
    const edited = await server.updateClipDetails(member, "clip_0", { title: "Edited title", category: "news" }, true);
    assert.equal(edited.clips[0].title, "Edited title");
    const claimed = await server.advanceClip(member, "clip_0", true);
    assert.equal(claimed.clips[0].status, "Claimed");
    assert.equal(claimed.clips[0].assignee, member.username);
    const deleted = await server.deleteClip(member, "clip_0", true);
    assert.ok(deleted.clips[0].deletedAt);
    assert.equal(deleted.clips[0].deletedBy, member.username);
    const restored = await server.restoreClip(member, "clip_0", true);
    assert.equal(restored.clips[0].deletedAt, null);
    const added = await server.addClip(member, { url: "https://clips.twitch.tv/added", title: "Added clip", category: "social" }, true);
    assert.equal(added.clips.length, 1);
    assert.equal(added.clips[0].title, "Added clip");
    assert.equal(db.prepare("SELECT count(*) AS count FROM clips").get()?.count, 501);
  } finally { db.close(); }
});

test("collection patches preserve ordered children and account for clips moving into and out of the queue", async () => {
  const { db, server } = await fixture();
  try {
    insertClip(db, "first");
    insertClip(db, "second");
    insertClip(db, "third");
    insertClip(db, "unrelated");
    const created = await server.createCollection(member, {
      title: "Collection", category: "gameplay", urls: ["https://clips.twitch.tv/first", "https://clips.twitch.tv/second"],
    }, true);
    assert.deepEqual(created.clips, []);
    assert.deepEqual(created.removedClipIds, ["first", "second"]);
    const id = created.collections[0].id;
    assert.deepEqual(created.collections[0].clips.map((clip) => clip.id), ["first", "second"]);
    const added = await server.addCollectionClip(member, id, { url: "https://clips.twitch.tv/third" }, true);
    assert.deepEqual(added.removedClipIds, ["third"]);
    assert.deepEqual(added.collections[0].clips.map((clip) => clip.id), ["first", "second", "third"]);
    const reordered = await server.reorderCollectionClip(member, id, "third", "left", true);
    assert.deepEqual(reordered.collections[0].clips.map((clip) => clip.id), ["first", "third", "second"]);
    const detached = await server.removeCollectionClip(member, id, "third", true);
    assert.deepEqual(detached.collections[0].clips.map((clip) => clip.id), ["first", "second"]);
    assert.equal(detached.clips[0].id, "third");
    assert.equal(detached.clips[0].status, "New");
    assert.equal((await server.toggleCollectionPriority({ ...member, role: "Admin" }, id, true)).collections[0].priority, true);
    assert.equal((await server.updateCollection(member, id, { title: "Renamed", category: "news" }, true)).collections[0].title, "Renamed");
    assert.equal((await server.advanceCollection(member, id, true)).collections[0].status, "Claimed");
    const deleted = await server.deleteCollection(member, id, true);
    assert.ok(deleted.collections[0].deletedAt);
    assert.equal(deleted.collections[0].deletedBy, member.username);
    assert.ok(deleted.collections[0].clips.every((clip) => clip.deletedAt));
    const restored = await server.restoreCollection(member, id, true);
    assert.equal(restored.collections[0].deletedAt, null);
    assert.ok(restored.collections[0].clips.every((clip) => !clip.deletedAt));
    assert.equal(db.prepare("SELECT count(*) AS count FROM clips").get()?.count, 4);
  } finally { db.close(); }
});

test("permanent-delete APIs require admin access and only purge deleted tasks", async () => {
  const { db, server } = await fixture();
  try {
    insertClip(db, "active");
    insertClip(db, "deleted");
    insertCollection(db, "deleted_group", ["child_first", "child_second"]);
    await server.deleteClip(member, "deleted", true);
    await server.deleteCollection(member, "deleted_group", true);
    const routes = [
      { route: await import("../app/api/cliproom/clips/[id]/route.ts"), id: "deleted" },
      { route: await import("../app/api/cliproom/collections/[id]/route.ts"), id: "deleted_group" },
    ];
    const request = (authenticated: boolean) => new Request("http://localhost/api/cliproom/test", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json", Origin: "http://localhost", "X-ClipRoom-Mutation": "1",
        ...(authenticated ? { Cookie: "cliproom_session=retention-test-session" } : {}),
      },
      body: JSON.stringify({ action: "permanent-delete" }),
    });
    for (const { route, id } of routes) {
      assert.equal((await route.PATCH(request(false), { params: { id } })).status, 401);
      assert.equal((await route.PATCH(request(true), { params: { id } })).status, 403);
    }
    const admin = { ...member, role: "Admin" } as const;
    await assert.rejects(server.permanentlyDeleteClip(admin, "active", true), { status: 404 });
    await assert.rejects(server.permanentlyDeleteClip(admin, "child_first", true), { status: 404 });
    db.prepare("UPDATE members SET role = 'Admin' WHERE id = ?").run(member.id);
    for (const { route, id } of routes) {
      const response = await route.PATCH(request(true), { params: { id } });
      assert.equal(response.status, 200);
      const patch = await response.json() as import("../lib/cliproom/shared.ts").RoomMutation;
      assert.equal(patch.kind, "mutation");
      assert.deepEqual(patch.clips, []);
      assert.deepEqual(patch.collections, []);
      assert.ok([...patch.removedClipIds, ...patch.removedCollectionIds].includes(id));
      assert.equal((await route.PATCH(request(true), { params: { id } })).status, 404);
    }
    assert.deepEqual(db.prepare("SELECT id FROM clips").all().map((row) => row.id), ["active"]);
    assert.equal(db.prepare("SELECT count(*) AS count FROM collections").get()?.count, 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM collection_clips").get()?.count, 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sessions").get()?.count, 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});

test("full room reads batch the queue, settings and admin members without duplicate trash scans", async () => {
  const { db, server, hooks } = await fixture();
  try {
    insertClip(db, "clip");
    await server.ensureDatabase();
    db.prepare("UPDATE members SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), member.id);
    hooks.batches = [];
    hooks.executed = [];
    const state = await server.getRoomState({ ...member, role: "Admin" });
    assert.equal(state.memberCount, 1);
    assert.equal(state.onlineMemberCount, 1);
    assert.equal(state.members.length, 1);
    assert.equal(hooks.batches.length, 2, "one retention transaction and one consistent room-read transaction");
    assert.equal(hooks.batches[1].length, 6);
    assert.ok(hooks.batches[1].every((sql) => sql.startsWith("SELECT")));
    assert.equal(hooks.executed.length, 12);
  } finally { db.close(); }
});
