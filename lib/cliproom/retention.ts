export const postedRetentionMs = 24 * 60 * 60 * 1000;
export const deletedRetentionMs = 24 * 60 * 60 * 1000;

export type RetentionStatement = {
  sql: string;
  params: (string | number | null)[];
};

const standaloneClip = "NOT EXISTS (SELECT 1 FROM collection_clips cc WHERE cc.clip_id = clips.id)";

function cutoff(timestamp: string, age: number) {
  return new Date(Date.parse(timestamp) - age).toISOString();
}

export function buildRetentionStatements(timestamp: string): RetentionStatement[] {
  const postedCutoff = cutoff(timestamp, postedRetentionMs);
  const deletedCutoff = cutoff(timestamp, deletedRetentionMs);
  const expiredPosted = "deleted_at IS NULL AND status = 'Posted' AND julianday(posted_at) <= julianday(?)";
  return [
    {
      sql: `UPDATE clips SET deleted_at = ?, deleted_by_member_id = NULL, updated_at = ?
        WHERE id IN (SELECT cc.clip_id FROM collection_clips cc
          JOIN collections ON collections.id = cc.collection_id WHERE ${expiredPosted})`,
      params: [timestamp, timestamp, postedCutoff],
    },
    {
      sql: `UPDATE collections SET deleted_at = ?, deleted_by_member_id = NULL, updated_at = ? WHERE ${expiredPosted}`,
      params: [timestamp, timestamp, postedCutoff],
    },
    {
      sql: `UPDATE clips SET deleted_at = ?, deleted_by_member_id = NULL, updated_at = ? WHERE ${expiredPosted} AND ${standaloneClip}`,
      params: [timestamp, timestamp, postedCutoff],
    },
    {
      sql: `DELETE FROM collection_clips WHERE collection_id IN (
        SELECT id FROM collections WHERE julianday(deleted_at) <= julianday(?))`,
      params: [deletedCutoff],
    },
    {
      sql: `DELETE FROM clips WHERE julianday(deleted_at) <= julianday(?) AND ${standaloneClip}`,
      params: [deletedCutoff],
    },
    {
      sql: "DELETE FROM collections WHERE julianday(deleted_at) <= julianday(?)",
      params: [deletedCutoff],
    },
  ];
}

export function buildSoftDeleteStatements(
  kind: "clip" | "collection",
  id: string,
  timestamp: string,
  deletedByMemberId: string | null = null,
): RetentionStatement[] {
  if (kind === "clip") {
    return [{
      sql: `UPDATE clips SET deleted_at = ?, deleted_by_member_id = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL AND ${standaloneClip}`,
      params: [timestamp, deletedByMemberId, timestamp, id],
    }];
  }
  return [
    {
      sql: `UPDATE clips SET deleted_at = ?, deleted_by_member_id = ?, updated_at = ? WHERE id IN (
        SELECT cc.clip_id FROM collection_clips cc JOIN collections ON collections.id = cc.collection_id
        WHERE collections.id = ? AND collections.deleted_at IS NULL)`,
      params: [timestamp, deletedByMemberId, timestamp, id],
    },
    {
      sql: "UPDATE collections SET deleted_at = ?, deleted_by_member_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      params: [timestamp, deletedByMemberId, timestamp, id],
    },
  ];
}

export function buildRestoreStatements(
  kind: "clip" | "collection",
  id: string,
  timestamp: string,
): RetentionStatement[] {
  const deletedCutoff = cutoff(timestamp, deletedRetentionMs);
  const table = kind === "clip" ? "clips" : "collections";
  const restoreTask: RetentionStatement = {
    sql: `UPDATE ${table} SET deleted_at = NULL, deleted_by_member_id = NULL, updated_at = ?,
      status = CASE WHEN status = 'Posted' THEN 'New' ELSE status END,
      priority = CASE WHEN status = 'Posted' THEN 0 ELSE priority END,
      assignee = CASE WHEN status = 'Posted' THEN 'Unclaimed' ELSE assignee END,
      assignee_member_id = CASE WHEN status = 'Posted' THEN NULL ELSE assignee_member_id END,
      claimed_at = CASE WHEN status = 'Posted' THEN NULL ELSE claimed_at END,
      posted_at = CASE WHEN status = 'Posted' THEN NULL ELSE posted_at END
      WHERE id = ? AND julianday(deleted_at) > julianday(?)
      ${kind === "clip" ? `AND ${standaloneClip}` : ""}`,
    params: [timestamp, id, deletedCutoff],
  };
  if (kind === "clip") return [restoreTask];
  return [
    {
      sql: `UPDATE clips SET deleted_at = NULL, deleted_by_member_id = NULL, updated_at = ? WHERE id IN (
        SELECT cc.clip_id FROM collection_clips cc JOIN collections ON collections.id = cc.collection_id
        WHERE collections.id = ? AND julianday(collections.deleted_at) > julianday(?))`,
      params: [timestamp, id, deletedCutoff],
    },
    restoreTask,
  ];
}

export function buildPermanentDeleteStatements(kind: "clip" | "collection", id: string): RetentionStatement[] {
  if (kind === "clip") {
    return [{
      sql: `DELETE FROM clips WHERE id = ? AND deleted_at IS NOT NULL AND ${standaloneClip}`,
      params: [id],
    }];
  }
  // The foreign key cascades remove membership links while the parent guard
  // keeps a concurrent restoration from deleting an active collection.
  return [
    {
      sql: `DELETE FROM clips WHERE id IN (
        SELECT cc.clip_id FROM collection_clips cc
        JOIN collections ON collections.id = cc.collection_id
        WHERE collections.id = ? AND collections.deleted_at IS NOT NULL)`,
      params: [id],
    },
    {
      sql: "DELETE FROM collections WHERE id = ? AND deleted_at IS NOT NULL",
      params: [id],
    },
  ];
}
