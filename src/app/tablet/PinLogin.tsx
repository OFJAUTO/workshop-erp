"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Button } from "@/components/ui";

export type TabletPerson = {
  id: string;
  display_name: string;
  full_name: string;
  department: string | null;
  photoUrl: string | null;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

export function PinLogin({ people, autoSelect = false }: { people: TabletPerson[]; autoSelect?: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<TabletPerson | null>(autoSelect && people.length === 1 ? people[0] : null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setSelected(autoSelect && people.length === 1 ? people[0] : null);
    setPin("");
    setError(null);
    setBusy(false);
  }

  async function submit(fullPin: string, person: TabletPerson) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: person.id, pin: fullPin }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        router.replace("/home");
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

  function press(key: string) {
    if (busy || !selected) return;
    if (key === "⌫") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (!key) return;
    const next = (pin + key).slice(0, 4);
    setPin(next);
    if (next.length === 4) void submit(next, selected);
  }

  if (!selected) {
    if (people.length === 0) {
      return (
        <p className="text-center text-muted">
          No tablet users yet. The owner adds staff with PIN login from the Team page.
        </p>
      );
    }
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {people.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setSelected(p);
              setError(null);
            }}
            className="flex flex-col items-center gap-3 rounded-card border border-line bg-white p-5 min-h-36 hover:border-ink active:bg-chip cursor-pointer"
          >
            <Avatar name={p.full_name} photoUrl={p.photoUrl} size={64} />
            <span className="flex flex-col items-center gap-0.5">
              <span className="font-bold text-base leading-tight">{p.display_name}</span>
              {p.department ? <span className="text-xs text-muted">{p.department}</span> : null}
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xs flex flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-3">
        <Avatar name={selected.full_name} photoUrl={selected.photoUrl} size={72} />
        <span className="text-lg font-bold">{selected.display_name}</span>
        <span className="text-sm text-muted">Enter your 4-digit PIN</span>
      </div>

      <div className="flex gap-3" aria-label="PIN entered">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border-2 border-ink ${i < pin.length ? "bg-ink" : "bg-transparent"}`}
          />
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-center text-sm font-semibold text-red">
          {error}
        </p>
      ) : (
        <p className="h-5 text-sm text-muted">{busy ? "Checking…" : " "}</p>
      )}

      <div className="grid grid-cols-3 gap-3 w-full">
        {KEYS.map((k, i) => (
          <button
            key={i}
            type="button"
            disabled={busy || !k}
            onClick={() => press(k)}
            className={`h-16 rounded-card text-2xl font-bold ${
              k ? "bg-white border border-line hover:border-ink active:bg-chip cursor-pointer" : "invisible"
            } disabled:opacity-50`}
          >
            {k}
          </button>
        ))}
      </div>

      <Button tone="ghost" onClick={reset} className="w-full">
        Not you? Go back
      </Button>
    </div>
  );
}
