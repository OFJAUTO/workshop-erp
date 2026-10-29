import type { CurrentStaff } from "@/lib/auth";
import { setChequeStatus, verifyPaymentAction } from "@/app/(app)/invoices/actions";
import { getSettings, bankFeesOf } from "@/lib/settings";
import { formatWait, workingMinutesSince, workingTimeOf } from "@/lib/jobs";
import { loadWaitingOnYou, type Urgency, type WaitingItem } from "@/lib/waiting";
import { RecordDeposit, type RecordDepositData } from "./RecordDeposit";
import { markDeclinedCalled } from "@/app/(app)/jobs/declined-actions";
import { declinedFollowUps } from "@/lib/declined";
import { Button, Card, LinkButton } from "./ui";
import type { BankFees } from "@/lib/bank-fees";

export type ExtraWaiting = {
  jobId: string;
  plate: string;
  car: string | null;
  what: string;
  amount: string | null;
  actionLabel: string;
  href: string;
  /** Show even when the base list already has this job (accounts money items). */
  always?: boolean;
  /** Replaces the base next-step row of the same job: one task per job per step, never two. */
  replaces?: boolean;
  /** Red = urgent, amber = today, grey = when you can. Without it the base classifier decides. */
  urgency?: Urgency;
  /** When this became waiting, for the age line and the 24-hour escalation. */
  since?: string | null;
  /** A longer explanation, shown on hover (the line itself stays short). */
  hint?: string;
  /** The exact action right on the row instead of a link. */
  inline?: { kind: "confirm_payment"; paymentId: string } | { kind: "record_deposit"; deposit: RecordDepositData } | { kind: "cheque_clear"; paymentId: string } | { kind: "declined_called"; ids: string[] };
};

type RowItem = WaitingItem & { amount?: string | null; urgency: Urgency; inline?: ExtraWaiting["inline"] };

const URGENCY_BAR: Record<Urgency, string> = { red: "border-l-red-bar", amber: "border-l-amber-bar", grey: "border-l-line-strong" };
const URGENCY_WORD: Record<Urgency, string> = { red: "Urgent", amber: "Today", grey: "When you can" };
const URGENCY_CHIP: Record<Urgency, string> = { red: "bg-red-bar text-white", amber: "bg-amber-soft text-ink border border-amber-bar", grey: "bg-chip text-muted" };
const ORDER: Record<Urgency, number> = { red: 0, amber: 1, grey: 2 };

function Row({ i, owner, charges }: { i: RowItem; owner: boolean; charges: BankFees }) {
  return (
    <li className={`py-2 pl-3 border-l-4 ${URGENCY_BAR[i.urgency]} flex flex-wrap items-center gap-x-3 gap-y-1 text-sm`} title={i.hint} data-waiting-row data-urgency={i.urgency}>
      <span className={`inline-flex min-h-6 items-center rounded-control px-1.5 text-[10px] font-bold uppercase tracking-[0.06em] ${URGENCY_CHIP[i.urgency]}`}>{URGENCY_WORD[i.urgency]}</span>
      <span className="font-bold">{i.plate}</span>
      {i.car ? <span className="text-muted">{i.car}</span> : null}
      <span className="flex-1 min-w-[12rem]">{i.what}{i.amount ? <span className="font-bold"> · {i.amount}</span> : null}</span>
      <span className="text-xs text-muted whitespace-nowrap">{owner ? `${i.role.replace(/_/g, " ")} · ` : ""}{i.wait ? `waiting ${i.wait}` : ""}</span>
      {i.inline?.kind === "record_deposit" ? (
        <RecordDeposit d={i.inline.deposit} charges={charges} label={i.actionLabel} />
      ) : i.inline?.kind === "cheque_clear" ? (
        <form action={setChequeStatus.bind(null, i.inline.paymentId)}>
          <input type="hidden" name="status" value="cleared" />
          <input type="hidden" name="return_to" value="/dashboard" />
          <Button type="submit" size="md" data-cheque-cleared>{i.actionLabel}</Button>
        </form>
      ) : i.inline?.kind === "declined_called" ? (
        <span className="flex flex-wrap items-center gap-2">
          <LinkButton href={i.href} size="md" tone="secondary">Open</LinkButton>
          <form action={markDeclinedCalled.bind(null, i.inline.ids.join(","))}>
            <Button type="submit" size="md" data-declined-called>{i.actionLabel}</Button>
          </form>
        </span>
      ) : i.inline?.kind === "confirm_payment" ? (
        <form action={verifyPaymentAction.bind(null, i.inline.paymentId)}>
          <input type="hidden" name="return_to" value="/dashboard" />
          <Button type="submit" size="md" data-confirm-bank>{i.actionLabel}</Button>
        </form>
      ) : (
        <LinkButton href={i.href} size="md">{i.actionLabel}</LinkButton>
      )}
    </li>
  );
}

