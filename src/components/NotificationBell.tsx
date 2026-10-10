"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TONES, engine, isTone, playTone, type ToneId } from "@/lib/tones";

type Item = { id: number; staff_id?: string; type: string; title: string; body: string | null; job_id: string | null; href: string | null; read_at: string | null; created_at: string };

const VOLUME_KEY = "erp_notif_volume";
const TONE_KEY = "erp_notif_tone";
const POLL_MS = 30000;
/** Anything that needs the owner's personal approval, and a technician's "additional work found" for the manager, gets the second sound. */
const LOUD_TYPES = new Set(["owner_approval_needed", "inspection_change_requested", "move_requested", "po_approval", "credit_note_approval", "release_approval", "quote_owner_approval", "additional_work", "overpayment_approval", "comeback"]);
type Volume = "off" | "low" | "normal" | "loud";
const VOLUMES: Volume[] = ["loud", "normal", "low", "off"];
const GAIN: Record<Volume, number> = { off: 0, low: 0.25, normal: 0.55, loud: 0.9 };

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function readVolume(): Volume {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(VOLUME_KEY) : null;
    return v === "off" || v === "low" || v === "loud" ? v : "normal";
  } catch {
    return "normal";
  }
}
function readTone(): ToneId | null {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(TONE_KEY) : null;
    return isTone(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Bell with unread count at the top right of the page, a panel below it, live arrival with the
 * workshop's soft tone (the owner's approvals get the second tone), a wiggle while something is
 * unread, a gentle reminder note every couple of minutes, the count on the browser tab, a corner
 * pop-up, per-person volume and tone, and a bar that asks for one click when the browser has not
 * allowed sound yet.
 */
export function NotificationBell({ staffId, tone = "marimba", ownerTone = "chord", remindMinutes = 2 }: { staffId: string; tone?: string; ownerTone?: string; remindMinutes?: number }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Item | null>(null);
  const [shake, setShake] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [volume, setVolume] = useState<Volume>(readVolume);
  const [soundOpen, setSoundOpen] = useState(false);
  const [myTone, setMyTone] = useState<ToneId | null>(readTone);
  const box = useRef<HTMLDivElement>(null);
  const known = useRef<Set<number>>(new Set());
  const baseTitle = useRef<string>("");
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const normalTone: ToneId = myTone ?? (isTone(tone) ? tone : "marimba");
  const loudTone: ToneId = isTone(ownerTone) ? ownerTone : "chord";

  // The count on the browser tab.
  useEffect(() => {
    if (!baseTitle.current) baseTitle.current = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = unread > 0 ? `(${unread}) ${baseTitle.current}` : baseTitle.current;
  }, [unread]);

  const sound = useCallback(
    (kind: "normal" | "loud" | "remind") => {
      const r = playTone(kind === "loud" ? loudTone : normalTone, GAIN[readVolume()], { remind: kind === "remind" });
      if (r === "blocked") setBlocked(true);
      else if (r === "ok") setBlocked(false);
    },
    [normalTone, loudTone],
  );

  const announce = useCallback(
    (n: Item) => {
      setToast(n);
      setTimeout(() => setToast((t) => (t?.id === n.id ? null : t)), 10000);
      setShake(true);
      setTimeout(() => setShake(false), 1600);
      sound(LOUD_TYPES.has(n.type) ? "loud" : "normal");
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

  // Something unread and the panel closed: one gentle note every couple of minutes, so nobody misses a hand-over.
  useEffect(() => {
    if (unread <= 0) return;
    const t = setInterval(() => {
      if (openRef.current || document.visibilityState !== "visible") return;
      sound("remind");
      setShake(true);
      setTimeout(() => setShake(false), 1600);
    }, Math.max(1, remindMinutes) * 60000);
    return () => clearInterval(t);
  }, [unread, sound, remindMinutes]);

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
    if (v !== "off") setTimeout(() => sound("normal"), 0);
  }
  function chooseTone(t: ToneId | null) {
    setMyTone(t);
    try {
      if (t) localStorage.setItem(TONE_KEY, t);
      else localStorage.removeItem(TONE_KEY);
    } catch {}
    playTone(t ?? (isTone(tone) ? tone : "marimba"), GAIN[readVolume()]);
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
        className={`relative inline-flex h-14 w-14 items-center justify-center rounded-control border bg-white text-ink hover:bg-chip ${open ? "border-ink" : unread > 0 ? "border-red-bar" : "border-line-strong"}`}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={shake ? "bell-shake" : unread > 0 && !open ? "bell-wiggle" : ""}>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -top-2 -right-2 min-w-6 h-6 rounded-full bg-red-bar text-white text-xs font-bold flex items-center justify-center px-1.5">{unread > 99 ? "99+" : unread}</span>
        ) : null}
      </button>

      {blocked && volume !== "off" ? (
        <button
          type="button"
          onClick={() => {
            const ctx = engine();
            if (ctx) ctx.resume().then(() => { setBlocked(false); sound("normal"); }).catch(() => {});
          }}
          className="fixed top-0 inset-x-0 z-50 bg-ink text-white text-sm font-bold py-2 text-center"
        >
          Click here to turn on sounds for notifications
        </button>
      ) : null}

      {open ? (
        <div className="z-50 rounded-card border border-line bg-white text-ink shadow-xl flex flex-col max-sm:fixed max-sm:inset-x-4 max-sm:top-20 sm:absolute sm:right-0 sm:top-13 sm:w-[380px]">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line shrink-0">
            <span className="text-sm font-extrabold">Notifications</span>
            <span className="flex items-center gap-2">
              {unread > 0 ? (
                <button type="button" onClick={markAll} className="min-h-9 text-xs font-semibold text-muted hover:text-ink">
                  Mark all read
                </button>
              ) : null}
              <button type="button" onClick={() => setSoundOpen((v) => !v)} aria-label="Sound settings" aria-expanded={soundOpen} className={`inline-flex h-9 w-9 items-center justify-center rounded-control border ${soundOpen ? "border-ink" : "border-line-strong"}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M11 5 6 9H2v6h4l5 4V5z" />
                  {volume !== "off" ? <path d="M15.5 8.5a5 5 0 0 1 0 7" /> : null}
                  {volume === "loud" ? <path d="M19 5.5a9 9 0 0 1 0 13" /> : null}
                  {volume === "off" ? <path d="M3 3l18 18" /> : null}
                </svg>
              </button>
            </span>
          </div>
          <div className={`flex-col gap-1.5 px-4 py-2 border-b border-line text-xs ${soundOpen ? "flex" : "hidden"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-muted w-12">Sound</span>
              {VOLUMES.map((v) => (
                <button key={v} type="button" onClick={() => chooseVolume(v)} aria-pressed={volume === v} className={`min-h-8 rounded-control border px-2.5 font-bold ${volume === v ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                  {v === "off" ? "Off" : v[0].toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-muted w-12">Tone</span>
              <button type="button" onClick={() => chooseTone(null)} aria-pressed={myTone === null} className={`min-h-8 rounded-control border px-2.5 font-bold ${myTone === null ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>Workshop default</button>
              {TONES.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-0.5">
                  <button type="button" onClick={() => chooseTone(t.id)} aria-pressed={myTone === t.id} className={`min-h-8 rounded-control border px-2.5 font-bold ${myTone === t.id ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{t.label}</button>
                  <button type="button" onClick={() => playTone(t.id, GAIN[volume === "off" ? "normal" : volume])} aria-label={`Play ${t.label}`} className="min-h-8 rounded-control border border-line px-1.5 font-bold text-muted">▶</button>
                </span>
              ))}
            </div>
          </div>
          <ul className="max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain divide-y divide-line">
            {items.length === 0 ? <li className="px-4 py-6 text-sm text-muted text-center">Nothing yet.</li> : null}
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)} className={`w-full px-4 py-3 text-left hover:bg-canvas ${n.read_at ? "" : "bg-chip/60"}`}>
                  <span className="flex items-start gap-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : LOUD_TYPES.has(n.type) ? "bg-ink" : "bg-red-bar"}`} />
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
