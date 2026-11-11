"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Button } from "@/components/ui";
import { PasskeySignIn } from "@/components/PasskeySignIn";

export type TabletPerson = {
  id: string;
  display_name: string;
  full_name: string;
  department: string | null;
  photoUrl: string | null;
  /** Something is waiting for this person: a red dot on the photo. */
  unread?: boolean;
  /** A passkey user with a phone set up: the passkey button instead of the PIN pad (7 November 2026). */
  passkey?: boolean;
  /** 11 November 2026 (Section 8): clocked in now (shown first). */
  clockedIn?: boolean;
  /** One of the tablet's own department (the rest behind "Someone else?"). */
  mine?: boolean;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

/**
 * Name grid, then the PIN pad. A temporary PIN from the owner asks for a new one straight away:
 * the person types it twice and nobody else ever sees it.
 */
export function PinLogin({ people, autoSelect = false, departmentLabel = null }: { people: TabletPerson[]; autoSelect?: boolean; /** The tablet's department: its people first, the others behind "Someone else?". */ departmentLabel?: string | null }) {
  const [everyone, setEveryone] = useState(false);
  const router = useRouter();
  const [selected, setSelected] = useState<TabletPerson | null>(autoSelect && people.length === 1 ? people[0] : null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"login" | "new" | "again">("login");
  const [firstNew, setFirstNew] = useState("");
  const setupAfter = useRef(false);

  function reset() {
    setSelected(autoSelect && people.length === 1 ? people[0] : null);
    setPin("");
    setError(null);
    setBusy(false);
    setStage("login");
    setFirstNew("");
  }

  async function submit(fullPin: string, person: TabletPerson) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staffId: person.id, pin: fullPin }) });
      const data = (await res.json()) as { ok?: boolean; error?: string; mustChange?: boolean; setupPasskey?: boolean };
      if (res.ok && data.ok) {
        setupAfter.current = data.setupPasskey === true;
        if (data.mustChange) {
          setStage("new");
          setPin("");
          setBusy(false);
          return;
        }
        router.replace(data.setupPasskey ? "/passkey/setup?next=%2Fhome" : "/home");
        router.refresh();
        return;
      }
      setError(data.error ?? "Could not log in.");
      setPin("");
      setBusy(false);
    } catch {
      setError("No connection. Check the Wi-Fi and try again.");
      setPin("");
      setBusy(false);
    }
  }

  async function saveNew(fullPin: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/pin/change", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: firstNew, again: fullPin }) });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        router.replace(setupAfter.current ? "/passkey/setup?next=%2Fhome" : "/home");
        router.refresh();
        return;
      }
      setError(data.error ?? "Could not save the PIN.");
      setStage("new");
      setFirstNew("");
      setPin("");
      setBusy(false);
    } catch {
      setError("No connection. Try again.");
      setPin("");
      setBusy(false);
    }
  }

  function press(key: string) {
    if (busy || !selected) return;
    if (key === "⌫") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (!key) return;
    const next = (pin + key).slice(0, 4);
    setPin(next);
    if (next.length !== 4) return;
    if (stage === "login") void submit(next, selected);
    else if (stage === "new") {
      setFirstNew(next);
      setPin("");
      setStage("again");
    } else void saveNew(next);
  }

  if (!selected) {
    if (people.length === 0) {
      return <p className="text-center text-muted">No tablet users yet. The owner adds staff with PIN login from the Team page.</p>;
    }
    const shown = departmentLabel && !everyone ? people.filter((p) => p.mine !== false) : people;
    const others = people.length - shown.length;
    return (
      <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3" data-tablet-people={shown.length}>
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setSelected(p);
              setError(null);
            }}
            className="flex flex-col items-center gap-3 rounded-card border border-line bg-white p-5 min-h-36 hover:border-ink active:bg-chip cursor-pointer"
          >
            <span className="relative"><Avatar name={p.full_name} photoUrl={p.photoUrl} size={64} />{p.unread ? <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-bar ring-2 ring-white" aria-label="Something waiting" /> : null}</span>
            <span className="flex flex-col items-center gap-0.5">
              <span className="font-bold text-base leading-tight">{p.display_name}</span>
              {p.department ? <span className="text-xs text-muted">{p.department}</span> : null}
              {p.clockedIn ? <span className="text-xs font-bold text-green-text" data-tablet-clocked-in>Clocked in</span> : null}
            </span>
          </button>
        ))}
      </div>
      {departmentLabel && !everyone && others > 0 ? (
        <button type="button" onClick={() => setEveryone(true)} className="inline-flex min-h-11 items-center self-center text-base font-bold underline underline-offset-4" data-tablet-someone-else>
          Someone else? ({others} from other departments)
        </button>
      ) : null}
      </div>
    );
  }

  const prompt = stage === "login" ? "Enter your 4-digit PIN" : stage === "new" ? "This was a temporary PIN. Choose your own 4 digits" : "Type the new PIN again";

  if (selected.passkey && stage === "login") {
    return (
      <div className="mx-auto w-full max-w-xs flex flex-col items-center gap-5" data-tablet-passkey>
        <div className="flex flex-col items-center gap-3">
          <Avatar name={selected.full_name} photoUrl={selected.photoUrl} size={72} />
          <span className="text-lg font-bold">{selected.display_name}</span>
          <span className="text-sm text-center text-muted">Approve with Face ID or your fingerprint. Your PIN still signs for parts, but it no longer signs you in.</span>
        </div>
        <div className="w-full">
          <PasskeySignIn staffId={selected.id} next="/home" label="Sign in with passkey" />
        </div>
        <p className="text-xs text-muted text-center">Lost your phone? Sign in with your password on the main sign-in page and tell the owner.</p>
        <Button tone="ghost" onClick={reset} className="w-full">Not you? Go back</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xs flex flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-3">
        <Avatar name={selected.full_name} photoUrl={selected.photoUrl} size={72} />
        <span className="text-lg font-bold">{selected.display_name}</span>
        <span className={`text-sm text-center ${stage === "login" ? "text-muted" : "font-semibold"}`}>{prompt}</span>
      </div>

      <div className="flex gap-3" aria-label="PIN entered">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-4 w-4 rounded-full border-2 border-ink ${i < pin.length ? "bg-ink" : "bg-transparent"}`} />
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-center text-sm font-semibold text-red">{error}</p>
      ) : (
        <p className="h-5 text-sm text-muted">{busy ? "Checking…" : " "}</p>
      )}

      <div className="grid grid-cols-3 gap-3 w-full">
        {KEYS.map((k, i) => (
          <button key={i} type="button" disabled={busy || !k} onClick={() => press(k)} className={`h-16 rounded-card text-2xl font-bold ${k ? "bg-white border border-line hover:border-ink active:bg-chip cursor-pointer" : "invisible"} disabled:opacity-50`}>
            {k}
          </button>
        ))}
      </div>

      {stage === "login" ? (
        <Button tone="ghost" onClick={reset} className="w-full">Not you? Go back</Button>
      ) : (
        <p className="text-xs text-muted text-center">Nobody else sees your PIN. You use it on every handheld and to sign for parts.</p>
      )}
    </div>
  );
}
