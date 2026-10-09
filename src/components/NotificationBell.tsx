"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Item = { id: number; staff_id?: string; type: string; title: string; body: string | null; job_id: string | null; href: string | null; read_at: string | null; created_at: string };

const VOLUME_KEY = "erp_notif_volume";
const POLL_MS = 30000;
/** While something is unread and the panel is closed, a soft reminder note every so often. */
const REMIND_MS = 45000;
/** Anything that needs the owner's personal approval gets the louder, longer sound. */
const OWNER_TYPES = new Set(["owner_approval_needed", "inspection_change_requested", "move_requested", "po_approval", "credit_note_approval", "release_approval", "quote_owner_approval"]);
type Volume = "off" | "low" | "normal" | "loud";
const VOLUMES: Volume[] = ["loud", "normal", "low", "off"];
const GAIN: Record<Volume, number> = { off: 0, low: 0.18, normal: 0.45, loud: 0.85 };

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

let audio: AudioContext | null = null;
/** One sound engine for the page. Browsers keep it muted until the person has clicked somewhere once. */
function engine(): AudioContext | null {
  try {
    if (!audio) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio = new Ctx();
    }
    return audio;
  } catch {
    return null;
  }
}

/**
 * The sounds, made on the spot (no sound files). "normal": a clear two-note chime, ding-dong, played
 * twice. "owner": four rising notes, louder, for things only the owner can approve. "remind": one
 * soft note while something is still unread.
 */
function play(kind: "normal" | "owner" | "remind", volume: Volume): "ok" | "blocked" | "none" {
  if (volume === "off") return "none";
  const ctx = engine();
  if (!ctx) return "none";
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
    if (ctx.state === "suspended") return "blocked";
  }
  const level = GAIN[volume] * (kind === "remind" ? 0.4 : 1);
  const seq = kind === "owner" ? [523, 659, 784, 1047, 784, 1047] : kind === "remind" ? [1175] : [1175, 880, 1175, 880];
  const len = kind === "owner" ? 0.2 : kind === "remind" ? 0.25 : 0.3;
  const gap = kind === "normal" ? [0, 1, 2.6, 3.6] : null;
  seq.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = kind === "owner" ? "square" : "triangle";
    osc.frequency.value = freq;
    const t = ctx.currentTime + (gap ? gap[i] * len : i * len);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + len * 1.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + len * 1.2);
  });
  return "ok";
}

function readVolume(): Volume {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(VOLUME_KEY) : null;
    return v === "off" || v === "low" || v === "loud" ? v : "normal";
  } catch {
    return "normal";
  }
}

/**
 * Bell with unread count at the top right of the page, a panel below it, live arrival with a loud
 * chime, a wiggle that keeps going while something is unread, a soft reminder note every so often,
 * the count on the browser tab, a corner pop-up, per-person volume with a test button, and a bar
 * that asks for one click when the browser has not allowed sound yet.
 */
export function NotificationBell({ staffId }: { staffId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Item | null>(null);
  const [shake, setShake] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [volume, setVolume] = useState<Volume>(readVolume);
  const box = useRef<HTMLDivElement>(null);
  const known = useRef<Set<number>>(new Set());
  const baseTitle = useRef<string>("");
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // The count on the browser tab.
  useEffect(() => {
    if (!baseTitle.current) baseTitle.current = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = unread > 0 ? `(${unread}) ${baseTitle.current}` : baseTitle.current;
  }, [unread]);

  const sound = useCallback((kind: "normal" | "owner" | "remind") => {
    const r = play(kind, readVolume());
    if (r === "blocked") setBlocked(true);
    else if (r === "ok") setBlocked(false);
  }, []);

  const announce = useCallback(
    (n: Item) => {
      setToast(n);
      setTimeout(() => setToast((t) => (t?.id === n.id ? null : t)), 10000);
      setShake(true);
      setTimeout(() => setShake(false), 1600);
      sound(OWNER_TYPES.has(n.type) ? "owner" : "normal");
    },
    [sound],
  );

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
    // The first click anywhere lets the browser play sound from then on.
    const unlock = () => {
      const ctx = engine();
      if (ctx && ctx.state === "suspended") ctx.resume().then(() => setBlocked(false)).catch(() => {});
      else setBlocked(false);
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(poll);
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("pointerdown", unlock);
    };
  }, [staffId, load, announce]);

  // Something unread and the panel closed: a soft note now and then, so nobody misses a hand-over.
  useEffect(() => {
    if (unread <= 0) return;
    const t = setInterval(() => {
      if (openRef.current || document.visibilityState !== "visible") return;
      sound("remind");
      setShake(true);
      setTimeout(() => setShake(false), 1600);
    }, REMIND_MS);
    return () => clearInterval(t);
  }, [unread, sound]);

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

  function chooseVolume(v: Volume) {
    setVolume(v);
    try {
      localStorage.setItem(VOLUME_KEY, v);
    } catch {}
    if (v !== "off") sound("normal");
  }

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          const ctx = engine();
          if (ctx && ctx.state === "suspended") ctx.resume().then(() => setBlocked(false)).catch(() => {});
        }}
        aria-label={`Notifications, ${unread} unread`}
        aria-expanded={open}
        className={`relative inline-flex h-11 w-11 items-center justify-center rounded-control border bg-white text-ink hover:bg-chip ${open ? "border-ink" : unread > 0 ? "border-red-bar" : "border-line-strong"}`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={shake ? "bell-shake" : unread > 0 && !open ? "bell-wiggle" : ""}>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 rounded-full bg-red-bar text-white text-[11px] font-bold flex items-center justify-center px-1">{unread > 99 ? "99+" : unread}</span>
        ) : null}
      </button>

      {blocked && volume !== "off" ? (
        <button
          type="button"
          onClick={() => {
            const ctx = engine();
            if (ctx) ctx.resume().then(() => { setBlocked(false); play("normal", readVolume()); }).catch(() => {});
          }}
          className="fixed top-0 inset-x-0 z-50 bg-ink text-white text-sm font-bold py-2 text-center"
        >
          Click here to turn on sounds for notifications
        </button>
      ) : null}

      {open ? (
        <div className="z-50 rounded-card border border-line bg-white text-ink shadow-xl flex flex-col max-sm:fixed max-sm:inset-x-4 max-sm:top-20 sm:absolute sm:right-0 sm:top-13 sm:w-[380px]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
            <span className="text-sm font-extrabold">Notifications</span>
            {unread > 0 ? (
              <button type="button" onClick={markAll} className="min-h-9 text-xs font-semibold text-muted hover:text-ink">
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-line text-xs">
            <span className="font-semibold text-muted">Sound</span>
            {VOLUMES.map((v) => (
              <button key={v} type="button" onClick={() => chooseVolume(v)} aria-pressed={volume === v} className={`min-h-8 rounded-control border px-2.5 font-bold ${volume === v ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                {v === "off" ? "Off" : v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
            <button type="button" onClick={() => sound("normal")} className="min-h-8 rounded-control border border-line-strong bg-white px-2.5 font-bold">Test sound</button>
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
        <button type="button" onClick={() => openItem(toast)} className="fixed bottom-4 right-4 z-50 max-w-sm rounded-card border-2 border-ink bg-white text-ink shadow-2xl px-4 py-3 text-left">
          <span className="block text-sm font-bold">{toast.title}</span>
          {toast.body ? <span className="block text-xs text-muted">{toast.body}</span> : null}
          <span className="block text-[11px] text-faint mt-1">Tap to open</span>
        </button>
      ) : null}
    </div>
  );
}
