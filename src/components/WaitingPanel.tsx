import type { CurrentStaff } from "@/lib/auth";
import { loadChargeEntries } from "@/lib/charges";
import { pendingDays } from "@/lib/charge-rules";
import { setChequeStatus, verifyPaymentAction } from "@/app/(app)/invoices/actions";
import { getSettings, bankFeesOf } from "@/lib/settings";
import { formatWait, workingMinutesSince, workingTimeOf } from "@/lib/jobs";
import { loadWaitingOnYou, type Urgency, type WaitingItem } from "@/lib/waiting";
import { RecordDeposit, type RecordDepositData } from "./RecordDeposit";
import { markDeclinedCalled } from "@/app/(app)/jobs/declined-actions";
import { declinedFollowUps } from "@/lib/declined";
import { handbacksFor } from "@/lib/quote-lead";
import { Button, Card, LinkButton } from "./ui";
import type { BankFees } from "@/lib/bank-fees";
import { reportWaitingItems } from "@/lib/payment-reports";
import { PaymentReportActions } from "./PaymentReport";
import { reasonsFor } from "@/lib/reasons";
import { isUuid } from "@/lib/uuid";
import { createAdminClient } from "@/lib/supabase/admin";
import { workingHoursBetween } from "@/lib/working-time";
import { jobMoneyMany } from "@/lib/customer-money";
import { CUSTOMER_WAITS_IN, customerWaitHoursOf, oldRuleRed, promiseMoment, urgentReason, waitingHeader } from "@/lib/urgent-rule";
import { isTestEnvironment } from "@/lib/environment";

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
  /** Amber = today, grey = when you can. Red comes ONLY from the urgent rule (money, promised date, customer waiting). */
  urgency?: Urgency;
  /** Words for money at risk on this item (makes it urgent): "cash AED 500.00 taken, not banked yet". */
  money?: string | null;
  /** This task keeps a customer waiting (urgent after the set working hours). */
  customerWaiting?: boolean;
  /** When this became waiting, for the age line and the customer-waiting hours. */
  since?: string | null;
  /** A longer explanation, shown on hover (the line itself stays short). */
  hint?: string;
  /** The exact action right on the row instead of a link. */
  inline?: { kind: "confirm_payment"; paymentId: string } | { kind: "record_deposit"; deposit: RecordDepositData } | { kind: "cheque_clear"; paymentId: string } | { kind: "declined_called"; ids: string[] } | { kind: "payment_report"; reportId: string; jobId: string; thumb: string | null; url: string | null; contentType?: string | null; path?: string | null; label: string };
};

type RowItem = WaitingItem & { amount?: string | null; urgency: Urgency; inline?: ExtraWaiting["inline"]; /** Why it is urgent, in words. */ why?: string | null };

const URGENCY_BAR: Record<Urgency, string> = { red: "border-l-red-bar", amber: "border-l-amber-bar", grey: "border-l-line-strong" };
const URGENCY_WORD: Record<Urgency, string> = { red: "Urgent", amber: "Today", grey: "When you can" };
const URGENCY_CHIP: Record<Urgency, string> = { red: "bg-red-bar text-on-dark", amber: "bg-amber-soft text-ink border border-amber-bar", grey: "bg-chip text-muted" };
const ORDER: Record<Urgency, number> = { red: 0, amber: 1, grey: 2 };

