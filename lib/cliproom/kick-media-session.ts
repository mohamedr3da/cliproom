import type Hls from "hls.js";
import { isHlsMediaUrl } from "./kick-playback.ts";

type Options = {
  loadHls: () => Promise<typeof Hls>;
  onLoading: (loading: boolean) => void;
  onError: (message: string) => void;
};

export function startKickMediaSession(video: HTMLVideoElement, mediaUrl: string, { loadHls, onLoading: setLoading, onError: setError }: Options) {
  const isHls = isHlsMediaUrl(mediaUrl);
  let stopped = false;
  let usingHls = false;
  let playbackGeneration = 0;
  let recoveredMediaError = false;
  let hls: Hls | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function stopMedia() {
    hls?.destroy();
    hls = null;
    video!.pause();
    video!.removeAttribute("src");
    video!.load();
  }

  function fail(message: string) {
    if (stopped) return;
    stopped = true;
    globalThis.clearTimeout(timeout);
    stopMedia();
    setLoading(false);
    setError(message);
  }

  function ready() {
    if (stopped) return;
    globalThis.clearTimeout(timeout);
    setLoading(false);
  }

  function playVideo() {
    const generation = playbackGeneration;
    void video!.play().catch((reason: unknown) => {
      // A native play() rejection can arrive after its error event has already
      // switched to HLS. It belongs to the abandoned source, not the new player.
      if (stopped || generation !== playbackGeneration) return;
      // Autoplay restrictions leave the native controls available once ready.
      if (reason instanceof DOMException && (reason.name === "NotAllowedError" || reason.name === "AbortError")) return;
      onVideoError();
    });
  }

  async function startHls() {
    if (stopped || usingHls) return;
    usingHls = true;
    playbackGeneration++;
    setLoading(true);
    globalThis.clearTimeout(timeout);
    timeout = globalThis.setTimeout(() => fail("The clip could not finish loading. Try again to get a fresh playback link."), 15_000);
    stopMedia();
    try {
      // Native video and untouched Kick cards never download this library.
      const HlsPlayer = await loadHls();
      if (stopped) return;
      if (!HlsPlayer.isSupported()) {
        fail("This browser cannot play this clip here. You can open it on Kick.");
        return;
      }
      hls = new HlsPlayer({ enableWorker: true });
      hls.on(HlsPlayer.Events.MANIFEST_PARSED, playVideo);
      hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
        if (stopped || !data.fatal) return;
        if (data.type === HlsPlayer.ErrorTypes.MEDIA_ERROR && !recoveredMediaError) {
          recoveredMediaError = true;
          hls?.recoverMediaError();
          return;
        }
        fail("Kick could not play this clip. Try again to refresh its playback link, or open it on Kick.");
      });
      hls.attachMedia(video!);
      hls.loadSource(mediaUrl);
    } catch {
      fail("The video player could not load. Check your connection and try again.");
    }
  }

  function onVideoError() {
    if (stopped) return;
    // HLS classifies video errors and may recover from them. A parallel native
    // error listener must not destroy it before that recovery runs.
    if (usingHls) return;
    if (isHls) void startHls();
    else fail("The clip could not play. Try again to refresh its playback link, or open it on Kick.");
  }

  video.addEventListener("loadeddata", ready);
  video.addEventListener("canplay", ready);
  video.addEventListener("playing", ready);
  video.addEventListener("error", onVideoError);

  if (isHls && !video.canPlayType("application/vnd.apple.mpegurl")) {
    void startHls();
  } else {
    timeout = globalThis.setTimeout(() => {
      // Some browsers advertise native HLS support but fail on particular
      // streams. Fall back once before showing a recoverable error.
      if (isHls) void startHls();
      else fail("The clip is taking too long to load. Try again or open it on Kick.");
    }, isHls ? 8_000 : 15_000);
    video.src = mediaUrl;
    playVideo();
  }

  return () => {
    stopped = true;
    globalThis.clearTimeout(timeout);
    video.removeEventListener("loadeddata", ready);
    video.removeEventListener("canplay", ready);
    video.removeEventListener("playing", ready);
    video.removeEventListener("error", onVideoError);
    stopMedia();
  };
}
