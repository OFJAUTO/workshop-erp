"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/** The inbound address, never shown by default: Show, Copy, and the owner's Generate new token form sits next to it. */
export function SecretAddress({ address }: { address: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" tone="secondary" size="md" onClick={() => setShown((s) => !s)}>{shown ? "Hide" : "Show the address"}</Button>
        <Button type="button" tone="secondary" size="md" onClick={async () => { try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt("Copy the address", address); } }}>{copied ? "Copied" : "Copy"}</Button>
      </div>
      {shown ? <code className="break-all rounded-control bg-chip px-3 py-2 text-xs">{address}</code> : <p className="text-xs text-muted">Hidden. It contains the secret token.</p>}
    </div>
  );
}
