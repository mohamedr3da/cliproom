import assert from "node:assert/strict";
import test from "node:test";
import type Hls from "hls.js";
import { startKickMediaSession } from "../lib/cliproom/kick-media-session.ts";

class FakeVideo extends EventTarget {
  src = "";
  error: { code: number } | null = null;
  plays: { resolve: () => void; reject: (reason: unknown) => void }[] = [];
  canPlayType() { return "maybe"; }
  play() { return new Promise<void>((resolve, reject) => this.plays.push({ resolve, reject })); }
  pause() {}
  removeAttribute() { this.src = ""; }
  load() { this.error = null; }
}

function fixture() {
  const video = new FakeVideo();
  const errors: string[] = [];
  const loading: boolean[] = [];
  class FakeHls {
    static Events = { MANIFEST_PARSED: "parsed", ERROR: "error" };
    static ErrorTypes = { MEDIA_ERROR: "mediaError" };
    static isSupported() { return true; }
    handlers = new Map<string, (...args: unknown[]) => void>();
    destroyed = false;
    recoveries = 0;
    on(event: string, handler: (...args: unknown[]) => void) { this.handlers.set(event, handler); }
    attachMedia() {}
    loadSource() { this.handlers.get("parsed")?.(); }
    destroy() { this.destroyed = true; }
    recoverMediaError() { this.recoveries++; }
    constructor() { instances.push(this); }
  }
  const instances: FakeHls[] = [];
  let finishImport!: (value: typeof Hls) => void;
  const cleanup = startKickMediaSession(video as unknown as HTMLVideoElement, "https://clips.kick.com/clip/playlist.m3u8", {
    loadHls: () => new Promise((resolve) => { finishImport = resolve; }),
    onError: (message) => errors.push(message),
    onLoading: (value) => loading.push(value),
  });
  const nativeError = () => {
    video.error = { code: 4 };
    video.dispatchEvent(new Event("error"));
  };
  const finishHls = async () => { finishImport(FakeHls as unknown as typeof Hls); await Promise.resolve(); };
  return { video, errors, loading, instances, cleanup, nativeError, finishHls };
}

test("native HLS error and rejected play promise cannot cancel the fallback player", async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  f.nativeError();
  f.video.plays[0].reject(new DOMException("No supported source", "NotSupportedError"));
  await Promise.resolve();
  await f.finishHls();
  assert.deepEqual(f.errors, []);
  assert.equal(f.instances.length, 1);
  assert.equal(f.instances[0].destroyed, false);
  f.video.dispatchEvent(new Event("canplay"));
  assert.equal(f.loading.at(-1), false);
});

test("HLS owns media error recovery even when the video error arrives first", async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  f.nativeError();
  await f.finishHls();
  f.nativeError();
  const player = f.instances[0];
  player.handlers.get("error")?.("error", { fatal: true, type: "mediaError" });
  assert.equal(player.recoveries, 1);
  assert.deepEqual(f.errors, []);
  assert.equal(player.destroyed, false);
  player.handlers.get("error")?.("error", { fatal: true, type: "mediaError" });
  assert.equal(f.errors.length, 1);
  assert.equal(player.destroyed, true);
});

test("closing during HLS import never attaches a player afterwards", async () => {
  const f = fixture();
  f.nativeError();
  f.cleanup();
  await f.finishHls();
  assert.deepEqual(f.instances, []);
  assert.deepEqual(f.errors, []);
});
