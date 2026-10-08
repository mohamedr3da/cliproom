import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultQueueViewOptions,
  getQueueCounts,
  getQueueTasks,
  sortQueueTasks,
  taskMatchesFilter,
  taskMatchesOptions,
  taskMatchesQuery,
} from "../lib/cliproom/task-helpers.ts";
import type { QueueTask, QueueViewOptions } from "../lib/cliproom/task-helpers.ts";
import type { Clip, Collection, RoomState } from "../lib/cliproom/shared.ts";

const baseClip = (overrides: Partial<Clip> = {}): Clip => ({
  id: "clip_one",
  url: "https://clips.twitch.tv/StandaloneSlug",
  title: "Standalone play",
  category: "gameplay",
  intakeSource: "manual",
  twitchCreatorLogin: null,
  status: "New",
  priority: false,
  saved: false,
  assignee: "Unclaimed",
  notes: "solo note",
  createdBy: null,
  createdAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:00:00.000Z",
  claimedAt: null,
  postedAt: null,
  ...overrides,
});

const collection: Collection = {
  id: "collection_one",
  title: "Launch montage",
  category: "social",
  status: "Posted",
  priority: true,
  saved: false,
  assignee: "editor",
  notes: "Use the reaction near the end",
  createdBy: null,
  createdAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:00:00.000Z",
  claimedAt: "2026-09-04T00:10:00.000Z",
  postedAt: "2026-09-04T00:20:00.000Z",
  clips: [
    baseClip({
      id: "clip_two",
      url: "https://clips.twitch.tv/TrustedChildSlug",
      title: "Huge trusted reaction",
      intakeSource: "trusted_sync",
      twitchCreatorLogin: "trustededitor",
    }),
    baseClip({
      id: "clip_three",
      url: "https://clips.twitch.tv/SecondChildSlug",
      title: "Follow-up angle",
      category: "other",
    }),
  ],
};

const roomState = {
  clips: [baseClip()],
  collections: [collection],
} as Pick<RoomState, "clips" | "collections">;

test("a collection counts as one queue task regardless of child clip count", () => {
  const tasks = getQueueTasks(roomState);
  assert.equal(tasks.length, 2);

  const counts = getQueueCounts(tasks);
  assert.equal(counts.all, 1);
  assert.equal(counts.priority, 1);
  assert.equal(counts.posted, 1);
  assert.equal(counts.active, 1);
  assert.equal(counts.saved, 0);
});

test("collection search includes child titles without matching child URLs", () => {
  const task = getQueueTasks(roomState).find((item) => item.kind === "collection");
  assert.ok(task);
  assert.equal(taskMatchesQuery(task, "trusted reaction"), true);
  assert.equal(taskMatchesQuery(task, "TrustedChildSlug"), false);
  assert.equal(taskMatchesQuery(task, "SecondChildSlug"), false);
  assert.equal(taskMatchesQuery(task, "missing phrase"), false);
});

test("search matches every keyword across separate clip fields in any order", () => {
  const task: QueueTask = {
    kind: "clip",
    clip: baseClip({
      title: "Final round comeback",
      notes: "Keep the crowd reaction",
      assignee: "morgan",
      status: "Editing",
      twitchCreatorLogin: "highlightmaker",
    }),
  };

  assert.equal(
    taskMatchesQuery(task, "comeback reaction highlightmaker gameplay"),
    true,
  );
  assert.equal(taskMatchesQuery(task, "comeback round final"), true);
});

test("search ignores keyword casing and repeated whitespace", () => {
  const task: QueueTask = { kind: "clip", clip: baseClip() };

  assert.equal(taskMatchesQuery(task, "  NOTE\t\nStAnDaLoNe   GAMEPLAY  "), true);
  assert.equal(taskMatchesQuery(task, " \t\n "), true);
});

test("search rejects a task when any keyword is missing", () => {
  const task: QueueTask = { kind: "clip", clip: baseClip() };

  assert.equal(taskMatchesQuery(task, "Standalone missing gameplay"), false);
});

test("search excludes clip URLs and internal intake sources", () => {
  const task: QueueTask = { kind: "clip", clip: baseClip() };
  const trustedTask: QueueTask = {
    kind: "collection",
    collection,
  };

  for (const query of ["https", "clips.twitch.tv", "StandaloneSlug", "manual", "/"]) {
    assert.equal(taskMatchesQuery(task, query), false, query);
  }
  assert.equal(taskMatchesQuery(trustedTask, "trusted_sync"), false);
  assert.equal(taskMatchesQuery(trustedTask, "trustededitor"), true);
});

test("search includes category display labels", () => {
  const newsTask: QueueTask = { kind: "clip", clip: baseClip({ category: "news" }) };
  const gameplayTask: QueueTask = { kind: "clip", clip: baseClip() };

  assert.equal(taskMatchesQuery(newsTask, "X News"), true);
  assert.equal(taskMatchesQuery(newsTask, "news x"), true);
  assert.equal(taskMatchesQuery(gameplayTask, "X News"), false);
  assert.equal(taskMatchesQuery(newsTask, "/"), false);
});

test("collection keywords can match parent fields and fields from different children", () => {
  const task: QueueTask = {
    kind: "collection",
    collection: {
      ...collection,
      clips: [
        baseClip({
          title: "Opening interview",
          notes: "Caption the announcement",
          assignee: "jamie",
          status: "Editing",
          category: "news",
          twitchCreatorLogin: "firstcreator",
        }),
        baseClip({ title: "Closing speech", url: "https://clips.twitch.tv/FinalInterviewSlug" }),
      ],
    },
  };

  assert.equal(
    taskMatchesQuery(task, "montage interview announcement X News firstcreator closing"),
    true,
  );
  assert.equal(taskMatchesQuery(task, "montage firstcreator absent"), false);
  assert.equal(taskMatchesQuery(task, "FinalInterviewSlug"), false);
});

