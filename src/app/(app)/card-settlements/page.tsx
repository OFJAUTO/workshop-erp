import { Badge, Card, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { CLEARING_LABEL } from "@/lib/card-settlement-rules";
import { dubaiToday, loadSettlements, loadUnsettled } from "@/lib/card-settlements";
import { formatDate, formatDayTime } from "@/lib/format";
import { recordSettlementAction, undoSettlementAction } from "./actions";
import { SettlementForm, UndoSettlement } from "./SettlementForm";

export const dynamic = "force-dynamic";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function CardSettlementsPage({ searchParams }: { searchParams: Promise<{ method?: string }> }) {
  const staff = await requirePermission("cardSettlements");
  const sp = await searchParams;
  const [rows, history] = await Promise.all([loadUnsettled(), loadSettlements()]);
  const today = dubaiToday();
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
        <SettlementForm rows={rows.map((r) => ({ id: r.id, number: r.number, method: r.method, amount: r.amount, estimate: r.estimate, receivedAt: r.receivedAt, plate: r.plate, isDeposit: r.isDeposit, late: r.late }))} today={today} initialMethod={initialMethod} canSave={!staff.viewingAs} action={recordSettlementAction} />
      </Card>

      <Card className="flex flex-col gap-2" data-settle-upload>
        <SectionLabel>Upload the settlement report</SectionLabel>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled className="min-h-11 cursor-not-allowed rounded-control border-2 border-line-strong bg-chip px-4 text-sm font-bold text-muted" data-settle-upload-button>Upload settlement report – coming soon</button>
          <span className="text-sm text-muted">Needs one real Network International settlement file (CSV or Excel) to learn its columns: the transaction date and time, the card or order reference, the gross amount, the fee (and its VAT), the net amount, and the payout date and batch. Until then, record each payout above by hand.</span>
        </div>
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
                <span className="font-semibold">fee {aed(h.fee)} ({h.gross > 0 ? ((h.fee / h.gross) * 100).toFixed(2) : "0.00"}%)</span>
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
    </div>
  );
}
