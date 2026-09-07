import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getTwitchOAuthRedirectUri } from "../lib/cliproom/shared.ts";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Twitch OAuth uses the registered root URL without a trailing slash", () => {
  assert.equal(
    getTwitchOAuthRedirectUri(
      "https://cliproom.sevencliproom.workers.dev/api/cliproom/auth/twitch/callback",
    ),
    "https://cliproom.sevencliproom.workers.dev",
  );
});

test("root OAuth returns are forwarded to the internal callback route", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /api\/cliproom\/auth\/twitch\/callback/);
  assert.match(page, /searchParams\.has\("code"\)/);
  assert.match(page, /searchParams\.has\("state"\)/);
  assert.match(page, /window\.location\.replace/);
});

test("server builds Twitch authorisation URLs from the shared root redirect helper", async () => {
  const server = await source("lib/cliproom/server.ts");
  assert.match(server, /getTwitchOAuthRedirectUri/);
  assert.doesNotMatch(server, /origin\}\/api\/cliproom\/auth\/twitch\/callback/);
});
