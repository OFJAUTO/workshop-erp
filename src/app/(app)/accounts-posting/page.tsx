import { Badge, Card, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { dubaiToday, loadSettlements, loadUnsettled } from "@/lib/card-settlements";
import { formatDate, formatDayTime } from "@/lib/format";
import { recordReportAction, recordSettlementAction, saveBankFeesAction, undoSettlementAction, uploadReportAction } from "./actions";
import { ReportReview, ReportUpload } from "./ReportReview";
import { loadReport, reviewMatches, reviewPaymentsFor } from "@/lib/settlement-import";
import { BankFeeSettings } from "./BankFeeSettings";
import { bankFeeValuesOf, bankFeesOf, getSettings } from "@/lib/settings";
import { SettlementForm, UndoSettlement } from "./SettlementForm";
import Link from "next/link";
import { BankAnswerHost, BankPostingPanel } from "@/components/BankPosting";
import { loadBankWaiting } from "@/lib/bank-posting";
import { bankPostingReady } from "@/lib/schema-ready";
import { signJobFiles } from "@/lib/work-data";

const TABS = [
  { key: "card", label: "Card machine" },
  { key: "link", label: "Payment link" },
  { key: "cheque", label: "Cheque" },
  { key: "transfer", label: "Bank transfer" },
] as const;
type Tab = (typeof TABS)[number]["key"];
const methodLabel = (m: string) => TABS.find((t) => t.key === m)?.label ?? m;

export const dynamic = "force-dynamic";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Accounts posting (9 November 2026; was "Card settlements"): money that waits before it is in the bank. Four tabs and
 * four boxes - Card machine, Payment link, Cheque, Bank transfer - each with what is waiting, how many, and how many are
 * older than 3 working days. Card and link: the settlement form and the bank report. Cheque and transfer: each one's
 * Mark deposited / Mark cleared (Confirmed in bank) / Bounced, and the same record row (tick, the day it reached the
 * bank, amount, statement reference, Record).
 */
export default async function AccountsPostingPage({ searchParams }: { searchParams: Promise<{ method?: string; report?: string; tab?: string }> }) {
  const staff = await requirePermission("cardSettlements");
  const sp = await searchParams;
  const [rows, history, settings, bankRows, ready] = await Promise.all([loadUnsettled(), loadSettlements(), getSettings(), loadBankWaiting(), bankPostingReady()]);
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : sp.method === "link" ? "link" : sp.report ? "card" : "card";
  const bank = { cheque: bankRows.filter((r) => r.method === "cheque"), transfer: bankRows.filter((r) => r.method === "transfer") };
  const proofUrls = await signJobFiles(bankRows.map((r) => r.proofPath).filter((x): x is string => !!x));
  const today = dubaiToday();
  // A report being reviewed: matched afresh against the payments still waiting each time the page opens.
  const reviewReport = sp.report && /^[0-9a-f-]{36}$/.test(sp.report) ? await loadReport(sp.report) : null;
  const reviewPayments = reviewReport ? await reviewPaymentsFor(reviewReport) : [];
  const review = reviewReport ? { report: reviewReport, payments: reviewPayments, matches: reviewMatches(reviewReport, reviewPayments) } : null;
  const initialMethod = tab === "link" ? "link" : "card";
  const open = { card: rows.filter((r) => r.method === "card"), link: rows.filter((r) => r.method === "link") };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Accounts posting"
        subtitle="Money that is recorded but not in the bank yet. Card and payment-link money waits until the bank pays it out; a cheque until it clears; a bank transfer until it shows on the statement. Record each one here when it reaches the bank."
      />
      <BankAnswerHost />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-clearing-tiles>
        {TABS.map((t) => {
          const list = t.key === "card" || t.key === "link" ? open[t.key].map((r) => ({ amount: r.amount, late: r.late })) : bank[t.key];
          const late = list.filter((r) => r.late).length;
          return (
            <Link key={t.key} href={`/accounts-posting?tab=${t.key}`} className={`flex min-w-0 flex-col gap-1 rounded-card border p-4 ${tab === t.key ? "border-ink border-2 bg-white" : "border-line bg-white"}`} data-clearing-tile={t.key} data-posting-tab={t.key} aria-current={tab === t.key ? "page" : undefined}>
              <SectionLabel>{t.label}</SectionLabel>
              <span className="text-2xl font-extrabold whitespace-nowrap" data-tile-amount>{aed(list.reduce((a, r) => a + r.amount, 0))}</span>
              <span className="text-sm text-muted">
                <span data-tile-count>{list.length ? `${list.length} waiting` : "Nothing waiting"}</span>
                {late ? <span className="ml-2 font-semibold text-amber-text" data-tile-late>{late} older than 3 working days</span> : null}
              </span>
            </Link>
          );
        })}
      </div>

      {tab === "cheque" || tab === "transfer" ? (
        <Card className="flex flex-col gap-3" data-posting-bank={tab}>
          <SectionLabel>{tab === "cheque" ? "Cheques waiting to clear" : "Bank transfers waiting for the statement"}</SectionLabel>
          {tab === "cheque" ? <p className="text-xs text-muted">Received → Mark deposited (date, bank account) → Mark cleared on the day it shows on the statement, or Bounced. A post-dated cheque cannot be deposited before its date.{ready ? "" : " Mark deposited and the Zoho move from Undeposited Funds switch on with the database update of 9 November (WAITING FOR APPLY)."}</p> : <p className="text-xs text-muted">Confirmed in bank with the amount that actually arrived: less keeps the balance open, more becomes an advance.</p>}
          <BankPostingPanel method={tab} rows={bank[tab]} today={today} canSave={!staff.viewingAs} ready={ready} proofUrls={proofUrls} />
        </Card>
      ) : null}

      {tab === "card" || tab === "link" ? <>
      <Card className="flex flex-col gap-4">
        <SectionLabel>Record a settlement</SectionLabel>
        <SettlementForm rows={rows.map((r) => ({ id: r.id, number: r.number, method: r.method, amount: r.amount, estimate: r.estimate, est: r.est, authCode: r.authCode, codeMissing: r.codeMissing, receivedAt: r.receivedAt, plate: r.plate, isDeposit: r.isDeposit, late: r.late }))} today={today} initialMethod={initialMethod} canSave={!staff.viewingAs} rules={{ card: bankFeesOf(settings).card, link: bankFeesOf(settings).link }} action={recordSettlementAction} />
      </Card>

      <Card className="flex flex-col gap-3" data-settle-upload id="report">
        <SectionLabel>Upload the settlement report</SectionLabel>
        <ReportUpload action={uploadReportAction} canSave={!staff.viewingAs} />
        {review ? (
          <ReportReview
            reportId={review.report.id}
            report={{ ...review.report.parsed, fileName: review.report.fileName }}
            matches={review.matches}
            payments={review.payments}
            today={today}
            recorded={!!review.report.recordedAt}
            canSave={!staff.viewingAs}
            action={recordReportAction.bind(null, review.report.id)}
          />
        ) : sp.report ? <p className="text-sm text-muted">That report was not found. Upload it again.</p> : null}
      </Card>

      </> : null}

      <Card className="flex flex-col gap-2">
        <SectionLabel>Recorded postings</SectionLabel>
        {history.some((h) => h.method === tab) ? (
          <ul className="divide-y divide-line text-sm" data-settle-history>
            {history.filter((h) => h.method === tab).map((h) => (
              <li key={h.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 ${h.active ? "" : "text-muted"}`} data-settle-history-row={h.number}>
                <span className={`font-bold ${h.active ? "" : "line-through"}`}>{h.number}</span>
                {!h.active ? <Badge tone="red">Undone</Badge> : null}
                <span data-settle-history-dates>In bank {formatDate(`${h.settledOn}T12:00:00+04:00`)} · recorded {formatDate(h.createdAt)}{h.createdByName ? ` by ${h.createdByName.split(" ")[0]}` : ""}</span>
                <Badge tone="neutral">{methodLabel(h.method)}</Badge>
                <span className="text-muted">{h.count} payment{h.count === 1 ? "" : "s"} · {aed(h.gross)} ticked · {aed(h.received)} received</span>
                <span className="font-semibold" data-settle-history-fees>{h.msf !== null ? `MSF ${aed(h.msf)} + fee ${aed(h.txn ?? 0)} + VAT ${aed(h.vat ?? 0)}` : `fee ${aed(h.fee)}`} ({h.gross > 0 ? ((h.fee / h.gross) * 100).toFixed(2) : "0.00"}%)</span>
                {h.source === "report" ? <Badge tone="neutral">From the bank report</Badge> : null}
                {h.difference ? <span className="w-full text-xs font-semibold text-red" data-settle-history-diff>Saved with an AED {Math.abs(h.difference).toFixed(2)} difference: {h.differenceNote}</span> : null}
                {h.statementRef ? <span className="text-muted">ref {h.statementRef}</span> : null}
                <span className="ml-auto text-xs text-muted">by {h.createdByName ?? "—"} · {formatDayTime(h.createdAt)}</span>
                <Badge tone={h.zohoStatus === "synced" ? "green" : h.zohoStatus === "failed" ? "red" : "neutral"}>{h.zohoStatus === "synced" ? (h.active ? "In Zoho" : "Zoho: nothing posted") : h.zohoStatus === "failed" ? "Zoho: see the sync page" : "Zoho: queued"}</Badge>
                {!staff.viewingAs && (h.method === "card" || h.method === "link") ? <UndoSettlement number={h.number} active={h.active} action={undoSettlementAction.bind(null, h.id)} /> : null}
                {!h.active && h.note ? <span className="w-full text-xs">{h.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">None yet.</p>
        )}
      </Card>

      <Card className="flex flex-col gap-3" id="fees">
        <SectionLabel>Bank fees per payment method</SectionLabel>
        <BankFeeSettings values={bankFeeValuesOf(settings)} action={saveBankFeesAction} canSave={!staff.viewingAs} />
      </Card>
    </div>
  );
}
