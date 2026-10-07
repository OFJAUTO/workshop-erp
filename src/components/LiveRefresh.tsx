"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Re-renders the page when rows change in the given tables (logged-in users).
 * `filter` is a Supabase realtime filter such as "job_id=eq.<id>".
 */
export function LiveRefresh({ tables, filter, pollMs = 0 }: { tables: string[]; filter?: string; pollMs?: number }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    };
    const channel = supabase.channel(`live-${tables.join("-")}-${filter ?? "all"}`);
    for (const table of tables) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, schedule);
    }
    channel.subscribe();
    const poll = pollMs > 0 ? setInterval(() => router.refresh(), pollMs) : null;
    return () => {
      supabase.removeChannel(channel);
      if (poll) clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router, tables, filter, pollMs]);

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
