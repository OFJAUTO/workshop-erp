"use client";

import { useActionState, useState } from "react";
import { Badge, Button, Input } from "@/components/ui";
import { historyWords, RETURN_ENDING_LABEL, type EndingHistoryEntry, type ReturnEndingChoices, type ReturnEndingKey } from "@/lib/return-ending-rules";
import type { EndingAnswerState } from "@/app/(app)/parts/return-ending-actions";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export type ReturnEndingProps = {
  partId: string;
  name: string;
  value: number;
  paid: number;
  ending: ReturnEndingKey | null;
  endingWords: string | null;
  endedBy: string | null;
  advance: { amount: number; status: string } | null;
  choices: ReturnEndingChoices;
  history: EndingHistoryEntry[];
  wrong: string | null;
  /** Accounts and the owner: may correct and confirm advances. */
  isAccounts: boolean;
  ready: boolean;
  save: (s: EndingAnswerState, f: FormData) => Promise<EndingAnswerState>;
  correct: (s: EndingAnswerState, f: FormData) => Promise<EndingAnswerState>;
  confirm: (s: EndingAnswerState, f: FormData) => Promise<EndingAnswerState>;
};

function Answer({ state }: { state: EndingAnswerState }) {
  if (!state) return null;
  return state.error ? <p className="rounded-control bg-red-soft px-3 py-2 text-sm font-semibold text-red" data-return-ending-error>{state.error}</p> : <p className="rounded-control bg-green-soft px-3 py-2 text-sm font-semibold" data-return-ending-done>{state.words}</p>;
}

