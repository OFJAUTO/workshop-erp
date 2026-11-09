"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Button, Field, Input, LinkButton, Notice } from "@/components/ui";
import { PasskeySlowHelp } from "@/components/PasskeySlowHelp";
import { passkeyErrorWords } from "./PasskeySignIn";

function subscribeCoarse(cb: () => void) {
  const m = window.matchMedia("(pointer: coarse)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
const coarseNow = () => window.matchMedia("(pointer: coarse)").matches;

async function post<T>(url: string, body: unknown): Promise<T & { error?: string }> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw Object.assign(new Error(j.error ?? "failed"), { words: j.error });
  return j;
}

/**
 * THE phone setup (first phone after sign-in, or "Add another phone" on My sign-in). On a PC the main button uses
 * the phone through a QR code (Windows asks for Bluetooth); on a phone or tablet the device itself. A second phone
 * needs a fresh approval with a phone already set up first.
 */
export function PasskeySetup({ hasPhones, next, doneHref, touchGuess = false, sharedDevice = false }: { hasPhones: boolean; next?: string; doneHref?: string; touchGuess?: boolean; /** A registered shared device (workshop tablet) - 9 November 2026: saving a passkey HERE is warned against. */ sharedDevice?: boolean }) {
  const router = useRouter();
  // The server guesses from the browser (a phone or tablet), so the right buttons show from the first paint.
  // A touch screen (an iPad says it is a Mac) or a phone's browser: either is enough.
  const coarse = useSyncExternalStore(subscribeCoarse, coarseNow, () => touchGuess);
  const touch = coarse || touchGuess;
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(!hasPhones);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // 9 November 2026: a passkey saved on a shared device (an office PC, a workshop tablet) is everyone's way in.
  const shared = sharedDevice || !touch;
  const [warnShared, setWarnShared] = useState(false);

  async function confirm() {
    setError(null);
    setBusy(true);
    try {
      const o = await post<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/api/auth/passkey/options", { purpose: "confirm" });
      const response = await startAuthentication({ optionsJSON: o.options });
      await post("/api/auth/passkey/confirm", { challengeId: o.challengeId, response });
      setConfirmed(true);
    } catch (err) {
      setError((err as { words?: string }).words ?? passkeyErrorWords(err));
    } finally {
      setBusy(false);
    }
  }

  async function register(where: "phone" | "here") {
    setError(null);
    if (where === "here" && shared && !warnShared) {
      setWarnShared(true);
      return;
    }
    if (!browserSupportsWebAuthn()) {
      setError("This browser cannot use passkeys. Try Chrome, Edge or Safari, or a different device.");
      return;
    }
    setBusy(true);
    try {
      const o = await post<{ challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"]; needConfirm?: boolean }>("/api/auth/passkey/options", { purpose: "register", where });
      const response = await startRegistration({ optionsJSON: o.options });
      const saved = await post<{ ok: boolean; name: string }>("/api/auth/passkey/register", { challengeId: o.challengeId, response, name });
      setDone(saved.name);
      router.refresh();
    } catch (err) {
      const words = (err as { words?: string }).words;
      if (words && /approve with a phone you already set up/i.test(words)) setConfirmed(false);
      setError(words ?? passkeyErrorWords(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4" data-passkey-setup-done>
        <Notice tone="success">Done ✓ Your phone is set up: {done}. Next time, sign in with “Sign in with passkey”.</Notice>
        {next ? (
          <LinkButton href={next} size="lg" className="w-full" data-passkey-continue>
            Continue
          </LinkButton>
        ) : doneHref ? (
          <LinkButton href={doneHref} tone="secondary" className="w-full">
            Back
          </LinkButton>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-passkey-setup>
      {error ? (
        <div data-passkey-error>
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      {!confirmed ? (
        <div className="flex flex-col gap-3" data-passkey-confirm-step>
          <p className="text-sm">Step 1: approve with a phone that is already set up for you. This proves it is really you adding a new phone.</p>
          <Button type="button" size="lg" onClick={confirm} disabled={busy} className="w-full !whitespace-normal" data-passkey-confirm>
            {busy ? "Waiting for your phone…" : "Approve with my phone"}
          </Button>
          <PasskeySlowHelp busy={busy} />
        </div>
      ) : (
        <>
          <Field label="Name this phone (optional)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Peter's iPhone" maxLength={60} spell={false} data-passkey-name />
          </Field>
          {touch ? (
            <>
              <Button type="button" size="lg" onClick={() => register("here")} disabled={busy} className="w-full !whitespace-normal" data-passkey-register="here">
                {busy ? "Waiting…" : warnShared ? "Save on this device anyway" : "Use this phone or tablet"}
              </Button>
              <Button type="button" tone="secondary" onClick={() => register("phone")} disabled={busy} className="w-full !whitespace-normal" data-passkey-register="phone">
                Use a different phone (scan a QR code)
              </Button>
            </>
          ) : (
            <>
              <Button type="button" size="lg" onClick={() => register("phone")} disabled={busy} className="w-full !whitespace-normal" data-passkey-register="phone">
                {busy ? "Waiting for your phone…" : "Use my phone (scan a QR code)"}
              </Button>
              <Button type="button" tone="secondary" onClick={() => register("here")} disabled={busy} className="w-full !whitespace-normal" data-passkey-register="here">
                {warnShared ? "Save on this computer anyway" : "Use this computer instead (only if nobody else uses it)"}
              </Button>
            </>
          )}
          {warnShared ? (
            <div className="flex flex-col gap-2 rounded-control border-2 border-amber-bar bg-amber-soft p-3" data-passkey-shared-warning>
              <span className="text-sm font-bold">This is a shared device. Save your passkey on your own phone instead.</span>
              <span className="text-xs">Anyone who uses this {touch ? "tablet" : "computer"} could sign in as you. Press the button above again only if this device is yours alone.</span>
            </div>
          ) : null}
          <PasskeySlowHelp busy={busy} />
        </>
      )}
    </div>
  );
}
