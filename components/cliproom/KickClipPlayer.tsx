"use client";
/* eslint-disable @next/next/no-img-element */

import { Clapperboard, ExternalLink, LoaderCircle, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { requireKickPlayback, type KickPlayback } from "@/lib/cliproom/kick-playback";
import { startKickMediaSession } from "@/lib/cliproom/kick-media-session";
import { useClipPreviews } from "./ClipPreviewProvider";

type Props = { clipId: string; title: string; url: string };

// Each Play/retry gets a new session. Closing, switching cards, or retrying
// unmounts it, cancelling both the metadata request and the media pipeline.
function KickPlaybackSession({ clipId, title, url, onThumbnail, onRetry }: Props & {
  onThumbnail: (thumbnail: string | null) => void;
  onRetry: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playback, setPlayback] = useState<KickPlayback | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12_000);

    async function loadPlayback() {
      try {
        const response = await fetch("/api/cliproom/kick/clip", {
          method: "POST",
          credentials: "same-origin",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clipId }),
        });
        const data: unknown = await response.json();
        if (!response.ok) {
          const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Kick player unavailable. Try again.";
          throw new Error(message);
        }
        const next = requireKickPlayback(data);
        if (!cancelled) {
          setPlayback(next);
          onThumbnail(next.thumbnailUrl);
        }
      } catch (reason: unknown) {
        if (!cancelled) {
          setLoading(false);
          setError(timedOut ? "Kick is taking too long to respond. Try again or open the clip on Kick." : reason instanceof Error ? reason.message : "Kick player unavailable. Try again.");
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void loadPlayback();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [clipId, onThumbnail]);

  useEffect(() => {
    const video = videoRef.current;
    if (!playback || !video) return;
    return startKickMediaSession(video, playback.mediaUrl, {
      loadHls: async () => (await import("hls.js")).default,
      onLoading: setLoading,
      onError: setError,
    });
  }, [playback]);

  return (
    <>
      <video aria-label={title} ref={videoRef} className="absolute inset-0 h-full w-full bg-black object-contain" controls playsInline poster={playback?.thumbnailUrl ?? undefined} />
      {loading ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#101014]" role="status">
          <LoaderCircle aria-hidden="true" className="animate-spin text-[#53fc18] motion-reduce:animate-none" size={28} />
          <p className="text-xs font-semibold text-white/65">Opening Kick player…</p>
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#101014] px-6 text-center" role="alert">
          <p className="text-sm font-bold text-white">Kick player unavailable</p>
          <p className="max-w-sm text-xs leading-5 text-white/45">{error}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-white/70" onClick={onRetry} type="button">
              <RotateCcw aria-hidden="true" size={14} />Try again
            </button>
            <a className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#53fc18]/20 bg-[#53fc18]/8 px-3 text-xs font-semibold text-[#baff9f]" href={url} rel="noreferrer" target="_blank">
              <ExternalLink aria-hidden="true" size={14} />Open on Kick
            </a>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function KickClipPlayer({ clipId, title, url }: Props) {
  const { thumbnails, activeClipId, setActiveClipId } = useClipPreviews();
  const active = activeClipId === clipId;
  const [playbackThumbnail, setPlaybackThumbnail] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const thumbnail = playbackThumbnail ?? thumbnails[clipId];

  return (
    <div className="relative aspect-video overflow-hidden bg-[#101014]">
      {active ? (
        <>
          <KickPlaybackSession key={`${clipId}:${url}:${attempt}`} clipId={clipId} title={title} url={url} onThumbnail={setPlaybackThumbnail} onRetry={() => setAttempt((value) => value + 1)} />
          <button aria-label={`Close player for ${title}`} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md border border-white/15 bg-black/80 text-white/75 hover:bg-[#53fc18] hover:text-black" onClick={() => setActiveClipId(null)} title="Close player" type="button">
            <X aria-hidden="true" size={14} />
          </button>
        </>
      ) : (
        <button aria-label={`Play ${title}`} className="group/player absolute inset-0 w-full overflow-hidden text-left" onClick={() => setActiveClipId(clipId)} type="button">
          {thumbnail && thumbnail !== failedImage ? (
            <img alt="" className="absolute inset-0 h-full w-full object-cover" decoding="async" loading="lazy" onError={() => setFailedImage(thumbnail)} referrerPolicy="no-referrer" src={thumbnail} />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_25%,rgba(83,252,24,0.10),transparent_75%)]">
              <Clapperboard aria-hidden="true" className="absolute left-5 top-5 text-[#8fff68]/30" size={24} />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/10" />
          <span className="absolute inset-0 grid place-items-center"><span className="grid h-14 w-14 place-items-center rounded-full border border-white/25 bg-black/55 text-white shadow-lg backdrop-blur-sm transition group-hover/player:scale-105 group-hover/player:border-[#53fc18] group-hover/player:bg-[#53fc18] group-hover/player:text-black motion-reduce:transform-none"><Play aria-hidden="true" className="ml-1" fill="currentColor" size={23} /></span></span>
          <span className="absolute bottom-4 right-4 text-[10px] font-bold uppercase tracking-wider text-white/55">KICK</span>
        </button>
      )}
    </div>
  );
}
