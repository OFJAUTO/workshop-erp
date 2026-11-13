"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, SectionLabel } from "@/components/ui";
import { deskRowWords, type DeskPart } from "@/lib/desk-parts-rules";
import { decideDeskPartAction } from "@/app/(app)/parts/desk-part-actions";

/**
 * Parts the parts desk added to this estimate (13 November 2026, Section 5). While the estimate is being prepared the
 * advisor accepts each onto the estimate or declines it; the answer shows on the row and the desk is told. Once sent,
 * the card only lists them (a revision adds a part to a sent estimate).
 */
export function DeskPartsCard({ estimateId, parts, canDecide }: { estimateId: string; parts: DeskPart[]; canDecide: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [answers, setAnswers] = useState<Record<string, { ok?: boolean; error?: string; words?: string }>>({});
  const decide = (id: string, accept: boolean) =>
    start(async () => {
      const r = await decideDeskPartAction(estimateId, id, accept);
      setAnswers((a) => ({ ...a, [id]: r }));
      if (r.ok) router.refresh();
    });
  const waiting = parts.filter((p) => p.status === "pending").length;
  return (
    <Card id="desk-parts" className="flex scroll-mt-4 flex-col gap-2" data-desk-parts-card>
      <SectionLabel right={waiting ? `${waiting} to decide` : null}>Added by Parts</SectionLabel>
      <ul className="flex flex-col divide-y divide-line">
        {parts.map((p) => {
          const a = answers[p.id];
          return (
            <li key={p.id} className="flex flex-col gap-1.5 py-2" data-desk-part={p.id} data-desk-part-status={p.status}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold uppercase">{p.title} × {p.quantity}</span>
                {p.addedBy ? <span className="text-xs text-muted">by {p.addedBy}</span> : null}
              </div>
              <span className={`text-sm ${p.status === "accepted" ? "font-bold text-green-text" : p.status === "declined" ? "font-bold text-red" : "text-amber-text"}`} data-desk-part-words>
                {deskRowWords(p)}
              </span>
              {p.status === "pending" && canDecide ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" tone="primary" size="md" disabled={pending} onClick={() => decide(p.id, true)} data-desk-accept>Accept onto the estimate</Button>
                  <Button type="button" tone="secondary" size="md" disabled={pending} onClick={() => decide(p.id, false)} data-desk-decline>Decline</Button>
                </div>
              ) : null}
              {a?.error ? <span className="text-sm font-bold text-red" data-desk-decide-error>{a.error}</span> : null}
              {a?.ok ? <span className="text-sm font-bold text-green-text" data-desk-decided>{a.words}</span> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
