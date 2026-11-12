"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { idleLockHeld } from "@/lib/screen-hold";

/** On shared tablets: after this many seconds without a touch, sign out and return to the PIN screen. */
export function IdleLock({ seconds }: { seconds: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!seconds || seconds < 10) return;
    let timer: ReturnType<typeof setTimeout>;

    const lock = async () => {
      // A camera open, the camera app or a file picker, files being got ready: never now (12 November 2026: a video
      // recorded in the camera app came back to the PIN screen and was lost). Looks again after another full wait.
      if (idleLockHeld()) return arm();
      try {
        await fetch("/api/auth/signout", { method: "POST", redirect: "manual" });
      } finally {
        router.replace("/tablet");
        router.refresh();
      }
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, seconds * 1000);
    };

    const events = ["pointerdown", "keydown", "touchstart", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [seconds, router]);

  return null;
}
