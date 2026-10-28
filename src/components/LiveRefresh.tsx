"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { refreshWhenIdle } from "@/lib/refresh-idle";
import { FALLBACK_POLL_MS, MIN_REFRESH_GAP_MS, hiddenTracker, startLive } from "@/lib/live-connection";

type Row = Record<string, unknown>;

/**
 * Re-renders the page when rows change in the given tables (logged-in users), within seconds through
 * Supabase Realtime. Since 27 October 2026 there is NO timed re-fetch while the live connection is up:
 * the server is asked again only when something changed, when the connection comes back after a drop,
 * or every `pollMs` while it is DOWN (startLive). Invisible to the person: no reload, no flicker, no
 * scroll jump, and never while someone is typing (refreshWhenIdle). A hidden tab pauses; coming back
 * refreshes once only if something changed meanwhile or it was away five minutes. A changed row flashes
 * the matching [data-flash-id] card softly. When the connection is gone a small grey "Offline –
 * reconnecting…" chip shows; the access rules decide per person what the live feed may carry.
 *
 * Subscriptions are deliberately unfiltered on the server: Supabase Realtime did not deliver filtered
 * changes (for example `job_id=eq.<uuid>`) to this project, so the check happens here instead. With
 * `jobId` set, only changes to that job trigger a refresh. Every table given here must be in the
 * supabase_realtime publication, or the whole channel goes quiet.
 */
export function LiveRefresh({ tables, jobId, pollMs = FALLBACK_POLL_MS, alwaysPollMs, showUpdated = false }: { tables: string[]; jobId?: string; /** How often to check the server while the live connection is DOWN (never while it is up). */ pollMs?: number; /** Only for a person whose access rules hide these tables from the live feed (the page itself reads them on the server): a plain timed check while the tab is visible. */ alwaysPollMs?: number; /** A small grey "Updated just now" (the dashboard). */ showUpdated?: boolean }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [updatedWords, setUpdatedWords] = useState("");
  const [offline, setOffline] = useState(false);
  const key = tables.join(",");

  useEffect(() => {
    const supabase = createClient();
    const away = hiddenTracker();
    const refresh = () => {
      if (document.visibilityState === "hidden") {
        away.missed(); // paused: the return to the tab catches up
        return;
      }
      refreshWhenIdle(() => {
        router.refresh();
        setUpdatedAt(Date.now());
      });
    };
    // A burst of changes (Parts pricing, a technician's measurements) costs one refresh per 10 seconds at most:
    // the first change shows at once, later ones are folded into one refresh at the end of the gap.
    let lastRefresh = 0;
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      const wait = Math.max(300, lastRefresh + MIN_REFRESH_GAP_MS - Date.now());
      timer.current = setTimeout(() => {
        lastRefresh = Date.now();
        refresh();
      }, wait);
    };
    const flash = (row: Row | null | undefined) => {
      for (const id of [row?.id, row?.job_id]) {
        if (!id) continue;
        for (const el of document.querySelectorAll(`[data-flash-id="${String(id)}"]`)) {
          el.classList.remove("live-flash");
          void (el as HTMLElement).offsetWidth; // restart the animation
          el.classList.add("live-flash");
          setTimeout(() => el.classList.remove("live-flash"), 1800);
        }
      }
    };
    const matches = (row: Row | null | undefined) => !jobId || !row || row.id === jobId || row.job_id === jobId;
    const channel = supabase.channel(`live-${key}-${jobId ?? "all"}-${Math.random().toString(36).slice(2, 8)}`);
    for (const table of key.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        if (matches(payload.new as Row) || matches(payload.old as Row)) {
          flash((payload.new as Row) ?? (payload.old as Row));
          schedule();
        }
      });
    }
    // If the live connection drops and comes back, catch up at once; while it is gone, check every pollMs and say so quietly.
    const stop = startLive(supabase, channel, {
      onReconnect: schedule,
      fallback: refresh,
      fallbackMs: pollMs,
      onStatus: (live) => {
        if (live) setOffline(false);
        else if (!navigator.onLine) setOffline(true);
      },
    });
    const always = alwaysPollMs && alwaysPollMs > 0 ? setInterval(refresh, Math.max(FALLBACK_POLL_MS, alwaysPollMs)) : null;
    const onVisible = () => {
      if (document.visibilityState === "hidden") away.hide();
      else if (away.shouldCatchUp()) refresh();
    };
    const onOffline = () => setOffline(true);
    const onOnline = () => {
      setOffline(false);
      refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      stop();
      if (always) clearInterval(always);
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [router, key, jobId, pollMs, alwaysPollMs]);

  // "Updated just now", then the minutes, kept fresh without re-rendering the page.
  useEffect(() => {
    if (!showUpdated || !updatedAt) return;
    const words = () => {
      const min = Math.floor((Date.now() - updatedAt) / 60000);
      setUpdatedWords(min < 1 ? "Updated just now" : `Updated ${min} min ago`);
    };
    words();
    const t = setInterval(words, 30000);
    return () => clearInterval(t);
  }, [showUpdated, updatedAt]);

  return (
    <>
      {showUpdated && updatedWords ? <span className="pointer-events-none fixed bottom-2 right-3 z-30 text-[11px] font-semibold text-muted" data-live-updated>{updatedWords}</span> : null}
      {offline ? <span className="fixed bottom-2 left-3 z-50 inline-flex items-center rounded-control bg-chip px-3 py-1 text-xs font-semibold text-muted" data-live-offline>Offline – reconnecting…</span> : null}
    </>
  );
}

/** For pages without a login (the phone upload page): refresh on a timer, only while the screen is on. */
export function PollRefresh({ ms = 15000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, Math.max(15000, ms));
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}
