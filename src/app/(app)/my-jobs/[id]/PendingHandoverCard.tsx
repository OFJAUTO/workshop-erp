"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Notice, SectionLabel } from "@/components/ui";

type Pending = { id: string; giverName: string; plate: string; items: { id: string; description: string; part_number: string | null; quantity: number }[]; jobId: string };

/** "Peter is handing you 4 parts for Dubai M 10000": the list, the PIN box, one tap. Shown on the technician's own device. */
export function PendingHandoverCard({ handovers, confirm }: { handovers: Pending[]; confirm: (handoverId: string, formData: FormData) => Promise<{ error?: string; ok?: boolean; message?: string }> }) {
  const router = useRouter();
  const [pins, setPins] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, { tone: "error" | "success"; text: string }>>({});
  const [pending, start] = useTransition();
  if (!handovers.length) return null;
  return (
    <div className="flex flex-col gap-3" id="handover">
      {handovers.map((h) => (
        <Card key={h.id} className="flex flex-col gap-3 border-ink ring-2 ring-ink">
          <SectionLabel right={h.plate}>{h.giverName} is handing you {h.items.length} part{h.items.length === 1 ? "" : "s"}</SectionLabel>
          <ul className="divide-y divide-line text-[15px]">
            {h.items.map((i) => <li key={i.id} className="py-1.5 flex justify-between gap-3"><span className="font-semibold">{i.description}{i.part_number ? <span className="text-muted font-normal"> · {i.part_number}</span> : null}</span><span>× {i.quantity}</span></li>)}
          </ul>
          {msg[h.id] ? <Notice tone={msg[h.id].tone}>{msg[h.id].text}</Notice> : null}
          {msg[h.id]?.tone !== "success" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData();
                fd.set("pin", pins[h.id] ?? "");
                fd.set("job_id", h.jobId);
                start(async () => {
                  const r = await confirm(h.id, fd);
                  setMsg((m) => ({ ...m, [h.id]: r.error ? { tone: "error", text: r.error } : { tone: "success", text: r.message ?? "Confirmed." } }));
                  if (!r.error) router.refresh();
                });
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Your PIN</span><Input value={pins[h.id] ?? ""} onChange={(e) => setPins((p) => ({ ...p, [h.id]: e.target.value.replace(/\D/g, "").slice(0, 4) }))} type="password" inputMode="numeric" maxLength={4} className="w-36 text-center text-2xl tracking-[0.5em]" aria-label="PIN" /></label>
              <Button type="submit" size="lg" disabled={pending || (pins[h.id] ?? "").length !== 4}>I received these parts</Button>
            </form>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
