"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type TabMode = { kind: "view" | "act"; id: string; name: string };
const KEY = "erp-tab-mode";

function readTab(): TabMode | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TabMode) : null;
  } catch {
    return null;
  }
}
export function writeTab(mode: TabMode | null) {
  try {
    if (mode) sessionStorage.setItem(KEY, JSON.stringify(mode));
    else sessionStorage.removeItem(KEY);
  } catch {}
}

/**
 * "View as" and "Act as" belong to one browser tab. The tab remembers its own mode (sessionStorage dies
 * with the tab); the server reads a cookie. Whenever the two disagree, the tab wins: it sets or clears
 * the cookie and re-renders. A second tab opened meanwhile therefore shows the owner's own screens,
 * and closing the tab ends the mode. The tab's title carries the person's name the whole time.
 */
export function ModeGuard({ serverMode }: { serverMode: TabMode | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const started = search.get("as") === "1";
  const serverKey = serverMode ? `${serverMode.kind}:${serverMode.id}` : "";

  useEffect(() => {
    let tab = readTab();
    if (started && serverMode) {
      // The tab that started the mode adopts it.
      tab = serverMode;
      writeTab(tab);
      const url = new URL(location.href);
      url.searchParams.delete("as");
      history.replaceState(null, "", url.toString());
    }
    const tabKey = tab ? `${tab.kind}:${tab.id}` : "";
    const assert = async () => {
      if (tabKey === serverKey) return;
      await fetch("/api/view-as/set", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tab ? { kind: tab.kind, id: tab.id } : { kind: "none" }) }).catch(() => null);
      router.refresh();
    };
    void assert();
    const onFocus = () => { void assert(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [serverKey, serverMode, started, router]);

  // The browser tab says whose screens these are.
  useEffect(() => {
    const tab = readTab();
    const base = document.title.replace(/^(Viewing as|Acting as) [^·]+ · /, "");
    document.title = tab ? `${tab.kind === "view" ? "Viewing as" : "Acting as"} ${tab.name} · ${base}` : base;
  }, [pathname, serverKey]);

  return null;
}
