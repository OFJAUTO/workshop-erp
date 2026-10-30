"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { refreshWhenIdle } from "@/lib/refresh-idle";
import { Card, Input, SectionLabel } from "@/components/ui";
import { CopyText } from "@/components/CopyText";
import { addTintPreset, saveTintSpec } from "@/app/(app)/quotes/tint-actions";
import { aboveLimit, emptyTintSpec, sameTintSpec, SHADES, TINT_WINDOWS, tintSummary, WINDSHIELD_COVERAGE, type TintRow, type TintShade, type TintSpec, type TintWindow } from "@/lib/tint";
import { clearPending, readPending, writePending } from "@/lib/pending-draft";
import { reloadIfStale } from "@/lib/app-version";

const copyOf = (s: TintSpec): TintSpec => JSON.parse(JSON.stringify(s)) as TintSpec;
const shadeLabel = (s: TintShade) => (s === "clear" ? "Clear" : String(s));

/**
 * Section 11: the tint specification per window, ONE box used on the quotation and the estimate. Every row is
 * one tap: the coverage (the windshield: None / Clear heat-rejection / Top strip / Full), the darkness chips
 * Clear · 5 · 10 · 15 · 20 · 30 · 35 · 40 · 50 · 60 · 70, and "Extra dark – double layer". One scale: darkness %.
 * A draft saves as it is tapped; once the customer has the quotation, "Save tint change" writes it down old → new
 * and offers the prepared WhatsApp. Read only once the tint work has started (the owner can still correct it).
 */
