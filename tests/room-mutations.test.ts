import assert from "node:assert/strict";
import test from "node:test";
import type { Clip, Collection, RoomMutation, RoomState } from "../lib/cliproom/shared.ts";
import { applyRoomMutation } from "../lib/cliproom/room-mutations.ts";

const clip = (id: string, changes: Partial<Clip> = {}): Clip => ({ id, title: id, url: `https://clips.twitch.tv/${id}`, category: "social", intakeSource: "manual", twitchCreatorLogin: null, status: "New", priority: false, assignee: "Unclaimed", notes: "", createdBy: null, createdAt: "2026-09-05T00:00:00Z", updatedAt: "2026-09-05T00:00:00Z", claimedAt: null, postedAt: null, ...changes });
const base: RoomState = { member: { id: "editor", username: "editor", displayName: "Editor", avatarUrl: null, role: "Admin" }, clips: [clip("a"), clip("b")], collections: [], members: [], sourceChannel: "channel", trustedClipperLogins: ["trusted"], memberCount: 1, onlineMemberCount: 1, maxMembers: 20, twitchSyncAvailable: true };
const patch = (changes: Partial<RoomMutation>): RoomMutation => ({ kind: "mutation", clips: [], collections: [], removedClipIds: [], removedCollectionIds: [], ...changes });

test("independent task patches preserve each other and room settings", () => {
  let state = applyRoomMutation(base, patch({ clips: [clip("a", { title: "New title" })] }));
  state = applyRoomMutation(state, patch({ clips: [clip("b", { priority: true })] }));
  assert.equal(state.clips.find((item) => item.id === "a")?.title, "New title");
  assert.equal(state.clips.find((item) => item.id === "b")?.priority, true);
  assert.equal(state.members, base.members);
  assert.equal(state.trustedClipperLogins, base.trustedClipperLogins);
});
test("delete, restore and permanent removal move only the affected task", () => {
  const deleted = clip("a", { deletedAt: "2026-09-05T12:00:00Z" });
  let state = applyRoomMutation(base, patch({ clips: [deleted] }));
  assert.deepEqual(state.clips.map((item) => item.id), ["b"]);
  assert.deepEqual(state.trash?.clips.map((item) => item.id), ["a"]);
  state = applyRoomMutation(state, patch({ clips: [clip("a")] }));
  assert.equal(state.trash?.clips.length, 0);
  assert.equal(state.clips.length, 2);
  state = applyRoomMutation(state, patch({ removedClipIds: ["a"] }));
  assert.deepEqual(state.clips.map((item) => item.id), ["b"]);
});
test("grouping and detaching preserve collection children and avoid duplicate cards", () => {
  const collection: Collection = { ...clip("group"), clips: [clip("a"), clip("c")] };
  let state = applyRoomMutation(base, patch({ collections: [collection], removedClipIds: ["a"] }));
  assert.deepEqual(state.clips.map((item) => item.id), ["b"]);
  assert.deepEqual(state.collections[0].clips.map((item) => item.id), ["a", "c"]);
  state = applyRoomMutation(state, patch({ collections: [{ ...collection, clips: [clip("c")] }], clips: [clip("a")] }));
  assert.equal(state.clips.length, 2);
  assert.deepEqual(state.collections[0].clips.map((item) => item.id), ["c"]);
});
test("a late older task response does not overwrite newer confirmed changes", () => {
  const state = applyRoomMutation({ ...base, clips: [clip("a", { title: "Latest", updatedAt: "2026-09-05T15:00:00Z" })] }, patch({ clips: [clip("a")] }));
  assert.equal(state.clips[0].title, "Latest");
});

test("late responses cannot resurrect permanently deleted or grouped standalone cards", () => {
  let state = applyRoomMutation(base, { ...patch({ removedClipIds: ["a"] }), clientSequence: 2 });
  state = applyRoomMutation({ ...state }, { ...patch({ clips: [clip("a")] }), clientSequence: 1 });
  assert.deepEqual(state.clips.map((item) => item.id), ["b"]);
  // A deliberate later restore/re-add remains valid.
  state = applyRoomMutation(state, { ...patch({ clips: [clip("a")] }), clientSequence: 3 });
  assert.equal(state.clips.length, 2);
});
