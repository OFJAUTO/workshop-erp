"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Row = Record<string, unknown>;

/**
 * Re-renders the page when rows change in the given tables (logged-in users).
 *
 * Subscriptions are deliberately unfiltered on the server: Supabase Realtime did not
 * deliver filtered changes (for example `job_id=eq.<uuid>`) to this project, so the
 * check happens here instead. With `jobId` set, only changes to that job trigger a
 * refresh (rows whose `id` or `job_id` matches). Access rules still decide what each
 * person is allowed to receive.
 *
 * A timer and a refresh on returning to the tab cover any dropped connection.
 */
export function LiveRefresh({ tables, jobId, pollMs = 60000 }: { tables: string[]; jobId?: string; pollMs?: number }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = tables.join(",");

  useEffect(() => {
    const supabase = createClient();
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };
    const matches = (row: Row | null | undefined) => !jobId || !row || row.id === jobId || row.job_id === jobId;
    const channel = supabase.channel(`live-${key}-${jobId ?? "all"}-${Math.random().toString(36).slice(2, 8)}`);
    for (const table of key.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        if (matches(payload.new as Row) || matches(payload.old as Row)) schedule();
      });
    }
    let cancelled = false;
    // The browser client starts the live connection with the public key; hand it the login
    // first, otherwise the access rules see an anonymous visitor and nothing arrives.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe((status) => {
        // If the live connection drops and comes back, catch up at once.
        if (status === "SUBSCRIBED") schedule();
      });
    });
    const poll = pollMs > 0 ? setInterval(() => router.refresh(), pollMs) : null;
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      if (poll) clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, key, jobId, pollMs]);

  return null;
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
