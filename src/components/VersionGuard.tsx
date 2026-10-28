"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { APP_VERSION, BEFORE_RELOAD_EVENT, STALE_EVENT, forgetFormSnapshot, isStaleVersionError, reloadForNewVersion, restoreForms, snapshotForms } from "@/lib/app-version";

/** Customer and driver pages never show the bar (they still reload by themselves after a failed click). The staff
 * phone checklist (/u) and the quick sign-in (/k) are staff pages and do show it. */
const CUSTOMER_PAGE = /^\/(quote|invoice|proforma|approve|report|progress|handover|warranty|drive|lpo|terms|login|auth|m|d|s|q|i|r|p)(\/|$)/;
const CHECK_EVERY_MS = 10 * 60_000;

/**
 * THE new-version guard (27 October 2026), mounted once in the root layout. It reads the static /version.json when the
 * tab comes back into view (at most once a minute) and every ten minutes while it is visible; a different version
 * shows "A new version is available – tap to refresh". A click that fails because the tab still runs the old
 * version (a missing code chunk, a server action the new deploy no longer has) reloads the page by itself once,
 * after the forms have saved what is typed.
 */
export function VersionGuard() {
  const pathname = usePathname() ?? "/";
  const [newer, setNewer] = useState(false);

  useEffect(() => {
    const stale = () => {
      if (!reloadForNewVersion()) setNewer(true);
    };
    const onError = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "SCRIPT" || t.tagName === "LINK")) {
        const src = (t as HTMLScriptElement).src || (t as HTMLLinkElement).href || "";
        if (src.includes("/_next/static/")) stale();
        return;
      }
      const ev = e as ErrorEvent;
      if (isStaleVersionError(String(ev.message || ev.error?.message || ""))) stale();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string } | string | undefined;
      if (isStaleVersionError(String(typeof r === "string" ? r : (r?.message ?? "")))) stale();
    };
    // Every form on the page keeps what is typed across a version reload: all forms just before the reload, and
    // a submitted form for 15 seconds (its click may be the one that meets the old version); restored once after.
    const onBefore = () => snapshotForms();
    const onSubmit = (e: Event) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      snapshotForms(form);
      setTimeout(() => forgetFormSnapshot(form), 15_000);
    };
    const onStale = () => setNewer(true);
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener(BEFORE_RELOAD_EVENT, onBefore);
    window.addEventListener(STALE_EVENT, onStale);
    document.addEventListener("submit", onSubmit, true);
    const restore = setTimeout(() => restoreForms(), 400);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener(BEFORE_RELOAD_EVENT, onBefore);
      window.removeEventListener(STALE_EVENT, onStale);
      document.removeEventListener("submit", onSubmit, true);
      clearTimeout(restore);
    };
  }, []);

  useEffect(() => {
    if (APP_VERSION === "dev" || APP_VERSION === "local") return;
    let last = 0;
    const check = async () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 60_000) return;
      last = Date.now();
      try {
        const r = await fetch("/version.json", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { version?: string };
        if (j.version && j.version !== APP_VERSION) setNewer(true);
      } catch {}
    };
    const first = setTimeout(check, 20_000);
    const every = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  if (!newer || CUSTOMER_PAGE.test(pathname)) return null;
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(new Event(BEFORE_RELOAD_EVENT));
        setTimeout(() => window.location.reload(), 600);
      }}
      className="fixed left-1/2 top-2 z-[80] min-h-11 -translate-x-1/2 rounded-full bg-ink px-5 text-sm font-bold text-white shadow-xl"
      data-new-version
    >
      A new version is available – tap to refresh
    </button>
  );
}
