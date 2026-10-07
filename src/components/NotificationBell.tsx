"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Item = { id: number; type: string; title: string; body: string | null; job_id: string | null; href: string | null; read_at: string | null; created_at: string };

const SOUND_KEY = "erp_notif_sound";

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Bell with unread count, dropdown list, live arrival with a corner pop-up and optional sound. */
export function NotificationBell({ staffId }: { staffId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Item | null>(null);
  const [sound, setSound] = useState(() => {
    try {
      return typeof localStorage !== "undefined" && localStorage.getItem(SOUND_KEY) === "1";
    } catch {
      return false;
    }
  });
  const box = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items: Item[]; unread: number };
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications-${staffId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `staff_id=eq.${staffId}` }, (payload) => {
        const n = payload.new as Item;
        setItems((prev) => [n, ...prev].slice(0, 30));
        setUnread((u) => u + 1);
        setToast(n);
        setTimeout(() => setToast((t) => (t?.id === n.id ? null : t)), 8000);
        try {
          if (localStorage.getItem(SOUND_KEY) === "1" && document.hidden) audio.current?.play().catch(() => {});
        } catch {}
      })
      .subscribe();
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      clearTimeout(first);
      supabase.removeChannel(channel);
      document.removeEventListener("mousedown", close);
    };
  }, [staffId, load]);

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

  function toggleSound() {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? "1" : "0");
    } catch {}
    if (next) audio.current?.play().catch(() => {});
  }

  return (
    <div ref={box} className="relative shrink-0">
      <audio ref={audio} preload="auto" src="data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YTtvT18AAAAA" />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications, ${unread} unread`}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-control text-white/90 hover:bg-white/10"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 rounded-full bg-red-bar text-white text-[11px] font-bold flex items-center justify-center px-1">{unread > 99 ? "99+" : unread}</span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute left-0 md:left-0 top-12 z-40 w-80 max-w-[90vw] rounded-card border border-line bg-white text-ink shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="text-sm font-extrabold">Notifications</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={toggleSound} className="text-xs font-semibold text-muted hover:text-ink">
                Sound {sound ? "on" : "off"}
              </button>
              {unread > 0 ? (
                <button type="button" onClick={markAll} className="text-xs font-semibold text-muted hover:text-ink">
                  Mark all read
                </button>
              ) : null}
            </div>
          </div>
          <ul className="max-h-96 overflow-y-auto divide-y divide-line">
            {items.length === 0 ? <li className="px-4 py-6 text-sm text-muted text-center">Nothing yet.</li> : null}
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)} className={`w-full px-4 py-3 text-left hover:bg-canvas ${n.read_at ? "" : "bg-chip/60"}`}>
                  <span className="flex items-start gap-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-red-bar"}`} />
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
          <div className="px-4 py-2.5 border-t border-line">
            <a href="/notifications" className="text-xs font-semibold underline underline-offset-4">
              Notification settings
            </a>
          </div>
        </div>
      ) : null}

      {toast ? (
        <button
          type="button"
          onClick={() => openItem(toast)}
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded-card border border-ink bg-white text-ink shadow-2xl px-4 py-3 text-left"
        >
          <span className="block text-sm font-bold">{toast.title}</span>
          {toast.body ? <span className="block text-xs text-muted">{toast.body}</span> : null}
          <span className="block text-[11px] text-faint mt-1">Tap to open</span>
        </button>
      ) : null}
    </div>
  );
}
