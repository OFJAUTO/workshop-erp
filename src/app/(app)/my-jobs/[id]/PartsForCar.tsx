"use client";

import { useState, useTransition } from "react";
import { PositionsLine } from "@/components/PositionsLine";
import { useRouter } from "next/navigation";
import { Button, Card, Input, SectionLabel } from "@/components/ui";
import { PartActions } from "@/app/(app)/parts/handover/[jobId]/PartActions";
import type { PanelPart } from "./WorkPanel";

type Action = (formData: FormData) => void | Promise<void>;
type Receive = (formData: FormData) => Promise<{ error?: string; ok?: boolean; message?: string }>;

/**
 * "Parts for this car" on the technician's own tablet. Every row starts UNTICKED (light grey): the
 * technician looks at each part and ticks what he is really taking - a ticked row turns light green.
 * "I've received these (N)" goes active only with at least one tick and his 4-digit PIN. Confirmed
 * parts keep the green, say who received them and when, can never be unticked, and sit collapsed
 * at the bottom under "Received (N)". Nothing here ever blocks starting work.
 */
export function PartsForCar({ jobId, parts, canAct, receive, exchangeAction }: { jobId: string; parts: PanelPart[]; canAct: boolean; receive: Receive; exchangeAction: Action }) {
  const router = useRouter();
  const [tickedIds, setTickedIds] = useState<Set<string>>(new Set());
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [report, setReport] = useState(false);
  const [pending, start] = useTransition();
  const received = parts.filter((p) => p.state === "handed");
  const takeable = parts.filter((p) => p.state === "ready" || p.state === "here");
  const coming = parts.filter((p) => p.state === "coming");
  const notReceived = takeable.length + coming.length;
  const allReceived = parts.length > 0 && received.length === parts.length;
  const ticked = takeable.filter((p) => tickedIds.has(p.id));
  if (!parts.length) return null;
  const toggle = (id: string) => setTickedIds((u) => { const n = new Set(u); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const submit = () => start(async () => {
    setMsg(null);
    const fd = new FormData();
    for (const p of ticked) fd.append("received", p.id);
    fd.set("pin", pin);
    const r = await receive(fd);
    if (r.error) setMsg({ tone: "error", text: r.error });
    else {
      setMsg({ tone: "success", text: r.message ?? "Received." });
      setTickedIds(new Set());
      setPin("");
      router.refresh();
    }
  });
  return (
    <Card className="flex flex-col gap-3" data-parts-for-car>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel right={allReceived ? undefined : `${received.length} of ${parts.length} received`}>Parts for this car</SectionLabel>
        {allReceived ? <span className="text-sm font-bold text-green" data-all-received>All {parts.length} received ✓</span> : notReceived ? <span className="text-xs font-bold text-amber" data-parts-note>{notReceived} part{notReceived === 1 ? "" : "s"} not received yet</span> : null}
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {takeable.map((p) => {
          const on = canAct && tickedIds.has(p.id);
          return (
            <li key={p.id} data-part-take={p.id} data-ticked={on ? "1" : "0"}>
              <button type="button" disabled={!canAct} onClick={() => toggle(p.id)} aria-pressed={on} className={`flex w-full min-h-12 items-center gap-3 rounded-control border px-2 text-left ${on ? "border-[#7FC195] bg-[#E8F5EC]" : "border-transparent bg-chip"}`}>
                <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control border text-xs font-bold ${on ? "border-green bg-green text-white" : "border-line-strong bg-white text-transparent"}`}>✓</span>
                <span className="flex flex-1 flex-col"><span className="font-semibold">{p.description}</span><PositionsLine positions={p.positions} /></span>
                <span>× {p.quantity}</span>
                <span className="text-xs font-semibold text-muted">{p.state === "ready" ? "Ready at the desk" : "At the parts desk"}</span>
              </button>
            </li>
          );
        })}
        {coming.map((p) => (
          <li key={p.id} className="flex items-center gap-2 px-2 py-1.5">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-chip text-xs font-bold text-muted">…</span>
            <span className="flex flex-col"><span className="font-semibold">{p.description}</span><PositionsLine positions={p.positions} /></span><span className="text-muted">× {p.quantity}</span>
            <span className="ml-auto text-xs font-semibold text-muted">{p.when ? `On order, arrives ${p.when}` : "On order"}</span>
          </li>
        ))}
      </ul>
      {canAct && takeable.length ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          {takeable.length > 1 ? (
            <button type="button" onClick={() => setTickedIds(ticked.length === takeable.length ? new Set() : new Set(takeable.map((p) => p.id)))} className="self-start min-h-9 px-2 text-xs font-bold underline underline-offset-4" data-select-all-parts>
              {ticked.length === takeable.length ? "Unselect all" : "Select all"}
            </button>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, "").slice(0, 4))} type="password" inputMode="numeric" placeholder="Your PIN" aria-label="Your PIN" className="text-center text-xl tracking-[0.4em]" style={{ width: "8.5rem" }} data-receive-pin />
            <Button type="button" size="lg" disabled={pending || !ticked.length || pin.length !== 4} onClick={submit} data-receive-parts>
              {pending ? "Saving…" : `I've received these (${ticked.length})`}
            </Button>
          </div>
          {msg ? <span className={`text-sm font-semibold ${msg.tone === "error" ? "text-red" : "text-green"}`} role="alert">{msg.text}</span> : null}
        </div>
      ) : null}
      {received.length ? (
        <details className="border-t border-line pt-2" data-received-fold {...(takeable.length === 0 && coming.length === 0 ? { open: true } : {})}>
          <summary className="cursor-pointer min-h-10 flex items-center text-sm font-bold">Received ({received.length})</summary>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {received.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-control border border-[#7FC195] bg-[#E8F5EC] px-2 py-2" data-part-received={p.id}>
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green text-xs font-bold text-white">✓</span>
                <span className="flex flex-col"><span className="font-semibold">{p.description}</span><PositionsLine positions={p.positions} /></span><span className="text-muted">× {p.quantity}</span>
                <span className="ml-auto text-xs font-semibold text-green">Received ✓{p.receivedBy ? ` ${p.receivedBy}` : ""}{p.receivedAt ? ` · ${p.receivedAt}` : ""}</span>
              </li>
            ))}
          </ul>
        </details>
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
                  <PositionsLine positions={p.positions} />
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
