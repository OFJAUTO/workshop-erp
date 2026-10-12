"use client";

import { useState } from "react";
import { Button, Card, SectionLabel } from "@/components/ui";
import { PartActions } from "@/app/(app)/parts/handover/[jobId]/PartActions";
import { PendingHandoverCard } from "./PendingHandoverCard";
import type { PanelPart } from "./WorkPanel";

type Pending = { id: string; giverName: string; plate: string; items: { id: string; description: string; part_number: string | null; quantity: number }[]; jobId: string };
type Action = (formData: FormData) => void | Promise<void>;

/**
 * "Parts for this car", directly under Start work / Pause on the technician's screen: "<n> parts waiting for
 * you" with Receive parts (the card lights up when Parts hand over; the bell chimes), then the line-by-line
 * confirmation with his PIN; under it what he has received and what is still on order with its expected day;
 * and "Report a wrong or faulty part". Parts never type his PIN on their screens.
 */
export function PartsForCar({ jobId, handovers, confirm, parts, canAct, exchangeAction }: { jobId: string; handovers: Pending[]; confirm: (handoverId: string, formData: FormData) => Promise<{ error?: string; ok?: boolean; message?: string }>; parts: PanelPart[]; canAct: boolean; exchangeAction: Action }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState(false);
  const waiting = handovers.reduce((a, h) => a + h.items.length, 0);
  const received = parts.filter((p) => p.state === "handed");
  const coming = parts.filter((p) => p.state !== "handed");
  if (!waiting && !parts.length) return null;
  return (
    <Card className={`flex flex-col gap-3 ${waiting ? "border-ink ring-2 ring-ink" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel right={parts.length ? `${received.length} of ${parts.length} received` : undefined}>Parts for this car</SectionLabel>
        {waiting ? <span className="text-sm font-extrabold">{waiting} part{waiting === 1 ? "" : "s"} waiting for you</span> : null}
      </div>
      {waiting && !open ? <Button type="button" size="lg" className="min-h-14 text-lg" onClick={() => setOpen(true)}>Receive parts</Button> : null}
      {waiting && open ? <PendingHandoverCard handovers={handovers} confirm={confirm} /> : null}
      {parts.length ? (
        <ul className="divide-y divide-line text-sm">
          {received.map((p) => (
            <li key={p.id} className="py-1.5 flex items-center gap-2"><span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green text-xs font-bold text-white">✓</span><span className="font-semibold">{p.description}</span><span className="text-muted">× {p.quantity}</span><span className="ml-auto text-xs font-semibold text-green">Received</span></li>
          ))}
          {coming.map((p) => (
            <li key={p.id} className="py-1.5 flex items-center gap-2"><span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${p.state === "here" ? "bg-ink text-white" : "bg-chip text-muted"}`}>•</span><span className="font-semibold">{p.description}</span><span className="text-muted">× {p.quantity}</span><span className="ml-auto text-xs font-semibold text-muted">{p.state === "here" ? "Here, with Parts" : p.when ? `On order, arrives ${p.when}` : "On order"}</span></li>
          ))}
        </ul>
      ) : null}
      {canAct && received.length ? (
        !report ? (
          <button type="button" onClick={() => setReport(true)} className="self-start min-h-10 rounded-control border border-line-strong bg-white px-3 text-xs font-bold">Report a wrong or faulty part</button>
        ) : (
          <div className="flex flex-col gap-2 rounded-control bg-chip p-3">
            <span className="text-sm font-semibold">Which part?</span>
            <ul className="flex flex-col gap-2">
              {received.map((p) => (
                <li key={p.id} className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">{p.description}</span>
                  <PartActions partId={p.id} back={`/my-jobs/${jobId}`} canExchange canNotNeeded={false} exchangeAction={exchangeAction} notNeededAction={exchangeAction} />
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setReport(false)} className="self-start min-h-9 px-2 text-xs font-semibold text-muted underline underline-offset-4">Close</button>
          </div>
        )
      ) : null}
    </Card>
  );
}
