"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Notice, SectionLabel } from "@/components/ui";

type Pending = { id: string; giverName: string; plate: string; items: { id: string; description: string; part_number: string | null; quantity: number }[]; jobId: string };

/**
 * "Peter is handing you 4 parts for Dubai M 10000": one tick per part (all ticked to start), the PIN
 * box, one tap. A part left unticked goes back to Parts as "Not received by the technician".
 */
export function PendingHandoverCard({ handovers, confirm }: { handovers: Pending[]; confirm: (handoverId: string, formData: FormData) => Promise<{ error?: string; ok?: boolean; message?: string }> }) {
  const router = useRouter();
  const [pins, setPins] = useState<Record<string, string>>({});
  const [unticked, setUnticked] = useState<Record<string, Set<string>>>({});
  const [msg, setMsg] = useState<Record<string, { tone: "error" | "success"; text: string }>>({});
  const [pending, start] = useTransition();
  if (!handovers.length) return null;
  const isOn = (h: string, id: string) => !unticked[h]?.has(id);
  const toggle = (h: string, id: string) => setUnticked((u) => { const n = new Set(u[h] ?? []); if (n.has(id)) n.delete(id); else n.add(id); return { ...u, [h]: n }; });
  return (
    <div className="flex flex-col gap-3" id="handover">
      {handovers.map((h) => {
        const received = h.items.filter((i) => isOn(h.id, i.id));
        return (
          <Card key={h.id} className="flex flex-col gap-3 border-ink ring-2 ring-ink">
            <SectionLabel right={h.plate}>{h.giverName} is handing you {h.items.length} part{h.items.length === 1 ? "" : "s"}</SectionLabel>
            <p className="text-xs text-muted">Tick what you have in your hands. Anything unticked goes back to Parts as not received.</p>
            <ul className="divide-y divide-line text-[15px]">
              {h.items.map((i) => {
                const on = isOn(h.id, i.id);
                return (
                  <li key={i.id}>
                    <button type="button" onClick={() => toggle(h.id, i.id)} aria-pressed={on} className={`flex w-full min-h-12 items-center gap-3 px-2 text-left ${on ? "" : "opacity-60"}`}>
                      <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${on ? "bg-green text-white" : "border border-line-strong text-transparent"}`}>✓</span>
                      <span className="flex-1 font-semibold">{i.description}{i.part_number ? <span className="text-muted font-normal"> · {i.part_number}</span> : null}</span>
                      <span>× {i.quantity}</span>
                      {!on ? <span className="text-xs font-semibold text-amber">Not received</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {msg[h.id] ? <Notice tone={msg[h.id].tone}>{msg[h.id].text}</Notice> : null}
            {msg[h.id]?.tone !== "success" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData();
                  fd.set("pin", pins[h.id] ?? "");
                  fd.set("job_id", h.jobId);
                  fd.set("has_ticks", "1");
                  for (const i of received) fd.append("received", i.id);
                  start(async () => {
                    const r = await confirm(h.id, fd);
                    setMsg((m) => ({ ...m, [h.id]: r.error ? { tone: "error", text: r.error } : { tone: "success", text: r.message ?? "Confirmed." } }));
                    if (!r.error) router.refresh();
                  });
                }}
                className="flex flex-wrap items-end gap-2"
              >
                <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Your PIN</span><Input value={pins[h.id] ?? ""} onChange={(e) => setPins((p) => ({ ...p, [h.id]: e.target.value.replace(/\D/g, "").slice(0, 4) }))} type="password" inputMode="numeric" maxLength={4} pattern="\d{4}" autoComplete="off" className="w-32 text-center text-xl tracking-[0.4em]" aria-label="PIN" /></label>
                <Button type="submit" size="lg" disabled={pending || (pins[h.id] ?? "").length !== 4 || received.length === 0}>
                  {received.length === h.items.length ? "I received these parts" : `I received ${received.length} of ${h.items.length}`}
                </Button>
              </form>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
