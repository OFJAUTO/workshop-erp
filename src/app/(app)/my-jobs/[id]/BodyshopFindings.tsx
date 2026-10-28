"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CarOutline } from "@/components/CarOutline";
import { Card, Input, SectionLabel, Textarea } from "@/components/ui";
import { BODY_ACTIONS, DAMAGE_TYPES, SEVERITIES, actionLabel, damageWords, panelLabel, severityLabel, toneOf } from "@/lib/car-outline";
import { LABOUR_HOUR_CHIPS } from "@/lib/inspection";
import { onPageLeave } from "@/lib/app-version";

export type BodyFindingState = { id?: string; panel: string; damage: string[]; severity: string | null; action: string | null; remark: string | null; labour_hours: number | null };
export type BodyStateProps = { findings: BodyFindingState[]; openedAt: string | null; airbags: boolean | null; structural: boolean | null; checkedAt: string | null; checkedBy: string | null };

function Chip({ on, onClick, disabled, children, hook }: { on: boolean; onClick: () => void; disabled?: boolean; children: ReactNode; hook?: string }) {
  return (
    <button type="button" disabled={disabled} aria-pressed={on} onClick={onClick} className={`min-h-10 rounded-control border px-3 text-sm font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"} disabled:opacity-60`} data-body-chip={hook}>
      {children}
    </button>
  );
}

/**
 * "+ Add bodyshop findings" at the bottom of the inspection (closed by default): the car outline, tap a panel, then
 * damage, severity, action, photos (required), a remark, internal hours and parts. The accident questions sit
 * underneath. Damaged panels turn amber (minor) or red (moderate, severe). The bodyshop manager is told at the first
 * finding and marks the assessment checked; after that only bodyshop staff and the owner change it.
 */
