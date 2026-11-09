"use client";

import { useEffect, useState } from "react";

/** The 30-second wait (9 November 2026, Section 4): office PCs hung on "Connecting…" with the phone. */
export const PASSKEY_SLOW_MS = 30_000;
export const PASSKEY_SLOW_WORDS = "Your phone and this computer can't find each other. Check Bluetooth on both and keep the phone close, or set up the passkey on your phone: open erp.ofjauto.com on your phone, sign in, add passkey.";

/**
 * Shown under a passkey button when the browser's prompt has not finished after 30 seconds. The prompt itself keeps
 * going (the person may still finish it); this only says what to do when the phone and the PC cannot find each other.
 * Each wait mounts its own timer, so a new try starts a new 30 seconds.
 */
export function PasskeySlowHelp({ busy }: { busy: boolean }) {
  return busy ? <SlowTimer /> : null;
}

function SlowTimer() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), PASSKEY_SLOW_MS);
    return () => clearTimeout(t);
  }, []);
  if (!shown) return null;
  return (
    <div className="rounded-control border-2 border-amber-bar bg-amber-soft p-3 text-sm font-semibold" role="status" data-passkey-slow>
      {PASSKEY_SLOW_WORDS}
    </div>
  );
}
