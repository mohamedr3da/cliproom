import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { schemaStatements } from "../db/schema.ts";

const schemaText = schemaStatements.join("\n");

test("schema defines collections and unique ordered clip membership", () => {
  assert.match(schemaText, /CREATE TABLE IF NOT EXISTS collections/i);
  assert.match(schemaText, /CREATE TABLE IF NOT EXISTS collection_clips/i);
  assert.match(schemaText, /UNIQUE\s*\(clip_id\)/i);
  assert.match(schemaText, /UNIQUE\s*\(collection_id,\s*position\)/i);
  assert.match(schemaText, /idx_collection_clips_collection_position/i);
});

test("collections migration is separate from twitch auth schema version", async () => {
  const source = await readFile(new URL("../lib/cliproom/server.ts", import.meta.url), "utf8");
  assert.match(source, /currentSchemaVersion\s*=\s*"twitch-auth-v1"/);
  assert.match(source, /collectionsSchemaVersionSettingKey\s*=\s*"_cliproom_collections_schema_version"/);
  assert.match(source, /currentCollectionsSchemaVersion\s*=\s*"collections-v1"/);
  assert.match(source, /ensureCollectionsSchema/);
});
