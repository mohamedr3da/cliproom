import type {
  CategoryFilter,
  Clip,
  ClipStatus,
  Collection,
  RoomState,
} from "./shared.ts";
import { categories } from "./shared.ts";

export type QueueTask =
  | { kind: "clip"; clip: Clip }
  | { kind: "collection"; collection: Collection };

export type QueueViewOptions = {
  priority: "all" | "priority" | "normal";
  assignment: "all" | "unclaimed" | "claimed" | "mine";
  status: "all" | ClipStatus;
  kind: "all" | "clip" | "collection";
  sort: "queue" | "newest" | "oldest";
};

export const defaultQueueViewOptions: QueueViewOptions = {
  priority: "all",
  assignment: "all",
  status: "all",
  kind: "all",
  sort: "queue",
};

export type QueueCounts = Record<CategoryFilter | "posted", number> & {
  priority: number;
  active: number;
  claimed: number;
};

const statusOrder = {
  New: 0,
  Prioritised: 1,
  Claimed: 2,
  Editing: 3,
  Posted: 4,
} as const;

export function getQueueTasks(
  state: Pick<RoomState, "clips" | "collections">,
): QueueTask[] {
  return sortQueueTasks([
    ...state.clips.map((clip): QueueTask => ({ kind: "clip", clip })),
    ...state.collections.map(
      (collection): QueueTask => ({ kind: "collection", collection }),
    ),
  ], "queue");
}

export function sortQueueTasks(
  tasks: readonly QueueTask[],
  sort: QueueViewOptions["sort"],
): QueueTask[] {
  return [...tasks].sort((left, right) => {
    const leftTask = left.kind === "clip" ? left.clip : left.collection;
    const rightTask = right.kind === "clip" ? right.clip : right.collection;
    if (sort !== "queue") {
      const dateDifference = Date.parse(leftTask.createdAt) - Date.parse(rightTask.createdAt);
      return sort === "oldest" ? dateDifference : -dateDifference;
    }
    if (leftTask.priority !== rightTask.priority) return leftTask.priority ? -1 : 1;
    const statusDifference = statusOrder[leftTask.status] - statusOrder[rightTask.status];
    if (statusDifference) return statusDifference;
    return rightTask.createdAt.localeCompare(leftTask.createdAt);
  });
}

export function taskMatchesOptions(
  task: QueueTask,
  options: QueueViewOptions,
  username: string,
) {
  const taskValue = task.kind === "clip" ? task.clip : task.collection;
  if (options.priority === "priority" && !taskValue.priority) return false;
  if (options.priority === "normal" && taskValue.priority) return false;
  if (options.assignment === "unclaimed" && taskValue.assignee !== "Unclaimed") return false;
  if (options.assignment === "claimed" && taskValue.assignee === "Unclaimed") return false;
  if (options.assignment === "mine" && taskValue.assignee !== username) return false;
  if (options.status !== "all" && taskValue.status !== options.status) return false;
  if (options.kind !== "all" && task.kind !== options.kind) return false;
  return true;
}

export function taskMatchesFilter(task: QueueTask, filter: CategoryFilter, username = "") {
  const taskValue = task.kind === "clip" ? task.clip : task.collection;
  if (filter === "mine") return Boolean(username) && taskValue.assignee === username;

  if (task.kind === "clip") {
    if (filter === "all") return task.clip.intakeSource !== "trusted_sync";
    if (filter === "trusted") return task.clip.intakeSource === "trusted_sync";
    return task.clip.intakeSource === "manual" && task.clip.category === filter;
  }

  if (filter === "all") {
    return !task.collection.clips.some(
      (clip) => clip.intakeSource === "trusted_sync",
    );
  }

  if (filter === "trusted") {
    return task.collection.clips.some(
      (clip) => clip.intakeSource === "trusted_sync",
    );
  }
  return task.collection.category === filter;
}

function taskSearchValues(taskValue: Clip | Collection) {
  return [
    taskValue.title,
    taskValue.notes,
    taskValue.assignee,
    taskValue.status,
    categories.find((category) => category.id === taskValue.category)?.label.replace(/\//g, " ") ?? "",
    ...("twitchCreatorLogin" in taskValue
      ? [taskValue.twitchCreatorLogin ?? ""]
      : []),
  ];
}

export function taskMatchesQuery(task: QueueTask, query: string) {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return true;

  const taskValue = task.kind === "clip" ? task.clip : task.collection;
  const searchText = [
    ...taskSearchValues(taskValue),
    ...(task.kind === "collection"
      ? task.collection.clips.flatMap(taskSearchValues)
      : []),
  ]
    .join(" ")
    .toLowerCase();

  return cleanQuery.split(/\s+/).every((keyword) => searchText.includes(keyword));
}

export function getQueueCounts(tasks: QueueTask[], username = ""): QueueCounts {
  const countFilter = (filter: CategoryFilter) =>
    tasks.filter((task) => taskMatchesFilter(task, filter, username)).length;
  const taskValue = (task: QueueTask) =>
    task.kind === "clip" ? task.clip : task.collection;

  return {
    all: countFilter("all"),
    mine: countFilter("mine"),
    trusted: countFilter("trusted"),
    social: countFilter("social"),
    news: countFilter("news"),
    gameplay: countFilter("gameplay"),
    other: countFilter("other"),
    posted: tasks.filter((task) => taskValue(task).status === "Posted").length,
    priority: tasks.filter((task) => taskValue(task).priority).length,
    active: tasks.filter((task) => taskValue(task).status !== "Posted").length,
    claimed: tasks.filter((task) => taskValue(task).assignee !== "Unclaimed").length,
  };
}


export type TaskLinkTarget = { kind: "clip" | "collection"; id: string };

export function taskLinkValue(kind: TaskLinkTarget["kind"], id: string) {
  return `${kind}:${id}`;
}

export function parseTaskLinkTarget(value: string | null): TaskLinkTarget | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1).trim();
  if ((kind !== "clip" && kind !== "collection") || !id) return null;
  return { kind, id };
}

export function taskDomId(kind: TaskLinkTarget["kind"], id: string) {
  return `cliproom-task-${kind}-${encodeURIComponent(id)}`;
}

export function buildTaskLink(
  origin: string,
  pathname: string,
  kind: TaskLinkTarget["kind"],
  id: string,
) {
  const url = new URL(pathname || "/", origin);
  url.searchParams.set("task", taskLinkValue(kind, id));
  return url.toString();
}