/** The choices as radio rows: nothing is picked for you; a greyed row says why. */
function Options({ choices, value, onPick, hook }: { choices: ReturnEndingChoices; value: string; onPick: (k: string) => void; hook: string }) {
  return (
    <div className="flex flex-col gap-1.5" {...{ [hook]: "" }}>
      {choices.options.map((o) => (
        <label key={o.key} className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-control border px-3 py-2 text-sm ${value === o.key ? "border-ink bg-panel" : "border-line"} ${o.allowed ? "" : "cursor-not-allowed opacity-55"}`} data-ending-option={o.key} data-allowed={o.allowed ? "yes" : "no"}>
          <input type="radio" name="ending" value={o.key} disabled={!o.allowed} checked={value === o.key} onChange={() => onPick(o.key)} className="mt-1 h-4 w-4" />
          <span className="flex flex-col">
            <span className="font-bold">{o.label}</span>
            <span className="text-xs text-muted">{o.allowed ? o.help : o.why}</span>
            <span className="text-xs text-muted">{o.who}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * HOW A PURCHASE RETURN ENDS (20 November 2026, Section 1): ONE box for a returned part, on the LPO and on Returns and
 * leftovers. It shows what the return ended as, the ending the facts suggest (never pre-ticked), the choices with why
 * one is greyed, the advance accounts confirm, "Correct how this return was settled" with a reason, and the history.
 */
export function ReturnEnding(p: ReturnEndingProps) {
  const [pick, setPick] = useState("");
  const [fix, setFix] = useState("");
  const [fixOpen, setFixOpen] = useState(!!p.wrong);
  const [saved, saveAction, saving] = useActionState(p.save, null);
  const [corrected, correctAction, correcting] = useActionState(p.correct, null);
  const [confirmed, confirmAction, confirming] = useActionState(p.confirm, null);
  const fixChoices: ReturnEndingChoices = { ...p.choices, options: p.choices.options.filter((o) => o.key !== p.ending || (o.key === "credit_note" && !!p.wrong)) };
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line bg-white p-3" data-return-ending={p.partId}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{p.name}</span>
        <span className="text-xs text-muted">going back {aed(p.value)}{p.paid > 0 ? ` · paid ${aed(p.paid)}` : " · nothing paid"}</span>
        {p.endingWords ? <Badge tone={p.wrong ? "red" : "neutral"} data-return-ending-words>{p.endingWords}</Badge> : <Badge tone="amber" data-return-ending-words>How did this return end?</Badge>}
        {p.endedBy ? <span className="text-xs text-muted">by {p.endedBy}</span> : null}
      </div>
      {!p.ready ? <p className="text-xs text-muted" data-return-ending-dormant>Choosing how a return ends is waiting for the database update (on the WAITING FOR APPLY list).</p> : null}
      {p.wrong ? (
        <div className="flex flex-wrap items-center gap-2 rounded-control bg-red-soft px-3 py-2 text-sm" data-return-ending-wrong>
          <span className="flex-1 font-semibold text-red">{p.wrong}</span>
          {p.isAccounts ? <Button type="button" size="md" onClick={() => setFixOpen(true)} data-return-ending-fix>Correct how this return was settled</Button> : <span className="text-xs">Accounts or the owner correct it.</span>}
        </div>
      ) : null}
      {p.ready && !p.ending && p.choices.refusal ? <p className="text-sm text-muted" data-return-ending-refusal>{p.choices.refusal}</p> : null}
      {p.ready && !p.ending && !p.choices.refusal ? (
        <form action={saveAction} className="flex flex-col gap-2" data-return-ending-form>
          {p.choices.suggestedWords ? <p className="text-sm" data-return-ending-suggested><span className="font-bold">Suggested:</span> {p.choices.suggestedWords}</p> : null}
          <Options choices={p.choices} value={pick} onPick={setPick} hook="data-return-ending-options" />
          {pick === "advance" ? <label className="flex flex-col gap-1 text-sm">Amount that stays with the supplier<Input name="advance" defaultValue={Math.min(p.value, p.paid).toFixed(2)} inputMode="decimal" spell={false} data-return-ending-advance /></label> : null}
          <label className="flex flex-col gap-1 text-sm">Note (optional)<Input name="note" placeholder="e.g. the supplier's return slip number" data-return-ending-note /></label>
          <div><Button type="submit" disabled={!pick || saving} data-return-ending-save>{saving ? "Saving…" : "Save how it ended"}</Button></div>
          <Answer state={saved} />
        </form>
      ) : null}
      {p.ready && p.ending === "advance" && p.advance?.status === "asked" ? (
        p.isAccounts ? (
          <form action={confirmAction} className="flex flex-wrap items-end gap-2 rounded-control bg-panel px-3 py-2" data-return-advance-confirm>
            <label className="flex flex-col gap-1 text-sm">Advance with the supplier<Input name="amount" defaultValue={p.advance.amount.toFixed(2)} inputMode="decimal" spell={false} className="w-32" data-return-advance-amount /></label>
            <Button type="submit" disabled={confirming} data-return-advance-confirm-save>{confirming ? "Saving…" : `Confirm the advance`}</Button>
            <Answer state={confirmed} />
          </form>
        ) : (
          <p className="text-sm text-muted" data-return-advance-asked>Advance of {aed(p.advance.amount)} asked: accounts confirm it.</p>
        )
      ) : null}
      {p.ready && p.ending && p.isAccounts ? (
        <div className="flex flex-col gap-2">
          {!fixOpen ? <div><Button type="button" tone="ghost" size="md" onClick={() => setFixOpen(true)} data-return-ending-correct-open>Correct how this return was settled</Button></div> : (
            <form action={correctAction} className="flex flex-col gap-2 rounded-control border border-line-strong p-3" data-return-ending-correct>
              <p className="text-sm font-bold">Correct how this return was settled</p>
              <p className="text-xs text-muted">The return stays. The old ending{p.ending === "credit_note" ? " and its credit note" : ""} are kept in the history, voided.</p>
              <Options choices={fixChoices} value={fix} onPick={setFix} hook="data-return-ending-correct-options" />
              {fix === "advance" ? <label className="flex flex-col gap-1 text-sm">Amount that stays with the supplier<Input name="advance" defaultValue={Math.min(p.value, p.paid).toFixed(2)} inputMode="decimal" spell={false} /></label> : null}
              <label className="flex flex-col gap-1 text-sm">Why it is corrected<Input name="reason" required minLength={5} data-return-ending-reason /></label>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!fix || correcting} data-return-ending-correct-save>{correcting ? "Saving…" : "Save the correction"}</Button>
                <Button type="button" tone="ghost" size="md" onClick={() => setFixOpen(false)}>Cancel</Button>
              </div>
              <Answer state={corrected} />
            </form>
          )}
        </div>
      ) : null}
      {p.history.length ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted" data-return-ending-history>
          {p.history.map((h, i) => <li key={i}>{historyWords(h, when)}</li>)}
        </ul>
      ) : null}
      {p.ending ? <span className="sr-only">{RETURN_ENDING_LABEL[p.ending]}</span> : null}
    </div>
  );
}