export function TintSpecBox({
  quotationId,
  initial,
  presets: initialPresets,
  lastTime,
  limit,
  mode,
  lockedReason = null,
  isOwner,
  doubleLayerHours,
}: {
  quotationId: string;
  initial: TintSpec | null;
  presets: { name: string; spec: TintSpec }[];
  lastTime: { spec: TintSpec; from: string } | null;
  limit: number;
  /** draft: saved quietly as it is tapped. sent: the customer has it, a change is saved with its own button. */
  mode: "draft" | "sent";
  lockedReason?: string | null;
  isOwner: boolean;
  doubleLayerHours: number;
}) {
  const router = useRouter();
  const [spec, setSpec] = useState<TintSpec>(() => (initial ? copyOf(initial) : emptyTintSpec()));
  const [saved, setSaved] = useState<TintSpec | null>(initial);
  const [state, setState] = useState<{ kind: "idle" | "saving" | "saved" | "error"; text?: string }>({ kind: "idle" });
  const [whatsapp, setWhatsapp] = useState<{ message: string; phone: string | null } | null>(null);
  const [presets, setPresets] = useState(initialPresets);
  const [presetName, setPresetName] = useState<string | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const readOnly = !!lockedReason;
  // A tint change typed but never saved comes back and is saved.
  useEffect(() => {
    const d = readPending<TintSpec>(`tint:${quotationId}`);
    if (!d || readOnly || mode !== "draft") return;
    const t = setTimeout(() => change(d), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dirty = !sameTintSpec(spec, saved ?? emptyTintSpec());

  function persist(next: TintSpec) {
    setState({ kind: "saving" });
    chain.current = chain.current.then(async () => {
      const r = await saveTintSpec(quotationId, next).catch((e) => ({ error: reloadIfStale(e) ? "A new version is loading…" : "Not saved: no connection. Tap again." }) as { error: string });
      if ("error" in r && r.error) {
        setState({ kind: "error", text: r.error });
        return;
      }
      const ok = r as { logged?: boolean; message?: string | null; phone?: string | null };
      clearPending(`tint:${quotationId}`);
      setSaved(next);
      setState({ kind: "saved", text: ok.logged ? "Saved and written down" : "Saved" });
      if (ok.message) setWhatsapp({ message: ok.message, phone: ok.phone ?? null });
      refreshWhenIdle(() => router.refresh());
    });
  }

  function change(next: TintSpec) {
    if (readOnly) return;
    setSpec(next);
    setWhatsapp(null);
    if (mode === "draft") {
      writePending(`tint:${quotationId}`, next);
      if (timer.current) clearTimeout(timer.current);
      setState({ kind: "saving" });
      timer.current = setTimeout(() => persist(next), 450);
    } else setState({ kind: "idle" });
  }

  const setRow = (k: TintWindow, row: Partial<TintRow>) => {
    const next = copyOf(spec);
    next.rows[k] = { ...next.rows[k], ...row };
    change(next);
  };

  const over = aboveLimit(spec, limit);
  const summary = tintSummary(spec, limit);
  const doubled = TINT_WINDOWS.filter((w) => spec.rows[w.key].on && spec.rows[w.key].double && (w.key !== "roof" || spec.roofFitted)).length;
  const ws = spec.rows.windshield;
  const wsCoverage: "none" | "clear" | "strip" | "full" = !ws.on ? "none" : (ws.coverage ?? (ws.shade === "clear" ? "clear" : "full"));
  const wsMissing = ws.on && wsCoverage === "full" && (ws.shade === null || ws.shade === "clear");

  const pickShade = (k: TintWindow, s: TintShade) => {
    const row = spec.rows[k];
    setRow(k, { on: true, shade: s, double: s === "clear" ? false : row.double, ...(k === "windshield" ? { coverage: row.coverage ?? "full" } : {}) });
  };
  const pickCoverage = (key: "none" | "clear" | "strip" | "full") =>
    setRow("windshield", key === "none" ? { on: false, coverage: undefined, shade: null, double: false } : key === "clear" ? { on: true, coverage: "clear", shade: "clear", double: false } : { on: true, coverage: key, shade: typeof ws.shade === "number" ? ws.shade : null });
  const setRoofFitted = (fitted: boolean) => {
    const next = copyOf(spec);
    next.roofFitted = fitted;
    if (!fitted) next.rows.roof = { on: false, shade: null, double: false };
    change(next);
  };

  return (
    <Card className="flex flex-col gap-3" data-tint-box data-tint-mode={mode}>
      <SectionLabel right={state.kind === "saving" ? "Saving…" : state.kind === "saved" ? `${state.text} ✓` : undefined}>Tint specification</SectionLabel>
      <p className="text-xs text-muted">Darkness %: the higher the number, the darker the glass. Legal limit {limit}% darkness; anything darker is the customer&apos;s request, and the customer ticks it on the quotation.</p>
      {lockedReason ? <p className="rounded-control bg-chip px-3 py-2 text-xs font-semibold" data-tint-locked>{lockedReason}</p> : null}

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-2" data-tint-presets>
          {presets.map((p) => (
            <button key={p.name} type="button" onClick={() => change(copyOf(p.spec))} title={tintSummary(p.spec) ?? ""} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-xs font-bold" data-tint-preset={p.name}>{p.name}</button>
          ))}
          {lastTime ? (
            <button type="button" onClick={() => change(copyOf(lastTime.spec))} title={tintSummary(lastTime.spec) ?? ""} className="flex min-h-11 flex-col items-start justify-center rounded-control border border-line-strong bg-white px-3 text-left" data-tint-last-time>
              <span className="text-xs font-bold">Same as last time</span>
              <span className="text-[10px] text-muted">{lastTime.from}</span>
            </button>
          ) : null}
          <button type="button" onClick={() => change(emptyTintSpec())} className="min-h-11 rounded-control px-2 text-xs font-semibold underline underline-offset-4" data-tint-clear>Clear all</button>
        </div>
      ) : null}

      <div className="flex flex-col divide-y divide-line">
        <div className="flex flex-col gap-1.5 py-2" data-tint-row="windshield">
          <span className="text-sm font-bold">Windshield</span>
          <div className="flex flex-wrap gap-1.5">
            {WINDSHIELD_COVERAGE.map((c) => <Chip key={c.key} on={wsCoverage === c.key} label={c.label} data={`windshield:${c.key}`} disabled={readOnly} onClick={() => pickCoverage(c.key)} />)}
          </div>
          {ws.on && (wsCoverage === "strip" || wsCoverage === "full") ? (
            <div className="flex flex-wrap items-center gap-1.5 pl-0 sm:pl-4">
              <span className="text-[11px] font-semibold text-muted">{wsCoverage === "strip" ? "Strip darkness %" : "Darkness %"}</span>
              <ShadeChips k="windshield" row={ws} withClear={false} limit={limit} disabled={readOnly} onPick={(s) => pickShade("windshield", s)} />
              <DoubleTick k="windshield" row={ws} disabled={readOnly} onChange={(v) => setRow("windshield", { double: v })} />
            </div>
          ) : null}
          {wsMissing ? <span className="text-xs font-semibold text-amber">Choose the windshield darkness.</span> : null}
        </div>
        {TINT_WINDOWS.filter((w) => w.key !== "windshield" && w.key !== "roof").map((w) => {
          const row = spec.rows[w.key];
          return (
            <div key={w.key} className="flex flex-col gap-1.5 py-2" data-tint-row={w.key}>
              <span className="text-sm font-bold">{w.label} <span className="text-[11px] font-semibold text-muted">darkness %</span></span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip on={!row.on} label="Not needed" data={`${w.key}:none`} disabled={readOnly} onClick={() => setRow(w.key, { on: false, shade: null, double: false })} />
                <ShadeChips k={w.key} row={row} withClear limit={limit} disabled={readOnly} onPick={(s) => pickShade(w.key, s)} />
              </div>
              <DoubleTick k={w.key} row={row} disabled={readOnly} onChange={(v) => setRow(w.key, { double: v })} />
            </div>
          );
        })}
        <div className="flex flex-col gap-1.5 py-2" data-tint-row="roof">
          <span className="text-sm font-bold">Sunroof / panoramic roof</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip on={!spec.roofFitted} label="Car has none" data="roof:not-fitted" disabled={readOnly} onClick={() => setRoofFitted(false)} />
            <Chip on={spec.roofFitted} label="Car has one" data="roof:fitted" disabled={readOnly} onClick={() => setRoofFitted(true)} />
          </div>
          {spec.roofFitted ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip on={!spec.rows.roof.on} label="Not needed" data="roof:none" disabled={readOnly} onClick={() => setRow("roof", { on: false, shade: null, double: false })} />
                <ShadeChips k="roof" row={spec.rows.roof} withClear limit={limit} disabled={readOnly} onPick={(s) => pickShade("roof", s)} />
              </div>
              <DoubleTick k="roof" row={spec.rows.roof} disabled={readOnly} onChange={(v) => setRow("roof", { double: v })} />
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-control bg-chip px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">On the documents</span>
        <span className="text-sm font-semibold" data-tint-summary>{summary ?? "No window tint chosen yet."}</span>
        {doubled ? <span className="text-xs text-muted" data-tint-double-note>{doubled} window{doubled === 1 ? "" : "s"} double layer: double film and {Math.round(doubled * doubleLayerHours * 100) / 100} h more fitting.</span> : null}
      </div>
      {over.length ? (
        <p className="rounded-control border border-amber-bar px-3 py-2 text-xs" data-tint-above-limit>
          <span className="font-bold">Above the legal limit – customer&apos;s request:</span> {over.map((o) => `${o.label} ${o.shade}% darkness`).join(", ")}. {mode === "draft" ? "The customer ticks this when approving the quotation." : "The customer is told in the updated tint message."}
        </p>
      ) : null}

      {mode === "sent" && !readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!dirty || state.kind === "saving"} onClick={() => persist(spec)} className="min-h-11 rounded-control bg-ink px-4 text-sm font-bold text-white disabled:opacity-40" data-tint-save>Save tint change</button>
          {dirty ? <button type="button" onClick={() => { setSpec(saved ? copyOf(saved) : emptyTintSpec()); setState({ kind: "idle" }); }} className="min-h-11 px-2 text-xs font-semibold underline underline-offset-4">Undo</button> : null}
          {dirty ? <span className="text-xs text-muted">The customer already has this quotation: the change is written down and a message is prepared.</span> : null}
        </div>
      ) : null}
      {state.kind === "error" ? <p className="text-xs font-semibold text-red" data-tint-error>{state.text}</p> : null}
      {whatsapp ? (
        <div className="flex flex-col gap-2 rounded-control border border-ink px-3 py-2" data-tint-whatsapp-box>
          <span className="text-xs font-bold">Tell the customer</span>
          <p className="whitespace-pre-wrap text-xs" data-tint-message>{whatsapp.message}</p>
          <div className="flex flex-wrap gap-2">
            <a href={`https://wa.me/${whatsapp.phone ?? ""}?text=${encodeURIComponent(whatsapp.message)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-white" data-tint-whatsapp>Send on WhatsApp</a>
            <CopyText text={whatsapp.message} />
          </div>
        </div>
      ) : null}

      {isOwner && !readOnly ? (
        presetName === null ? (
          <button type="button" onClick={() => setPresetName("")} className="self-start text-xs font-semibold underline underline-offset-4" data-tint-preset-add>Save as a preset</button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Preset name, for example Dark rear" aria-label="Preset name" className="min-w-56" style={{ width: "16rem" }} data-tint-preset-name />
            <button type="button" onClick={async () => { const r = await addTintPreset(presetName, spec); if (r.error) setState({ kind: "error", text: r.error }); else { setPresets(r.presets ?? presets); setPresetName(null); setState({ kind: "saved", text: "Preset saved" }); } }} className="min-h-11 rounded-control bg-ink px-4 text-sm font-bold text-white" data-tint-preset-save>Save preset</button>
            <button type="button" onClick={() => setPresetName(null)} className="min-h-11 px-2 text-xs font-semibold underline underline-offset-4">Cancel</button>
          </div>
        )
      ) : null}
    </Card>
  );
}

function Chip({ on, label, data, disabled, warn = false, limit = 0, onClick }: { on: boolean; label: string; data: string; disabled: boolean; warn?: boolean; limit?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      onClick={onClick}
      data-tint-chip={data}
      title={warn ? `Above the legal limit (${limit}% darkness)` : undefined}
      className={`min-h-11 min-w-11 rounded-control border px-2.5 text-xs font-bold ${on ? "border-ink bg-ink text-white" : warn ? "border-dashed border-line-strong bg-white" : "border-line-strong bg-white"} disabled:opacity-60`}
    >
      {label}
    </button>
  );
}

/** The darkness chips of one window: Clear · 5 · 10 · … · 70 (dashed when darker than the legal limit). */
function ShadeChips({ k, row, withClear, limit, disabled, onPick }: { k: TintWindow; row: TintRow; withClear: boolean; limit: number; disabled: boolean; onPick: (s: TintShade) => void }) {
  return (
    <>
      {SHADES.filter((s) => withClear || s !== "clear").map((s) => (
        <Chip key={String(s)} on={row.on && row.shade === s} label={shadeLabel(s)} data={`${k}:${s}`} disabled={disabled} warn={typeof s === "number" && s > limit} limit={limit} onClick={() => onPick(s)} />
      ))}
    </>
  );
}

function DoubleTick({ k, row, disabled, onChange }: { k: TintWindow; row: TintRow; disabled: boolean; onChange: (v: boolean) => void }) {
  const off = !row.on || row.shade === null || row.shade === "clear";
  return (
    <label className={`flex min-h-11 items-center gap-2 text-xs font-semibold ${off ? "text-muted" : ""}`}>
      <input type="checkbox" className="h-5 w-5 accent-ink" checked={row.double} disabled={disabled || off} onChange={(e) => onChange(e.target.checked)} data-tint-double={k} />
      Extra dark – double layer
    </label>
  );
}