/**
 * "WAITING ON YOU (N) · n urgent": the one box at the top of every person's first page, holding everything
 * whose next step is theirs. OPEN by default whenever it has items; red (urgent) first, then amber (today),
 * then grey (when you can), oldest first within each; an amber task older than a day turns red. One line per
 * job per task, and every button opens the exact action (or does it right here). Empty: "Nothing waiting ✓".
 */
export async function WaitingPanel({ staff, extra: given = [] }: { staff: CurrentStaff; extra?: ExtraWaiting[] }) {
  const settings = await getSettings();
  // The advisor's calls about declined work, due after the set number of days (29 October 2026).
  const followUps = (await declinedFollowUps(staff)).map((d): ExtraWaiting => ({ jobId: d.jobId, plate: d.plate, car: d.car, what: d.what, amount: null, actionLabel: "Called ✓", href: d.href, always: true, urgency: "amber", since: d.since, inline: { kind: "declined_called", ids: d.ids } }));
  const extra = [...given, ...followUps];
  const items = await loadWaitingOnYou(staff, settings);
  const owner = staff.role_id === "owner";
  const charges = bankFeesOf(settings);
  const wt = workingTimeOf(settings);
  const now = new Date();
  const replaced = new Set(extra.filter((e) => e.replaces).map((e) => e.jobId));
  const have = new Set(items.map((i) => i.jobId));
  const escalate = (u: Urgency, since: string | null | undefined): Urgency => (u === "amber" && since && now.getTime() - Date.parse(since) > 24 * 3600000 ? "red" : u);
  const all: RowItem[] = [
    ...items.filter((i) => !replaced.has(i.jobId)).map((i) => ({ ...i, urgency: escalate(i.urgency, i.since) })),
    ...extra
      .filter((e) => e.always || !have.has(e.jobId))
      .map((e) => {
        const u = escalate(e.urgency ?? "amber", e.since);
        const wait = e.since ? formatWait(workingMinutesSince(e.since, wt, now), wt) : "";
        return { jobId: e.jobId, plate: e.plate, car: e.car, what: e.what, amount: e.amount, role: staff.role_id, since: e.since ?? "", wait, href: e.href, actionLabel: e.actionLabel, urgency: u, inline: e.inline, hint: e.hint ?? e.what } as RowItem;
      }),
  ].sort((a, b) => (ORDER[a.urgency] - ORDER[b.urgency]) || String(a.since).localeCompare(String(b.since)));
  if (all.length === 0) {
    return (
      <Card className="py-3" data-waiting-panel>
        <p className="text-sm font-bold text-green" data-waiting-empty>Nothing waiting ✓</p>
      </Card>
    );
  }
  const urgent = all.filter((i) => i.urgency === "red").length;
  return (
    <Card className="border-ink py-3" data-waiting-panel>
      <details open>
        <summary className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-extrabold uppercase tracking-[0.08em]" data-waiting-summary>
          Waiting on you ({all.length}){urgent ? <span className="text-red normal-case tracking-normal" data-waiting-urgent>· {urgent} urgent</span> : null}
        </summary>
        <ul className="mt-1 divide-y divide-line">
          {all.map((i, idx) => <Row key={`${i.jobId}-${idx}`} i={i} owner={owner} charges={charges} />)}
        </ul>
      </details>
    </Card>
  );
}
