"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Item = { id: number; staff_id?: string; type: string; title: string; body: string | null; job_id: string | null; href: string | null; read_at: string | null; created_at: string };

const VOLUME_KEY = "erp_notif_volume";
const POLL_MS = 30000;
/** Anything that needs the owner's personal approval gets the louder, longer sound. */
const OWNER_TYPES = new Set(["owner_approval_needed", "inspection_change_requested", "move_requested"]);
type Volume = "off" | "low" | "normal";

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** A short chime made on the spot (no sound files): two notes, or three rising notes for owner approvals. */
function chime(kind: "normal" | "owner", volume: Volume) {
  if (volume === "off") return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const gainLevel = volume === "low" ? 0.08 : 0.25;
    const notes = kind === "owner" ? [523, 659, 784, 1047] : [880, 1175];
    const len = kind === "owner" ? 0.22 : 0.16;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === "owner" ? "triangle" : "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * len;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(gainLevel, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + len);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + len);
    });
    setTimeout(() => ctx.close().catch(() => {}), notes.length * len * 1000 + 300);
  } catch {
    // no sound available
  }
}

/**
 * Bell with unread count at the top right of the page, a panel below it, live arrival with a
 * chime, a one-second shake, the count on the browser tab, and a corner pop-up.
 */
export function NotificationBell({ staffId }: { staffId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Item | null>(null);
  const [shake, setShake] = useState(false);
  const [volume, setVolume] = useState<Volume>(() => {
    try {
      const v = typeof localStorage !== "undefined" ? localStorage.getItem(VOLUME_KEY) : null;
      return v === "off" || v === "low" ? v : "normal";
    } catch {
      return "normal";
    }
  });
  const box = useRef<HTMLDivElement>(null);
  const known = useRef<Set<number>>(new Set());
  const baseTitle = useRef<string>("");

  // The count on the browser tab.
  useEffect(() => {
    if (!baseTitle.current) baseTitle.current = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = unread > 0 ? `(${unread}) ${baseTitle.current}` : baseTitle.current;
  }, [unread]);

  const announce = useCallback((n: Item) => {
    setToast(n);
    setTimeout(() => setToast((t) => (t?.id === n.id ? null : t)), 8000);
    setShake(true);
    setTimeout(() => setShake(false), 1100);
    let v: Volume = "normal";
    try {
      const s = localStorage.getItem(VOLUME_KEY);
      if (s === "off" || s === "low") v = s;
    } catch {}
    chime(OWNER_TYPES.has(n.type) ? "owner" : "normal", v);
  }, []);

  const load = useCallback(
    async (quiet = true) => {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { items: Item[]; unread: number };
        if (!quiet) {
          const fresh = data.items.filter((i) => !i.read_at && !known.current.has(i.id));
          if (fresh.length && known.current.size) announce(fresh[0]);
        }
        for (const i of data.items) known.current.add(i.id);
        setItems(data.items);
        setUnread(data.unread);
      } catch {
        // ignore
      }
    },
    [announce],
  );

  useEffect(() => {
    const first = setTimeout(() => load(true), 0);
    const supabase = createClient();
    // Unfiltered on purpose: Realtime did not deliver filtered changes to this project, so the person is checked here.
    const channel = supabase
      .channel(`notifications-${staffId}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (payload) => {
        const n = payload.new as Item;
        if (n.staff_id !== staffId || known.current.has(n.id)) return;
        known.current.add(n.id);
        setItems((prev) => [n, ...prev].slice(0, 30));
        setUnread((u) => u + 1);
        announce(n);
      });
    let cancelled = false;
    // Hand the live connection the login first; otherwise the access rules see an anonymous visitor.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe();
    });
    const poll = setInterval(() => load(false), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(poll);
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("mousedown", close);
    };
  }, [staffId, load, announce]);

  async function openItem(n: Item) {
    setOpen(false);
    setToast(null);
    if (!n.read_at) {
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i)));
      setUnread((u) => Math.max(0, u - 1));
      fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [n.id] }) }).catch(() => {});
    }
    router.push(n.href ?? (n.job_id ? `/jobs/${n.job_id}` : "/notifications"));
  }

  async function markAll() {
    setItems((prev) => prev.map((i) => ({ ...i, read_at: i.read_at ?? new Date().toISOString() })));
    setUnread(0);
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) }).catch(() => {});
  }

  function cycleVolume() {
    const next: Volume = volume === "normal" ? "low" : volume === "low" ? "off" : "normal";
    setVolume(next);
    try {
      localStorage.setItem(VOLUME_KEY, next);
    } catch {}
    if (next !== "off") chime("normal", next);
  }

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications, ${unread} unread`}
        aria-expanded={open}
        className={`relative inline-flex h-11 w-11 items-center justify-center rounded-control border bg-white text-ink hover:bg-chip ${open ? "border-ink" : "border-line-strong"}`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={shake ? "bell-shake" : ""}>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 rounded-full bg-red-bar text-white text-[11px] font-bold flex items-center justify-center px-1">{unread > 99 ? "99+" : unread}</span>
        ) : null}
      </button>

      {open ? (
        <div className="z-50 rounded-card border border-line bg-white text-ink shadow-xl flex flex-col max-sm:fixed max-sm:inset-x-4 max-sm:top-20 sm:absolute sm:right-0 sm:top-13 sm:w-[360px]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
            <span className="text-sm font-extrabold">Notifications</span>
            <div className="flex items-center gap-3">
              <button type="button" onClick={cycleVolume} className="min-h-9 text-xs font-semibold text-muted hover:text-ink" title="Sound: normal, low or off. The shake and the count always stay.">
                Sound {volume}
              </button>
              {unread > 0 ? (
                <button type="button" onClick={markAll} className="min-h-9 text-xs font-semibold text-muted hover:text-ink">
                  Mark all read
                </button>
              ) : null}
            </div>
          </div>
          <ul className="max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain divide-y divide-line">
            {items.length === 0 ? <li className="px-4 py-6 text-sm text-muted text-center">Nothing yet.</li> : null}
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)} className={`w-full px-4 py-3 text-left hover:bg-canvas ${n.read_at ? "" : "bg-chip/60"}`}>
                  <span className="flex items-start gap-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : OWNER_TYPES.has(n.type) ? "bg-ink" : "bg-red-bar"}`} />
                    <span className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm font-semibold leading-snug">{n.title}</span>
                      {n.body ? <span className="text-xs text-muted">{n.body}</span> : null}
                      <span className="text-[11px] text-faint">{timeAgo(n.created_at)}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="px-4 py-2.5 border-t border-line shrink-0">
            <a href="/notifications" className="text-xs font-semibold underline underline-offset-4">
              All notifications and settings
            </a>
          </div>
        </div>
      ) : null}

      {toast ? (
        <button type="button" onClick={() => openItem(toast)} className="fixed bottom-4 right-4 z-50 max-w-sm rounded-card border border-ink bg-white text-ink shadow-2xl px-4 py-3 text-left">
          <span className="block text-sm font-bold">{toast.title}</span>
          {toast.body ? <span className="block text-xs text-muted">{toast.body}</span> : null}
          <span className="block text-[11px] text-faint mt-1">Tap to open</span>
        </button>
      ) : null}
    </div>
  );
}
