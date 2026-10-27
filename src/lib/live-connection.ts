import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/** While the live connection is down, a screen checks the server this often (never while it is up). */
export const FALLBACK_POLL_MS = 60_000;
/** A tab hidden longer than this catches up once when it comes back (a phone may have slept without a word). */
export const HIDDEN_CATCH_UP_MS = 5 * 60_000;

/**
 * THE live connection (27 October 2026): every live screen and the bell start their Supabase Realtime channel here.
 * Changes arrive through the channel; nothing re-checks the server on a timer while it is up. Only when the channel
 * is down (error, time-out, closed, or no answer within 15 seconds) does `fallback` run, every `fallbackMs`, and only
 * while the tab is visible; when the channel comes back, `onReconnect` catches up once.
 */
export function startLive(
  supabase: SupabaseClient,
  channel: RealtimeChannel,
  opts: { onReconnect: () => void; fallback: () => void; fallbackMs?: number; onStatus?: (live: boolean) => void },
): () => void {
  let cancelled = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  let live = false;
  let everLive = false;
  const down = () => {
    if (cancelled) return;
    live = false;
    opts.onStatus?.(false);
    if (!poll) {
      poll = setInterval(() => {
        if (document.visibilityState === "visible") opts.fallback();
      }, Math.max(4000, opts.fallbackMs ?? FALLBACK_POLL_MS));
    }
  };
  const up = () => {
    if (cancelled) return;
    if (poll) {
      clearInterval(poll);
      poll = null;
    }
    const wasDown = everLive && !live;
    live = true;
    everLive = true;
    opts.onStatus?.(true);
    if (wasDown) opts.onReconnect();
  };
  // The browser client starts the live connection with the public key: hand it the login first, otherwise the
  // access rules see an anonymous visitor and nothing arrives.
  supabase.auth.getSession().then(({ data }) => {
    if (cancelled) return;
    if (data.session) supabase.realtime.setAuth(data.session.access_token);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") up();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") down();
    });
  });
  const watchdog = setTimeout(() => {
    if (!everLive) down();
  }, 15_000);
  return () => {
    cancelled = true;
    clearTimeout(watchdog);
    if (poll) clearInterval(poll);
    supabase.removeChannel(channel);
  };
}

/** Tracks a hidden tab: true when it should catch up on coming back (something arrived, or it was away long). */
export function hiddenTracker(): { hide: () => void; missed: () => void; shouldCatchUp: () => boolean } {
  let hiddenAt: number | null = null;
  let missedSomething = false;
  return {
    hide: () => {
      hiddenAt = Date.now();
    },
    missed: () => {
      missedSomething = true;
    },
    shouldCatchUp: () => {
      const away = hiddenAt !== null && Date.now() - hiddenAt > HIDDEN_CATCH_UP_MS;
      const yes = missedSomething || away;
      hiddenAt = null;
      missedSomething = false;
      return yes;
    },
  };
}