function Row({ i, owner, charges, jobCard, readOnly, queryReasons }: { i: RowItem; owner: boolean; charges: BankFees; /** Accounts have no Jobs menu: every car row also opens its job card (2 November 2026). */ jobCard: string | null; readOnly: boolean; queryReasons: string[] }) {
  return (
    <li className={`py-2 pl-3 border-l-4 ${URGENCY_BAR[i.urgency]} flex flex-wrap items-center gap-x-3 gap-y-1 text-sm`} title={i.hint} data-waiting-row data-waiting-job={i.jobId} data-urgency={i.urgency}>
      <span className={`inline-flex min-h-6 items-center rounded-control px-1.5 text-xs font-bold uppercase tracking-[0.06em] ${URGENCY_CHIP[i.urgency]}`}>{URGENCY_WORD[i.urgency]}</span>
      <span className="font-bold">{i.plate}</span>
      {i.car ? <span className="text-muted">{i.car}</span> : null}
      <span className="flex-1 min-w-[12rem]">
        {i.what}{i.amount ? <span className="font-bold"> · {i.amount}</span> : null}
        {i.why ? <span className="block text-xs font-bold text-red" data-urgent-why>{i.why}</span> : null}
      </span>
      <span className="text-xs text-muted whitespace-nowrap">{owner ? `${i.role.replace(/_/g, " ")} · ` : ""}{i.wait ? `waiting ${i.wait}` : ""}</span>
      {jobCard ? <LinkButton href={jobCard} size="md" tone="ghost" data-waiting-job-card>Job card</LinkButton> : null}
      {i.inline?.kind === "payment_report" ? (
        <PaymentReportActions reportId={i.inline.reportId} jobId={i.inline.jobId} thumb={i.inline.thumb} url={i.inline.url} contentType={i.inline.contentType ?? null} path={i.inline.path ?? null} label={i.inline.label} readOnly={readOnly} actionLabel={i.actionLabel} reasons={queryReasons} />
      ) : i.inline?.kind === "record_deposit" ? (
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
 * "WAITING ON YOU · N · n URGENT": the one bar at the top of every person's first page, holding everything
 * whose next step is theirs. CLOSED by default (a tap opens it); red (urgent) first, then amber (today),
 * then grey (when you can), oldest first within each. Red ONLY by THE urgent rule (src/lib/urgent-rule.ts), each with
 * its reason; nothing turns red just by getting old (9 November 2026). One line per
 * job per task, and every button opens the exact action (or does it right here). Empty: "Nothing waiting ✓".
 */
export async function WaitingPanel({ staff, extra: given = [] }: { staff: CurrentStaff; extra?: ExtraWaiting[] }) {
  const settings = await getSettings();
  // The advisor's calls about declined work, due after the set number of days (29 October 2026).
  const followUps = (await declinedFollowUps(staff)).map((d): ExtraWaiting => ({ jobId: d.jobId, plate: d.plate, car: d.car, what: d.what, amount: null, actionLabel: "Called ✓", href: d.href, always: true, urgency: "amber", since: d.since, inline: { kind: "declined_called", ids: d.ids } }));
  // 1 November 2026 (E-00055): estimates and quotations the owner approved or edited, back with their advisor.
  const handbacks = (await handbacksFor(staff)).map((h): ExtraWaiting => ({ jobId: `quote:${h.id}`, plate: h.plate, car: h.car, what: `${h.kind === "estimate" ? "ESTIMATE" : "QUOTATION"} ${h.number} · ${h.words}${h.summary ? ` · ${h.summary}` : ""}`, amount: null, actionLabel: "Open", href: h.href, always: true, urgency: "amber", customerWaiting: true, since: h.since, hint: h.summary }));
  // Pending charges (1 November 2026): unpaid after the set days, the advisor who added them (the owner sees all) is reminded.
  const remindDays = Number((settings as unknown as Record<string, unknown>).pending_charges_reminder_days) || 7;
  const pendingCharges = ["owner", "service_advisor", "accounts"].includes(staff.role_id)
    ? (await loadChargeEntries({ status: "pending" })).filter((e) => pendingDays(e.created_at) >= remindDays && (staff.role_id !== "service_advisor" || e.created_by === staff.id)).map((e): ExtraWaiting => ({ jobId: `pc:${e.id}`, plate: e.plate ?? e.customer, car: e.car, what: `Pending charge ${pendingDays(e.created_at)} days · ${e.what}`, amount: `AED ${e.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`, actionLabel: "Open", href: `/pending-charges?open=${e.id}`, always: true, urgency: "amber", since: e.created_at, hint: "Not in the workshop: collect it (send the proforma again, or at the next visit)." }))
    : [];
  // 2 November 2026, section 3: payments advisors sent to accounts (accounts and the owner record or query them; an
  // advisor sees his own that came back with a query).
  const reports = await reportWaitingItems(staff, settings);
  const extra = [...given, ...followUps, ...handbacks, ...pendingCharges, ...reports];
  const items = await loadWaitingOnYou(staff, settings);
  const owner = staff.role_id === "owner";
  const charges = bankFeesOf(settings);
  const queryReasons = reasonsFor(settings, "payment_query");
  const wt = workingTimeOf(settings);
  const now = new Date();
  const replaced = new Set(extra.filter((e) => e.replaces).map((e) => e.jobId));
  const have = new Set(items.map((i) => i.jobId));
  // THE urgent rule (9 November 2026): the facts of every real job on the list, read once.
  const limit = customerWaitHoursOf(settings as unknown as Record<string, unknown>);
  const jobIds = [...new Set([...items.map((i) => i.jobId), ...extra.map((e) => e.jobId)].filter(isUuid))];
  const { data: jobRows } = jobIds.length ? await createAdminClient().from("jobs").select("id, status, promised_at").in("id", jobIds) : { data: [] as { id: string; status: string; promised_at: string | null }[] };
  const jobOf = new Map(((jobRows ?? []) as { id: string; status: string; promised_at: string | null }[]).map((j) => [j.id, j]));
  const doneIds = [...jobOf.values()].filter((j) => ["ready", "pending_payment", "in_delivery"].includes(j.status)).map((j) => j.id);
  const money = doneIds.length ? await jobMoneyMany(doneIds, settings) : new Map();
  const owedWords = (id: string): string | null => {
    const j = jobOf.get(id);
    const m = money.get(id);
    if (!j || !m || !(Number(m.balance) > 0.009)) return null;
    const where = j.status === "in_delivery" ? "the car is out for delivery" : "the car is ready to collect";
    return `AED ${Number(m.balance).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} still owed and ${where}`;
  };
  const decide = (base: Urgency, jobId: string, since: string | null | undefined, extraFacts: { money?: string | null; customerWaiting?: boolean }): { urgency: Urgency; why: string | null } => {
    const j = jobOf.get(jobId);
    const waitedHours = since ? workingHoursBetween(since, now, wt) : null;
    const due = j?.promised_at ? promiseMoment(j.promised_at, null, wt.closeHour) : null;
    const why = urgentReason({
      status: j?.status ?? null,
      money: extraFacts.money ?? (j ? owedWords(jobId) : null),
      promisedAt: due,
      hoursToPromise: due ? (Date.parse(due) < now.getTime() ? -1 : workingHoursBetween(now, due, wt)) : null,
      customerWaiting: extraFacts.customerWaiting ?? (j ? CUSTOMER_WAITS_IN.has(j.status) : false),
      waitedHours,
    }, limit);
    return { urgency: why ? "red" : base === "red" ? "amber" : base, why };
  };
  const all: RowItem[] = [
    // An LPO line from the extras names the LPO itself: the job line saying the same is left out.
    ...items.filter((i) => !replaced.has(i.jobId) && !(i.what === "LPO waiting for approval" && extra.some((e) => e.jobId.startsWith("lpo:")))).map((i) => ({ ...i, ...decide(i.urgency, i.jobId, i.since, {}) })),
    ...extra
      .filter((e) => e.always || !have.has(e.jobId))
      .map((e) => {
        const d = decide(e.urgency ?? "amber", e.jobId, e.since, { money: e.money ?? null, customerWaiting: e.customerWaiting });
        const wait = e.since ? formatWait(workingMinutesSince(e.since, wt, now), wt) : "";
        return { jobId: e.jobId, plate: e.plate, car: e.car, what: e.what, amount: e.amount, role: staff.role_id, since: e.since ?? "", wait, href: e.href, actionLabel: e.actionLabel, urgency: d.urgency, why: d.why, inline: e.inline, hint: e.hint ?? e.what } as RowItem;
      }),
  ].sort((a, b) => (ORDER[a.urgency] - ORDER[b.urgency]) || String(a.since).localeCompare(String(b.since)));
  if (all.length === 0) {
    return (
      <Card className="py-2.5" data-waiting-panel>
        <p className="flex min-h-11 items-center text-sm font-extrabold uppercase tracking-[0.08em] text-green-text" data-waiting-empty>Nothing waiting ✓</p>
      </Card>
    );
  }
  const urgent = all.filter((i) => i.urgency === "red").length;
  // The test server only: how many the rule before 9 November 2026 would have made red (for the before/after report).
  const oldUrgent = isTestEnvironment()
    ? all.filter((i) => oldRuleRed({ actorRole: i.status !== undefined ? i.role : null, status: jobOf.get(i.jobId)?.status ?? null, line: i.what, since: i.since || null, wasRedBefore: /^Money at risk/.test(i.why ?? "") || /^Deposit to record/.test(i.what) }, now.getTime())).length
    : undefined;
  // CLOSED by default (29 October 2026, batch 2 section 3): one slim bar, red and bold when anything is urgent. A tap
  // anywhere on it opens the list; the counts keep updating live while it is closed (the page's live refresh).
  return (
    <Card className={`py-2.5 ${urgent ? "!border-red-bar" : "border-ink"}`} data-waiting-panel data-waiting-count={all.length} data-waiting-urgent-count={urgent} data-waiting-urgent-old={oldUrgent}>
      <details className="group">
        <summary className={`flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 text-sm font-extrabold uppercase tracking-[0.08em] [&::-webkit-details-marker]:hidden ${urgent ? "text-red" : "text-ink"}`} data-waiting-summary data-urgent={urgent ? "true" : "false"}>
          <span>
            Waiting on you · <span data-waiting-header>{waitingHeader(all.length, urgent)}</span>
            {urgent ? <span data-waiting-urgent hidden /> : null}
          </span>
          <span className="ml-auto normal-case tracking-normal underline underline-offset-4">
            <span className="group-open:hidden" data-waiting-see>See list ▾</span>
            <span className="hidden group-open:inline" data-waiting-hide>Hide list ▴</span>
          </span>
        </summary>
        <ul className="mt-1 divide-y divide-line">
          {all.map((i, idx) => {
            const reportJob = i.inline?.kind === "payment_report" ? i.inline.jobId : null;
            const jobCard = staff.role_id === "accounts" ? (reportJob ? `/jobs/${reportJob}` : isUuid(i.jobId) ? `/jobs/${i.jobId}` : null) : null;
            return <Row key={`${i.jobId}-${idx}`} i={i} owner={owner} charges={charges} jobCard={jobCard} readOnly={!!staff.viewingAs} queryReasons={queryReasons} />;
          })}
        </ul>
      </details>
    </Card>
  );
}
