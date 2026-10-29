"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, SectionLabel } from "@/components/ui";
import type { BodyshopPackage, PackageItem } from "@/lib/packages";

type Save = (payload: BodyshopPackage[]) => Promise<{ error?: string; ok?: boolean }>;

const blankItem = (): PackageItem => ({ label: "", warranty: "", only_if: null });
const blankPackage = (): BodyshopPackage => ({ key: "", name: "", time_in_workshop: "", items: [blankItem()], pickup_dropoff: true, aftercare_check: true });

/**
 * The owner's package builder: name, the included items each with its warranty, "only if the car has
 * one" questions, the estimated completion and the two complimentary lines. The advisor later picks a package
 * and types ONE price; the customer sees the list with no item prices.
 */
export function PackagesEditor({ initial, action }: { initial: BodyshopPackage[]; action: Save }) {
  const router = useRouter();
  const [packages, setPackages] = useState<BodyshopPackage[]>(initial.length ? initial : []);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const edit = (i: number, p: Partial<BodyshopPackage>) => setPackages((ps) => ps.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const editItem = (i: number, j: number, p: Partial<PackageItem>) => setPackages((ps) => ps.map((x, k) => (k === i ? { ...x, items: x.items.map((it, m) => (m === j ? { ...it, ...p } : it)) } : x)));
  const save = () => start(async () => {
    setMsg(null);
    const r = await action(packages.map((p) => ({ ...p, items: p.items.filter((i) => i.label.trim()) })));
    setMsg(r.error ? { tone: "error", text: r.error } : { tone: "success", text: "Saved." });
    if (!r.error) router.refresh();
  });
  return (
    <div className="flex flex-col gap-4">
      {packages.map((p, i) => (
        <Card key={i} className="flex flex-col gap-3" data-package-card>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-64 flex-1 flex-col gap-1"><span className="text-xs font-semibold text-muted">Package name</span><Input value={p.name} onChange={(e) => edit(i, { name: e.target.value })} placeholder="OFJ Full Protection Package" textCase="title" data-package-name /></label>
            <Button type="button" tone="ghost" size="md" onClick={() => setPackages((ps) => ps.filter((_, k) => k !== i))}>Remove package</Button>
          </div>
          <SectionLabel>What is included (no prices here: the advisor types one package price per job)</SectionLabel>
          <div className="flex flex-col gap-2">
            {p.items.map((it, j) => {
              const on = it.only_if !== null;
              return (
                // ONE tidy row per item: name · warranty · Only if (with its condition inside the row) · ×.
                // The last three travel together, so a narrow screen never strands the condition or the ×.
                <div key={j} className="flex flex-wrap items-center gap-2 lg:flex-nowrap" data-package-item>
                  <span className="min-w-0 flex-1 basis-56"><Input value={it.label} onChange={(e) => editItem(i, j, { label: e.target.value })} placeholder="Full body PPF" aria-label="Included item" textCase="sentence" /></span>
                  <span className="w-44 shrink-0"><Input value={it.warranty ?? ""} onChange={(e) => editItem(i, j, { warranty: e.target.value })} placeholder="Warranty (10 years)" aria-label="Warranty" /></span>
                  <span className="flex min-w-0 max-w-full items-center gap-2">
                    <button type="button" onClick={() => editItem(i, j, { only_if: on ? null : "the car has one" })} aria-pressed={on} className={`min-h-11 shrink-0 whitespace-nowrap rounded-control border px-3 text-xs font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-muted"}`} data-only-if-toggle>{on ? "Only if ✓" : "Only if…"}</button>
                    {on ? <span className="w-52 min-w-0 shrink"><Input value={it.only_if ?? ""} onChange={(e) => editItem(i, j, { only_if: e.target.value })} placeholder="the car has a panoramic roof" aria-label="Only if the car…" className="text-xs" data-only-if-text /></span> : null}
                    <button type="button" onClick={() => edit(i, { items: p.items.filter((_, m) => m !== j) })} className="min-h-11 min-w-11 shrink-0 rounded-control text-base font-bold text-red hover:bg-chip" aria-label="Remove item" data-item-remove>×</button>
                  </span>
                </div>
              );
            })}
            <Button type="button" tone="secondary" size="md" className="self-start" onClick={() => edit(i, { items: [...p.items, blankItem()] })}>+ Add an item</Button>
          </div>
          <label className="flex max-w-sm flex-col gap-1"><span className="text-xs font-semibold text-muted">Estimated completion (shown to the customer, under the included list)</span><Input value={p.time_in_workshop} onChange={(e) => edit(i, { time_in_workshop: e.target.value })} placeholder="3–5 working days" data-estimated-completion /></label>
          <div className="flex flex-wrap gap-5">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={p.pickup_dropoff} onChange={(e) => edit(i, { pickup_dropoff: e.target.checked })} className="h-5 w-5 accent-ink" />Complimentary pick-up &amp; drop-off</label>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={p.aftercare_check} onChange={(e) => edit(i, { aftercare_check: e.target.checked })} className="h-5 w-5 accent-ink" />Complimentary 10-day after-care check</label>
          </div>
        </Card>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" tone="secondary" size="lg" onClick={() => setPackages((ps) => [...ps, blankPackage()])} data-add-package-card>+ New package</Button>
        <Button type="button" size="lg" disabled={pending} onClick={save} data-save-packages>{pending ? "Saving…" : "Save the packages"}</Button>
        {msg ? <span className={`text-sm font-semibold ${msg.tone === "error" ? "text-red" : "text-green"}`} role="alert">{msg.text}</span> : null}
      </div>
    </div>
  );
}
