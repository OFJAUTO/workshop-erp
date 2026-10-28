import { Badge, Card, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { CLEARING_LABEL } from "@/lib/card-settlement-rules";
import { dubaiToday, loadSettlements, loadUnsettled } from "@/lib/card-settlements";
import { formatDate, formatDayTime } from "@/lib/format";
import { recordReportAction, recordSettlementAction, saveBankFeesAction, undoSettlementAction, uploadReportAction } from "./actions";
import { ReportReview, ReportUpload } from "./ReportReview";
import { loadReport, reviewMatches, reviewPaymentsFor } from "@/lib/settlement-import";
import { BankFeeSettings } from "./BankFeeSettings";
import { bankFeeValuesOf, bankFeesOf, getSettings } from "@/lib/settings";
import { SettlementForm, UndoSettlement } from "./SettlementForm";

export const dynamic = "force-dynamic";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function CardSettlementsPage({ searchParams }: { searchParams: Promise<{ method?: string; report?: string }> }) {
  const staff = await requirePermission("cardSettlements");
  const sp = await searchParams;
  const [rows, history, settings] = await Promise.all([loadUnsettled(), loadSettlements(), getSettings()]);
  const today = dubaiToday();
  // A report being reviewed: matched afresh against the payments still waiting each time the page opens.
  const reviewReport = sp.report && /^[0-9a-f-]{36}$/.test(sp.report) ? await loadReport(sp.report) : null;
  const reviewPayments = reviewReport ? await reviewPaymentsFor(reviewReport) : [];
  const review = reviewReport ? { report: reviewReport, payments: reviewPayments, matches: reviewMatches(reviewReport, reviewPayments) } : null;
  const initialMethod = sp.method === "link" ? "link" : sp.method === "card" ? "card" : rows.some((r) => r.method === "card") || !rows.length ? "card" : "link";
  const open = { card: rows.filter((r) => r.method === "card"), link: rows.filter((r) => r.method === "link") };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Card settlements"
        subtitle="Card and payment-link money waits in its clearing account until the bank pays it out. When the payout shows on the statement, tick the payments it covers and type what actually arrived: the real fee replaces the estimate on every job."
      />
      <div className="flex flex-wrap gap-3" data-clearing-tiles>
        {(["card", "link"] as const).map((m) => (
          <Card key={m} className="flex min-w-60 flex-1 flex-col gap-1" data-clearing-tile={m}>
            <SectionLabel>{CLEARING_LABEL[m]} clearing</SectionLabel>
            <span className="text-2xl font-extrabold">{aed(open[m].reduce((a, r) => a + r.amount, 0))}</span>
            <span className="text-sm text-muted">
              {open[m].length ? `${open[m].length} payment${open[m].length === 1 ? "" : "s"} not settled yet` : "At zero: everything is settled."}
              {open[m].some((r) => r.late) ? <span className="ml-2 font-semibold text-amber">{open[m].filter((r) => r.late).length} older than 3 working days</span> : null}
            </span>
          </Card>
        ))}
      </div>

      <Card className="flex flex-col gap-4">
        <SectionLabel>Record a settlement</SectionLabel>
        <SettlementForm rows={rows.map((r) => ({ id: r.id, number: r.number, method: r.method, amount: r.amount, estimate: r.estimate, est: r.est, authCode: r.authCode, receivedAt: r.receivedAt, plate: r.plate, isDeposit: r.isDeposit, late: r.late }))} today={today} initialMethod={initialMethod} canSave={!staff.viewingAs} rules={{ card: bankFeesOf(settings).card, link: bankFeesOf(settings).link }} action={recordSettlementAction} />
      </Card>

      <Card className="flex flex-col gap-3" data-settle-upload id="report">
        <SectionLabel>Upload the settlement report</SectionLabel>
        <ReportUpload action={uploadReportAction} canSave={!staff.viewingAs} />
        {review ? (
          <ReportReview
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

      <Card className="flex flex-col gap-2">
        <SectionLabel>Recorded settlements</SectionLabel>
        {history.length ? (
          <ul className="divide-y divide-line text-sm" data-settle-history>
            {history.map((h) => (
              <li key={h.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 ${h.active ? "" : "text-muted"}`} data-settle-history-row={h.number}>
                <span className={`font-bold ${h.active ? "" : "line-through"}`}>{h.number}</span>
                {!h.active ? <Badge tone="red">Undone</Badge> : null}
                <span>{formatDate(`${h.settledOn}T12:00:00+04:00`)}</span>
                <Badge tone="neutral">{CLEARING_LABEL[h.method]}</Badge>
                <span className="text-muted">{h.count} payment{h.count === 1 ? "" : "s"} · {aed(h.gross)} ticked · {aed(h.received)} received</span>
                <span className="font-semibold" data-settle-history-fees>{h.msf !== null ? `MSF ${aed(h.msf)} + fee ${aed(h.txn ?? 0)} + VAT ${aed(h.vat ?? 0)}` : `fee ${aed(h.fee)}`} ({h.gross > 0 ? ((h.fee / h.gross) * 100).toFixed(2) : "0.00"}%)</span>
                {h.source === "report" ? <Badge tone="neutral">From the bank report</Badge> : null}
                {h.difference ? <span className="w-full text-xs font-semibold text-red" data-settle-history-diff>Saved with an AED {Math.abs(h.difference).toFixed(2)} difference: {h.differenceNote}</span> : null}
                {h.statementRef ? <span className="text-muted">ref {h.statementRef}</span> : null}
                <span className="ml-auto text-xs text-muted">by {h.createdByName ?? "—"} · {formatDayTime(h.createdAt)}</span>
                <Badge tone={h.zohoStatus === "synced" ? "green" : h.zohoStatus === "failed" ? "red" : "neutral"}>{h.zohoStatus === "synced" ? (h.active ? "In Zoho" : "Zoho: nothing posted") : h.zohoStatus === "failed" ? "Zoho: see the sync page" : "Zoho: queued"}</Badge>
                {!staff.viewingAs ? <UndoSettlement number={h.number} active={h.active} action={undoSettlementAction.bind(null, h.id)} /> : null}
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
