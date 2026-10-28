"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CustomerVideo = { id: string; kind: string; url: string; duration_s: number | null; taken_at: string };

const LABELS: Record<string, string> = { video: "Walk-around video", video_exterior: "Exterior video", video_interior: "Interior video" };
/** A signed address lives an hour; after this long the player asks for a fresh one before playing. */
const STALE_MS = 40 * 60 * 1000;
/** The checks slow down: 8 s at first, then 15, 30 and 60 s; after 20 minutes a button asks the customer to tap. */
const pollGap = (n: number) => (n < 5 ? 8000 : n < 10 ? 15000 : n < 20 ? 30000 : 60000);
const POLL_FOR_MS = 20 * 60 * 1000;

type Feed = { videos: CustomerVideo[]; expected: string[]; complete: boolean; signedAt: number };

/**
 * The customer's check-in videos. A video still on its way shows its slot with "Video getting ready…" and becomes
 * the player by itself when it arrives (the page asks every few seconds, for up to two hours). Every player gets a
 * fresh address when Play is tapped on a page left open for a while, plays inline and muted with the controls to
 * unmute, and a video that will not load says "Couldn't load the video. Tap to try again." Never an empty player.
 */
export function CustomerVideos({ token, initial, expected, complete, signedAt }: { token: string; initial: CustomerVideo[]; expected: string[]; complete: boolean; /** When the page signed the addresses (the server's clock, read once). */ signedAt: number }) {
  const [feed, setFeed] = useState<Feed>({ videos: initial, expected, complete, signedAt });
  const started = useRef(signedAt);

  const refresh = useCallback(async (): Promise<Feed | null> => {
    try {
      const res = await fetch(`/api/customer/media?t=${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as Feed;
      const next = { ...data, signedAt: Date.now() };
      setFeed(next);
      return next;
    } catch {
      return null;
    }
  }, [token]);

  // While a video is still missing, ask again (more slowly over time, never while the page is hidden); also when the
  // page comes back to the front, if something is still missing or the addresses are old.
  const polls = useRef(0);
  const [gaveUp, setGaveUp] = useState(false);
  const feedRef = useRef(feed);
  useEffect(() => { feedRef.current = feed; }, [feed]);
  useEffect(() => {
    if (feed.complete || gaveUp) return;
    const t = setTimeout(() => {
      if (Date.now() - started.current > POLL_FOR_MS) { setGaveUp(true); return; }
      if (document.visibilityState === "hidden") return;
      polls.current++;
      void refresh();
    }, pollGap(polls.current));
    return () => clearTimeout(t);
  }, [feed, refresh, gaveUp]);
  useEffect(() => {
    const on = () => {
      const f = feedRef.current;
      if (document.visibilityState === "visible" && (!f.complete || Date.now() - f.signedAt > STALE_MS)) void refresh();
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [refresh]);
  const checkAgain = () => {
    started.current = Date.now();
    polls.current = 0;
    setGaveUp(false);
    void refresh();
  };

  // The newest file of each expected kind.
  const byKind = new Map<string, CustomerVideo>();
  for (const v of [...feed.videos].sort((a, b) => (a.taken_at < b.taken_at ? -1 : 1))) byKind.set(v.kind, v);
  const kinds = feed.expected.length ? feed.expected : Array.from(byKind.keys());
  const extra = feed.videos.filter((v) => !kinds.includes(v.kind));

  return (
    <div className="grid grid-cols-1 gap-4" data-customer-videos>
      {gaveUp && !feed.complete ? (
        <button type="button" onClick={checkAgain} className="min-h-11 rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-videos-check-again>
          A video is still on its way – tap to check again
        </button>
      ) : null}
      {kinds.map((kind) => {
        const v = byKind.get(kind);
        return (
          <figure key={kind} className="flex flex-col gap-1" data-video-slot={kind} data-video-state={v ? "ready" : "waiting"}>
            {v ? (
              <VideoPlayer video={v} signedAt={feed.signedAt} freshen={async () => (await refresh())?.videos.find((x) => x.kind === kind)?.url ?? null} />
            ) : (
              <div className="aspect-video w-full rounded-card bg-chip flex flex-col items-center justify-center gap-1 text-center px-4">
                <span className="text-sm font-bold">Video getting ready…</span>
                <span className="text-xs text-[#5F6368]">It will appear here by itself. No need to refresh.</span>
              </div>
            )}
            <figcaption className="text-xs font-semibold">
              {LABELS[kind] ?? "Video"}
              {v?.duration_s ? ` · ${v.duration_s}s` : ""}
            </figcaption>
          </figure>
        );
      })}
      {extra.map((v) => (
        <figure key={v.id} className="flex flex-col gap-1" data-video-slot={v.kind} data-video-state="ready">
          <VideoPlayer video={v} signedAt={feed.signedAt} freshen={async () => (await refresh())?.videos.find((x) => x.id === v.id)?.url ?? null} />
          <figcaption className="text-xs font-semibold">{LABELS[v.kind] ?? "Video"}{v.duration_s ? ` · ${v.duration_s}s` : ""}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/**
 * The ONE customer video player (check-in videos on the approval page, inspection videos on the report link): a
 * poster with a Play button first; the address is renewed when it is old; errors show a message with a retry.
 * `poster` is a stored picture of the video; without it a frame is drawn from the video itself.
 */
export function VideoPlayer({ video, signedAt, freshen, poster: storedPoster = null }: { video: Pick<CustomerVideo, "id" | "url">; signedAt: number; freshen: () => Promise<string | null>; poster?: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState(video.url);
  const [signed, setSigned] = useState(signedAt);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<number>(0);
  const [poster, setPoster] = useState<string | null>(storedPoster);

  // A new address from the feed (after a refresh) replaces the old one while the video is not playing.
  const [seenUrl, setSeenUrl] = useState(video.url);
  if (seenUrl !== video.url) {
    setSeenUrl(video.url);
    if (!playing) {
      setSrc(video.url);
      setSigned(signedAt);
    }
  }

  // A real frame as the poster, drawn half a second in (when the browser lets the page read the pixels).
  useEffect(() => {
    if (storedPoster) return;
    let cancelled = false;
    const probe = document.createElement("video");
    probe.crossOrigin = "anonymous";
    probe.muted = true;
    probe.playsInline = true;
    probe.preload = "metadata";
    probe.src = src;
    const onLoaded = () => {
      try {
        probe.currentTime = Math.min(0.5, Math.max(0, (probe.duration || 1) / 10));
      } catch {
        // ignore
      }
    };
    const onSeeked = () => {
      if (cancelled || !probe.videoWidth) return;
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 640 / probe.videoWidth);
      canvas.width = Math.round(probe.videoWidth * scale);
      canvas.height = Math.round(probe.videoHeight * scale);
      try {
        canvas.getContext("2d")?.drawImage(probe, 0, 0, canvas.width, canvas.height);
        setPoster(canvas.toDataURL("image/jpeg", 0.8));
      } catch {
        // Without CORS the browser's own frame stays.
      }
      probe.removeAttribute("src");
      probe.load();
    };
    probe.addEventListener("loadedmetadata", onLoaded);
    probe.addEventListener("seeked", onSeeked);
    return () => {
      cancelled = true;
      probe.removeEventListener("loadedmetadata", onLoaded);
      probe.removeEventListener("seeked", onSeeked);
      probe.removeAttribute("src");
    };
    // The poster is drawn once per file, not again for every renewed address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);

  async function start() {
    const el = ref.current;
    if (!el) return;
    setLoading(true);
    let url = src;
    // An address older than forty minutes, or one that failed: ask for a fresh one before playing.
    if (Date.now() - signed > STALE_MS || failed > 0) {
      const fresh = await freshen();
      if (fresh) {
        url = fresh;
        setSrc(fresh);
        setSigned(Date.now());
      }
    }
    if (el.src !== url) {
      el.src = url;
      el.load();
    }
    try {
      await el.play();
      setFailed(0);
      setPlaying(true);
    } catch (err) {
      // A paused player with controls still lets the customer try; a real load error arrives through onError.
      if (!(err instanceof DOMException && err.name === "NotAllowedError")) setFailed((f) => f + 1);
      else setPlaying(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative w-full aspect-video rounded-card overflow-hidden bg-black" data-player>
      <video
        ref={ref}
        src={src}
        poster={poster ?? undefined}
        controls={playing}
        playsInline
        muted
        preload="metadata"
        className="h-full w-full"
        onError={() => { setFailed((f) => f + 1); setPlaying(false); }}
        onPlaying={() => setPlaying(true)}
      />
      {!playing ? (
        <button type="button" onClick={start} className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/30 text-white" aria-label={failed ? "Couldn't load the video. Tap to try again" : "Play the video"} data-play>
          {failed ? (
            <>
              <span className="rounded-card bg-white/95 px-3 py-2 text-sm font-bold text-ink">Couldn&apos;t load the video. Tap to try again.</span>
              {failed > 1 ? <span className="text-xs text-white/90">This video format may not play on this phone.</span> : null}
            </>
          ) : (
            <>
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-ink text-2xl font-bold pl-1">{loading ? "…" : "▶"}</span>
              <span className="text-xs font-semibold">{loading ? "Loading…" : "Tap to play"}</span>
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
