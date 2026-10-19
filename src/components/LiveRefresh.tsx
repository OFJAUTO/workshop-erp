"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { refreshWhenIdle } from "@/lib/refresh-idle";

type Row = Record<string, unknown>;

/**
 * Re-renders the page when rows change in the given tables (logged-in users), within seconds through
 * Supabase Realtime, with a quiet 30-second re-fetch as the net under it. Invisible to the person:
 * no reload, no flicker, no scroll jump, and never while someone is typing (refreshWhenIdle). A hidden
 * tab pauses; coming back refreshes at once. A changed row flashes the matching [data-flash-id] card
 * softly. When the connection is gone a small grey "Offline – reconnecting…" chip shows; the access
 * rules decide per person what the live feed may carry, exactly as they do for the pages themselves.
 *
 * Subscriptions are deliberately unfiltered on the server: Supabase Realtime did not deliver filtered
 * changes (for example `job_id=eq.<uuid>`) to this project, so the check happens here instead. With
 * `jobId` set, only changes to that job trigger a refresh. Every table given here must be in the
 * supabase_realtime publication, or the whole channel goes quiet.
 */
export function LiveRefresh({ tables, jobId, pollMs = 30000, showUpdated = false }: { tables: string[]; jobId?: string; pollMs?: number; /** A small grey "Updated just now" (the dashboard). */ showUpdated?: boolean }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [updatedWords, setUpdatedWords] = useState("");
  const [offline, setOffline] = useState(false);
  const key = tables.join(",");

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (document.visibilityState === "hidden") return; // paused: the return to the tab catches up
      refreshWhenIdle(() => {
        router.refresh();
        setUpdatedAt(Date.now());
      });
    };
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 300);
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
    let cancelled = false;
    // The browser client starts the live connection with the public key; hand it the login
    // first, otherwise the access rules see an anonymous visitor and nothing arrives.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe((status) => {
        // If the live connection drops and comes back, catch up at once; while it is gone, say so quietly.
        if (status === "SUBSCRIBED") {
          setOffline(false);
          schedule();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          if (!navigator.onLine) setOffline(true);
        }
      });
    });
    const poll = pollMs > 0 ? setInterval(refresh, pollMs) : null;
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
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
      cancelled = true;
      supabase.removeChannel(channel);
      if (poll) clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [router, key, jobId, pollMs]);

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

/** For pages without a login (the phone upload page): refresh on a timer. */
export function PollRefresh({ ms = 5000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}