export function BodyshopFindings({
  inspectionId,
  initial,
  canEdit,
  canCheck,
  photos,
  parts,
}: {
  inspectionId: string;
  initial: BodyStateProps;
  canEdit: boolean;
  canCheck: boolean;
  /** The photo strip for a panel (the form's InspectionMedia with item key body.<panel>) and how many photos it has. */
  photos: (panel: string) => { node: ReactNode; count: number };
  /** The parts strip for a panel (the form's parts list with item key body.<panel>). */
  parts: (panel: string) => ReactNode;
}) {
  const [state, setState] = useState<BodyStateProps>(initial);
  const [open, setOpen] = useState(!!initial.openedAt || initial.findings.length > 0);
  const [selected, setSelected] = useState<string | null>(initial.findings[0]?.panel ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  // Saves still on their way: the server's state is taken only when the last one is back and nothing waits to be sent,
  // so an older answer never overwrites a newer tap.
  const pending = useRef(0);
  // A remark still in its 700 ms wait when the page goes away (reload, sleeping tablet) is sent at once.
  const waiting = useRef<BodyFindingState | null>(null);
  useEffect(() => onPageLeave(() => {
    if (!timer.current || !waiting.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    void fetch("/api/inspection/body", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ inspectionId, op: "save", finding: waiting.current }) }).catch(() => null);
    waiting.current = null;
  }), [inspectionId]);

  const post = (payload: Record<string, unknown>) => {
    setSaving(true);
    pending.current++;
    chain.current = chain.current.then(async () => {
      const r = await fetch("/api/inspection/body", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inspectionId, ...payload }) }).catch(() => null);
      const j = (await r?.json().catch(() => ({}))) as { error?: string; state?: BodyStateProps } | undefined;
      pending.current--;
      if (pending.current === 0) setSaving(false);
      if (!r || !r.ok) { setError(j?.error ?? "Not saved: no connection. Try again."); return; }
      setError(null);
      // The server's answer keeps the ids; the panel being typed keeps its local words.
      if (j?.state && pending.current === 0 && !timer.current) setState(j.state);
    });
  };
  const finding = (panel: string): BodyFindingState => state.findings.find((f) => f.panel === panel) ?? { panel, damage: [], severity: null, action: null, remark: null, labour_hours: null };
  const change = (panel: string, patch: Partial<BodyFindingState>, slow = false) => {
    const next = { ...finding(panel), ...patch };
    setState((s) => ({ ...s, findings: s.findings.some((f) => f.panel === panel) ? s.findings.map((f) => (f.panel === panel ? next : f)) : [...s.findings, next] }));
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (slow) {
      waiting.current = next;
      timer.current = setTimeout(() => { timer.current = null; waiting.current = null; post({ op: "save", finding: next }); }, 700);
    }
    else post({ op: "save", finding: next });
  };
  const tones = Object.fromEntries(state.findings.map((f) => [f.panel, toneOf(f)]));

  if (!open) {
    return (
      <Card className="flex flex-col items-start gap-2" id="body" data-body-findings="closed">
        <button type="button" disabled={!canEdit} onClick={() => { setOpen(true); post({ op: "open" }); }} className="min-h-12 rounded-control border-2 border-dashed border-line-strong px-4 text-sm font-bold" data-body-open>
          + Add bodyshop findings
        </button>
        <span className="text-xs text-muted">Only when the car has body damage (an accident, scratches, dents). The bodyshop manager is told and checks it.</span>
      </Card>
    );
  }

  const sel = selected ? finding(selected) : null;
  const pics = sel ? photos(sel.panel) : null;
  return (
    <Card className="flex flex-col gap-4" id="body" data-body-findings="open">
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel right={`${state.findings.length} panel${state.findings.length === 1 ? "" : "s"}`}>Bodyshop findings</SectionLabel>
        {state.checkedAt ? <span className="rounded-full bg-green-soft px-2.5 py-0.5 text-xs font-bold text-green" data-body-checked>Checked by the bodyshop{state.checkedBy ? ` · ${state.checkedBy}` : ""}</span> : state.findings.length ? <span className="rounded-full bg-amber-soft px-2.5 py-0.5 text-xs font-bold text-amber">Bodyshop manager told</span> : null}
        {saving ? <span className="text-xs text-muted">Saving…</span> : null}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[auto_minmax(0,1fr)]">
        <CarOutline tones={tones} selected={selected} onPick={setSelected} size={190} />
        <div className="flex min-w-0 flex-col gap-3">
          {!sel ? (
            <p className="text-sm text-muted">Tap a damaged panel on the car.</p>
          ) : (
            <div className="flex flex-col gap-3" data-body-editor={sel.panel}>
              <span className="text-base font-extrabold">{panelLabel(sel.panel)}</span>
              <span className="text-xs font-semibold text-muted">Damage</span>
              <div className="flex flex-wrap gap-1.5">
                {DAMAGE_TYPES.map((d) => <Chip key={d.value} hook={`damage-${d.value}`} disabled={!canEdit} on={sel.damage.includes(d.value)} onClick={() => change(sel.panel, { damage: sel.damage.includes(d.value) ? sel.damage.filter((x) => x !== d.value) : [...sel.damage, d.value] })}>{d.label}</Chip>)}
              </div>
              <span className="text-xs font-semibold text-muted">Severity</span>
              <div className="flex flex-wrap gap-1.5">
                {SEVERITIES.map((d) => <Chip key={d.value} hook={`severity-${d.value}`} disabled={!canEdit} on={sel.severity === d.value} onClick={() => change(sel.panel, { severity: sel.severity === d.value ? null : d.value })}>{d.label}</Chip>)}
              </div>
              <span className="text-xs font-semibold text-muted">Action</span>
              <div className="flex flex-wrap gap-1.5">
                {BODY_ACTIONS.map((d) => <Chip key={d.value} hook={`action-${d.value}`} disabled={!canEdit} on={sel.action === d.value} onClick={() => change(sel.panel, { action: sel.action === d.value ? null : d.value })}>{d.label}</Chip>)}
              </div>
              <div className="flex flex-col gap-1">
                <span className={`text-xs font-semibold ${pics && pics.count === 0 && state.findings.some((f) => f.panel === sel.panel) ? "text-red" : "text-muted"}`} data-body-photo-label>Photos (required)</span>
                {pics?.node}
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted">Remark</span>
                <Textarea value={sel.remark ?? ""} onChange={(e) => change(sel.panel, { remark: e.target.value }, true)} rows={2} disabled={!canEdit} textCase="sentence" data-body-remark />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-muted">Labour hours (internal, bodyshop)</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {LABOUR_HOUR_CHIPS.map((c) => <Chip key={c} hook={`hours-${c}`} disabled={!canEdit} on={sel.labour_hours === Number(c)} onClick={() => change(sel.panel, { labour_hours: sel.labour_hours === Number(c) ? null : Number(c) })}>{c}</Chip>)}
                  <Input value={sel.labour_hours === null ? "" : String(sel.labour_hours)} onChange={(e) => { const n = Number(e.target.value.replace(",", ".")); change(sel.panel, { labour_hours: e.target.value === "" || !Number.isFinite(n) ? null : n }, true); }} inputMode="decimal" disabled={!canEdit} aria-label={`${panelLabel(sel.panel)} labour hours`} style={{ width: "5rem" }} data-body-hours />
                  <span className="text-xs text-muted">h</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-muted">Parts</span>
                {parts(sel.panel)}
              </div>
              {canEdit && state.findings.some((f) => f.panel === sel.panel) ? (
                <button type="button" onClick={() => { setState((s) => ({ ...s, findings: s.findings.filter((f) => f.panel !== sel.panel) })); post({ op: "remove", panel: sel.panel }); setSelected(null); }} className="self-start text-xs font-bold text-red underline underline-offset-4" data-body-remove>Remove this finding</button>
              ) : null}
            </div>
          )}
          {state.findings.length ? (
            <ul className="flex flex-col gap-1 border-t border-line pt-2 text-sm" data-body-list>
              {state.findings.map((f) => (
                <li key={f.panel}>
                  <button type="button" onClick={() => setSelected(f.panel)} className="flex flex-wrap items-center gap-2 text-left">
                    <span className={`inline-block h-3 w-3 rounded-full ${toneOf(f) === "red" ? "bg-red-bar" : "bg-amber-bar"}`} aria-hidden />
                    <span className="font-bold">{panelLabel(f.panel)}</span>
                    <span className="text-muted">{[damageWords(f.damage), severityLabel(f.severity)].filter(Boolean).join(" · ")}{f.action ? ` → ${actionLabel(f.action)}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-line pt-3" data-body-accident>
        <span className="text-sm font-bold">Accident questions</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Airbags deployed?</span>
          {[{ v: true, l: "Yes" }, { v: false, l: "No" }].map((o) => <Chip key={o.l} hook={`airbags-${o.l.toLowerCase()}`} disabled={!canEdit} on={state.airbags === o.v} onClick={() => { const v = state.airbags === o.v ? null : o.v; setState((s) => ({ ...s, airbags: v })); post({ op: "accident", airbags: v }); }}>{o.l}</Chip>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Structural / chassis damage suspected?</span>
          {[{ v: true, l: "Yes" }, { v: false, l: "No" }].map((o) => <Chip key={o.l} hook={`structural-${o.l.toLowerCase()}`} disabled={!canEdit} on={state.structural === o.v} onClick={() => { const v = state.structural === o.v ? null : o.v; setState((s) => ({ ...s, structural: v })); post({ op: "accident", structural: v }); }}>{o.l}</Chip>)}
        </div>
        {state.structural ? <span className="self-start rounded-control bg-red-bar px-3 py-1.5 text-sm font-extrabold text-white" data-chassis-needed>CHASSIS MEASUREMENT NEEDED</span> : null}
      </div>
      {canCheck && !state.checkedAt && state.findings.length ? (
        <button type="button" onClick={() => post({ op: "checked" })} className="min-h-12 self-start rounded-control bg-ink px-4 text-sm font-bold text-white" data-body-check>Mark the bodyshop assessment checked</button>
      ) : null}
      {error ? <span className="text-sm font-semibold text-red" data-body-error>{error}</span> : null}
    </Card>
  );
}
