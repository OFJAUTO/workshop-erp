"use client";

import { useState } from "react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { Button, Notice } from "@/components/ui";

/** The browser's own refusals, in plain words (cancelled, timed out, no passkey on this device…). */
export function passkeyErrorWords(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "AbortError") return "Cancelled or timed out. Press the button to try again.";
  if (name === "InvalidStateError") return "This phone is already set up for you.";
  if (name === "SecurityError") return "Passkeys only work on the ERP's own address.";
  if (name === "NotSupportedError") return "This browser cannot use passkeys. Use your password instead.";
  return "That didn't work. Press the button to try again.";
}

/**
 * THE "Sign in with passkey" button (login page and tablets). On a PC the browser offers the phone (QR code, or a
 * prompt straight to a remembered Android phone); on a phone or tablet it asks for Face ID / fingerprint.
 * `staffId` (tablet name tap) limits the question to that person's phones.
 */
export function PasskeySignIn({ next = "/home", staffId, label = "Sign in with passkey", size = "lg" }: { next?: string; staffId?: string; label?: string; size?: "lg" | "md" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setError(null);
    if (!browserSupportsWebAuthn()) {
      setError("This browser cannot use passkeys. Use your password instead.");
      return;
    }
    setBusy(true);
    try {
      const o = await fetch("/api/auth/passkey/options", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose: "login", staffId }) });
      const opts = (await o.json()) as { challengeId?: string; options?: Parameters<typeof startAuthentication>[0]["optionsJSON"]; error?: string };
      if (!o.ok || !opts.options || !opts.challengeId) throw Object.assign(new Error(opts.error ?? "options"), { words: opts.error });
      const response = await startAuthentication({ optionsJSON: opts.options });
      const r = await fetch("/api/auth/passkey/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId: opts.challengeId, response, next }) });
      const answer = (await r.json()) as { ok?: boolean; next?: string; error?: string };
      if (!r.ok || !answer.ok) throw Object.assign(new Error(answer.error ?? "login"), { words: answer.error });
      window.location.assign(answer.next ?? next);
    } catch (err) {
      const words = (err as { words?: string }).words;
      setError(words ?? passkeyErrorWords(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-passkey-signin>
      {error ? (
        <div data-passkey-error>
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      <Button type="button" size={size} onClick={go} disabled={busy} className="w-full !whitespace-normal text-center" data-passkey-signin-button>
        {busy ? "Waiting for your phone…" : label}
      </Button>
    </div>
  );
}
