"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

const KEY = "erp-scroll";
const LOCK_MS = 5000;

/**
 * Two standing rules for every form in the app, applied once from the layout:
 *
 * 1. A tap never lands twice. The first submit of a form locks it for five seconds (the button
 *    goes pale); a second tap in that window is swallowed, so one tap makes one row, one receipt,
 *    one request. Forms that are meant to be submitted again quickly can opt out with
 *    data-allow-resubmit.
 *
 * 2. A long form keeps its place. The scroll position is remembered on submit and put back when the
 *    same page renders again after the action (a redirect back to the page normally jumps to the
 *    top). A link with a #target keeps its target.
 */
export function FormGuard() {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || form.tagName !== "FORM") return;
      if (form.dataset.allowResubmit !== undefined) return;
      const until = Number(form.dataset.busyUntil ?? 0);
      if (until > Date.now()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      form.dataset.busyUntil = String(Date.now() + LOCK_MS);
      const submitter = (e as SubmitEvent).submitter as HTMLElement | null;
      if (submitter) {
        submitter.style.opacity = "0.5";
        submitter.style.pointerEvents = "none";
        setTimeout(() => {
          submitter.style.opacity = "";
          submitter.style.pointerEvents = "";
        }, LOCK_MS);
      }
      try {
        sessionStorage.setItem(KEY, JSON.stringify({ path: location.pathname, y: window.scrollY, t: Date.now() }));
      } catch {}
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as { path: string; y: number; t: number };
      if (s.path !== pathname || Date.now() - s.t > 20000) return;
      sessionStorage.removeItem(KEY);
      if (location.hash) return;
      const go = () => window.scrollTo({ top: s.y });
      go();
      requestAnimationFrame(go);
      setTimeout(go, 150);
      setTimeout(go, 500);
    } catch {}
  }, [pathname, search]);

  return null;
}

/**
 * For client components that refresh the page after a save: remembers where the page is and puts
 * it back if the refresh moved it to the top.
 */
export function keepScrollThrough(action: () => void) {
  const y = window.scrollY;
  action();
  if (y < 50) return;
  let tries = 0;
  const check = () => {
    tries++;
    if (Math.abs(window.scrollY - y) > 200 && window.scrollY < 50) window.scrollTo({ top: y });
    if (tries < 12) setTimeout(check, 100);
  };
  setTimeout(check, 50);
}
