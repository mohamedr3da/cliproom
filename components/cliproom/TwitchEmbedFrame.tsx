"use client";
/* eslint-disable @next/next/no-img-element */

import { Clapperboard, ExternalLink, LoaderCircle, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useClipPreviews } from "./ClipPreviewProvider";

type Props = { clipId: string; platform: "Twitch" | "Kick"; src: string; title: string; url: string };

function syncIframeSize(container: HTMLDivElement, iframe: HTMLIFrameElement, width?: number, height?: number) {
  const rect = width && height ? { width, height } : container.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.round(rect.width));
  const nextHeight = Math.max(1, Math.round(rect.height));
  if (iframe.getAttribute("width") !== String(nextWidth)) iframe.setAttribute("width", String(nextWidth));
  if (iframe.getAttribute("height") !== String(nextHeight)) iframe.setAttribute("height", String(nextHeight));
}
export function TwitchEmbedFrame(props: Props) {
  return <TwitchEmbedSurface key={props.src} {...props} />;
}
function TwitchEmbedSurface({ clipId, platform, src, title, url }: Props) {
  const { thumbnails, activeClipId, setActiveClipId } = useClipPreviews();
  const active = activeClipId === clipId;
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [failedImage, setFailedImage] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const thumbnail = thumbnails[clipId];
  useEffect(() => {
    if (!active || loaded) return;
    const timer = window.setTimeout(() => setSlow(true), 12000);
    return () => window.clearTimeout(timer);
  }, [active, loaded, attempt]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    const iframe = iframeRef.current;
    if (!container || !iframe) return;

    let frame = 0;
    const resize = (width?: number, height?: number) => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => syncIframeSize(container, iframe, width, height));
    };

    resize();
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      resize(entry?.contentRect.width, entry?.contentRect.height);
    });
    observer.observe(container);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [active, attempt]);
  function play() { setLoaded(false); setSlow(false); setAttempt((value) => value + 1); setActiveClipId(clipId); }
  return <div ref={containerRef} className="relative aspect-video overflow-hidden bg-[#101014]">
    {active ? <>
      <iframe ref={iframeRef} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen className={`absolute inset-0 h-full w-full bg-[#101014] transition-opacity duration-150 ${loaded ? "opacity-100" : "opacity-0"}`} key={attempt} loading="eager" onLoad={() => { setLoaded(true); if (containerRef.current && iframeRef.current) syncIframeSize(containerRef.current, iframeRef.current); }} src={src.replace("autoplay=false", "autoplay=true")} title={title} />
      {!loaded ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#101014] px-5 text-center" role="status">
        <LoaderCircle aria-hidden="true" className="animate-spin text-[#b68aff] motion-reduce:animate-none" size={28} />
        <p className="text-xs font-semibold text-white/65">{slow ? `${platform} is taking longer than usual` : `Opening ${platform} player…`}</p>
        {slow ? <div className="flex items-center gap-4 text-xs"><button className="text-[#cdb5ff]" onClick={play} type="button">Try again</button><a className="text-white/60 underline" href={url} rel="noreferrer" target="_blank">Open on {platform}</a></div> : null}
      </div> : null}
      <button aria-label={`Close player for ${title}`} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md border border-white/15 bg-black/80 text-white/75 hover:bg-[#9146ff] hover:text-white" onClick={() => setActiveClipId(null)} title="Close player" type="button"><X size={14} /></button>
    </> : <button aria-label={`Play ${title}`} className="group/player absolute inset-0 w-full overflow-hidden text-left" onClick={play} type="button">
      {thumbnail && !failedImage ? <img alt="" className="absolute inset-0 h-full w-full object-cover" decoding="async" loading="lazy" onError={() => setFailedImage(true)} referrerPolicy="no-referrer" src={thumbnail} /> : <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_25%,rgba(145,70,255,0.2),transparent_75%)]"><Clapperboard aria-hidden="true" className="absolute left-5 top-5 text-[#c5a4ff]/35" size={24} /></div>}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/10" />
      <span className="absolute inset-0 grid place-items-center"><span className="grid h-14 w-14 place-items-center rounded-full border border-white/25 bg-black/55 text-white shadow-lg backdrop-blur-sm transition group-hover/player:scale-105 group-hover/player:border-[#b68aff] group-hover/player:bg-[#9146ff] motion-reduce:transform-none"><Play aria-hidden="true" className="ml-1" fill="currentColor" size={23} /></span></span>
      <span className="absolute bottom-4 right-4 text-[10px] font-bold uppercase tracking-wider text-white/55">{platform}</span>
    </button>}
  </div>;
}
export function ExternalClipPreview({ title, url, platform }: { title: string; url: string; platform: string }) {
  return <a aria-label={`Watch ${title} on ${platform}`} className="relative flex aspect-video flex-col items-center justify-center gap-3 bg-[radial-gradient(ellipse_at_50%_25%,rgba(83,252,24,0.09),transparent_75%)] px-5 text-center" href={url} rel="noreferrer" target="_blank"><span className="grid h-14 w-14 place-items-center rounded-full border border-[#53fc18]/25 bg-[#53fc18]/10 text-[#b0ff94]"><ExternalLink size={23} /></span><span className="text-sm font-bold text-white">Watch on {platform}</span><span className="text-xs text-white/40">Opens the clip in a new tab</span></a>;
}
