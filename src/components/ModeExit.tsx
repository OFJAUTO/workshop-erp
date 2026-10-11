"use client";

import { writeTab } from "@/app/(app)/ModeGuard";

/** Leaves "View as" or "Act as" in this tab: forgets the tab's mode, then clears the cookie on the server. */
export function ModeExit({ dark = false }: { dark?: boolean }) {
  return (
    <a
      href="/api/view-as/exit"
      onClick={() => writeTab(null)}
      className={`inline-flex min-h-10 items-center rounded-control px-4 text-sm font-bold ${dark ? "bg-white text-ink" : "bg-ink text-white"}`}
    >
      Exit
    </a>
  );
}