test("trusted filter includes collections with at least one trusted-sync child", () => {
  const task = getQueueTasks(roomState).find((item) => item.kind === "collection");
  assert.ok(task);
  assert.equal(taskMatchesFilter(task, "trusted"), true);
  assert.equal(taskMatchesFilter(task, "social"), true);
  assert.equal(taskMatchesFilter(task, "gameplay"), false);
});

test("All clips excludes trusted-source tasks so they stay in their own lane", () => {
  const trustedClip = baseClip({
    id: "clip_trusted",
    intakeSource: "trusted_sync",
    twitchCreatorLogin: "trustededitor",
  });
  const trustedCollection: Collection = {
    ...collection,
    id: "collection_trusted",
    clips: [trustedClip],
  };

  assert.equal(taskMatchesFilter({ kind: "clip", clip: trustedClip }, "all"), false);
  assert.equal(
    taskMatchesFilter({ kind: "collection", collection: trustedCollection }, "all"),
    false,
  );
  assert.equal(taskMatchesFilter({ kind: "clip", clip: baseClip() }, "all"), true);
});

test("unified queue preserves the original workflow status ordering", () => {
  const newerPosted: Collection = {
    ...collection,
    id: "collection_posted",
    priority: false,
    createdAt: "2026-09-04T02:00:00.000Z",
  };
  const olderNew = baseClip({
    id: "clip_new",
    status: "New",
    createdAt: "2026-09-04T01:00:00.000Z",
  });

  const tasks = getQueueTasks({ clips: [olderNew], collections: [newerPosted] });
  assert.equal(tasks[0]?.kind, "clip");
  assert.equal(tasks[1]?.kind, "collection");
});

const filterTasks: QueueTask[] = [
  { kind: "clip", clip: baseClip({ id: "new_unclaimed" }) },
  {
    kind: "clip",
    clip: baseClip({ id: "my_edit", priority: true, status: "Editing", assignee: "editor" }),
  },
  {
    kind: "clip",
    clip: baseClip({ id: "other_claim", status: "Claimed", assignee: "jamie" }),
  },
  { kind: "collection", collection },
  {
    kind: "collection",
    collection: {
      ...collection,
      id: "priority_unclaimed",
      status: "Prioritised",
      assignee: "Unclaimed",
      clips: [baseClip({ status: "Editing", assignee: "editor" })],
    },
  },
];

const taskId = (task: QueueTask) => task.kind === "clip" ? task.clip.id : task.collection.id;

test("queue options filter task-level priority and kind together", () => {
  const cases: { options: Partial<QueueViewOptions>; ids: string[] }[] = [
    { options: {}, ids: ["new_unclaimed", "my_edit", "other_claim", "collection_one", "priority_unclaimed"] },
    { options: { priority: "priority" }, ids: ["my_edit", "collection_one", "priority_unclaimed"] },
    { options: { priority: "normal" }, ids: ["new_unclaimed", "other_claim"] },
    { options: { kind: "clip" }, ids: ["new_unclaimed", "my_edit", "other_claim"] },
    { options: { kind: "collection" }, ids: ["collection_one", "priority_unclaimed"] },
    {
      options: { priority: "priority", kind: "clip" },
      ids: ["my_edit"],
    },
    { options: { priority: "normal", kind: "collection" }, ids: [] },
  ];

  for (const { options, ids } of cases) {
    const matches = filterTasks.filter((task) => taskMatchesOptions(
      task,
      { ...defaultQueueViewOptions, ...options },
      "editor",
    ));
    assert.deepEqual(matches.map(taskId), ids, JSON.stringify(options));
  }
});

test("queue options narrow the selected category or sync lane", () => {
  const options: QueueViewOptions = {
    ...defaultQueueViewOptions,
    priority: "priority",
  };
  const inLane = (lane: "all" | "trusted" | "social") => filterTasks.filter((task) =>
    taskMatchesFilter(task, lane) && taskMatchesOptions(task, options, "editor")
  ).map(taskId);

  assert.deepEqual(inLane("all"), ["my_edit", "priority_unclaimed"]);
  assert.deepEqual(inLane("trusted"), ["collection_one"]);
  assert.deepEqual(inLane("social"), ["collection_one", "priority_unclaimed"]);
});

test("date sorting ignores priority and workflow status without mutating the input", () => {
  const tasks: QueueTask[] = [
    {
      kind: "clip",
      clip: baseClip({ id: "middle", status: "New", createdAt: "2026-09-04T10:00:00Z" }),
    },
    {
      kind: "collection",
      collection: { ...collection, id: "oldest_priority", createdAt: "2026-09-04T09:00:00Z" },
    },
    {
      kind: "clip",
      clip: baseClip({ id: "newest_edit", status: "Editing", createdAt: "2026-09-04T08:00:00-03:00" }),
    },
    {
      kind: "clip",
      clip: baseClip({ id: "newer_new", status: "New", createdAt: "2026-09-04T10:30:00Z" }),
    },
  ];

  assert.deepEqual(
    sortQueueTasks(tasks, "newest").map(taskId),
    ["newest_edit", "newer_new", "middle", "oldest_priority"],
  );
  assert.deepEqual(
    sortQueueTasks(tasks, "oldest").map(taskId),
    ["oldest_priority", "middle", "newer_new", "newest_edit"],
  );
  assert.deepEqual(
    sortQueueTasks(tasks, defaultQueueViewOptions.sort).map(taskId),
    ["oldest_priority", "newer_new", "middle", "newest_edit"],
  );
  assert.deepEqual(tasks.map(taskId), ["middle", "oldest_priority", "newest_edit", "newer_new"]);
});
