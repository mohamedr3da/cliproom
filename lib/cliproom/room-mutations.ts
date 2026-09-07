import type { Clip, Collection, RoomMutation, RoomState } from "./shared.ts";

export type ClientRoomMutation = RoomMutation & { clientSequence?: number };
const requestVersions = Symbol("task request versions");
type ClientRoomState = RoomState & { [requestVersions]?: Record<string, number> };

function mergeTasks<T extends Clip | Collection>(active: T[], deleted: T[], updates: T[], removed: string[], kind: string, versions: Record<string, number>, sequence: number) {
  const tasks = new Map([...active, ...deleted].map((task) => [task.id, task]));
  removed.forEach((id) => {
    if ((versions[`${kind}:${id}`] ?? 0) > sequence) return;
    tasks.delete(id);
    versions[`${kind}:${id}`] = sequence;
  });
  for (const task of updates) {
    if ((versions[`${kind}:${task.id}`] ?? 0) > sequence) continue;
    versions[`${kind}:${task.id}`] = sequence;
    const previous = tasks.get(task.id);
    if (!previous || Date.parse(previous.updatedAt) <= Date.parse(task.updatedAt)) tasks.set(task.id, task);
  }
  const values = [...tasks.values()];
  return { active: values.filter((task) => !task.deletedAt), deleted: values.filter((task) => task.deletedAt) };
}

export function applyRoomMutation(state: ClientRoomState, mutation: ClientRoomMutation): ClientRoomState {
  const versions = { ...state[requestVersions] };
  const sequence = mutation.clientSequence ?? 0;
  const clips = mergeTasks(state.clips, state.trash?.clips ?? [], mutation.clips, mutation.removedClipIds, "clip", versions, sequence);
  const collections = mergeTasks(state.collections, state.trash?.collections ?? [], mutation.collections, mutation.removedCollectionIds, "collection", versions, sequence);
  return { ...state, [requestVersions]: versions, clips: clips.active, collections: collections.active, trash: { clips: clips.deleted, collections: collections.deleted } };
}
