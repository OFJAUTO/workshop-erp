"use client";

import { useActionState, useState } from "react";
import { AUTO_TYPES, NOT_AUTO, type AutoConfig } from "@/lib/auto-approve-rules";
import { saveAutoApproveAction, type AutoAnswer } from "./actions";

/** THE auto-approve form (12 November 2026): the master switch with its end date, then one switch and limit per type. */
export function AutoApproveForm({ cfg, today }: { cfg: AutoConfig; today: string }) {
  const [answer, act, pending] = useActionState<AutoAnswer, FormData>(saveAutoApproveAction, null);
  const [on, setOn] = useState(cfg.on);
  const groups = Array.from(new Set(AUTO_TYPES.map((t) => t.group)));
  const box = "min-h-11 rounded-control border border-line-strong bg-white px-3 text-sm";
  return (
    <form action={act} className="flex flex-col gap-4" data-auto-form>
      <input type="hidden" name="master" value={on ? "on" : "off"} />
      <div className={`flex flex-col gap-3 rounded-card border-2 p-4 ${on ? "border-amber-bar bg-amber-soft" : "border-line bg-white"}`} data-auto-master={on ? "on" : "off"}>
        <span className="text-base font-extrabold">Auto-approve the ticked types</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setOn(true)} className={`min-h-12 min-w-24 rounded-control border-2 px-5 text-base font-extrabold ${on ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`} data-auto-on>
            ON
          </button>
          <button type="button" onClick={() => setOn(false)} className={`min-h-12 min-w-24 rounded-control border-2 px-5 text-base font-extrabold ${!on ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`} data-auto-off>
            OFF
          </button>
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Switch off by itself after (optional)</span>
          <input type="date" name="until" min={today} defaultValue={cfg.until ?? ""} className={box} data-auto-until />
        </label>
        <p className="text-xs text-muted">
          While ON, a request of a ticked type within its limit is approved at once, the advisor carries on, and it is logged as AUTO-APPROVED (OWNER AWAY). No bell to you; one summary each evening. OFF: everything comes to you again; nothing already approved is undone. Press Save after changing anything.
        </p>
      </div>
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-2" data-auto-group={g}>
          <span className="text-xs font-extrabold uppercase tracking-[0.08em] text-muted">{g}</span>
          {AUTO_TYPES.filter((t) => t.group === g).map((t) => (
            <div key={t.key} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-white p-3" data-auto-type={t.key}>
              <label className="flex min-h-11 flex-1 items-center gap-3 text-sm font-semibold">
                <input type="checkbox" name={`type_${t.key}`} defaultChecked={cfg.types[t.key]?.on ?? false} className="h-6 w-6 shrink-0" data-auto-tick={t.key} />
                <span>{t.label}</span>
              </label>
              <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>Up to AED</span>
                <input type="text" inputMode="decimal" name={`limit_${t.key}`} defaultValue={cfg.types[t.key]?.limit ?? ""} placeholder="no limit" className={`${box} w-28`} data-auto-limit={t.key} data-spell="" spellCheck={false} />
                <span>{t.figure}</span>
              </label>
            </div>
          ))}
        </div>
      ))}
      <div className="flex flex-col gap-2" data-auto-not>
        <span className="text-xs font-extrabold uppercase tracking-[0.08em] text-muted">Always comes to you</span>
        <ul className="flex flex-col gap-1 text-sm">
          {NOT_AUTO.map((n) => (
            <li key={n.label}>
              <span className="font-semibold">{n.label}</span> <span className="text-muted">– {n.why}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="min-h-12 rounded-control bg-ink px-6 text-base font-bold text-on-dark" data-auto-save>
          {pending ? "Saving…" : "Save"}
        </button>
        {answer?.error ? (
          <span className="text-sm font-semibold text-red" data-auto-error>
            {answer.error}
          </span>
        ) : null}
        {answer?.ok ? (
          <span className="text-sm font-semibold text-green-text" data-auto-saved>
            {answer.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
