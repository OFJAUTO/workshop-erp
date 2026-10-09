"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** A display board refreshes itself every so often; nobody touches it. */
export function Reload({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
