import type { CurrentStaff } from "@/lib/auth";
import { loadReports } from "@/lib/payment-reports";
import { reasonsFor } from "@/lib/reasons";
import type { Settings } from "@/lib/settings";
import { PaymentReportActions, ReportMethodWords } from "./PaymentReport";
import { Card, LinkButton, SectionLabel } from "./ui";

/**
 * "Payments reported by advisors" (2 November 2026, section 3): every payment an advisor took and sent to accounts that
 * still waits, in the owner's one-line words, with the slip, Record (the window opens pre-filled), Query and the job
 * card. On the accounts dashboard and the Invoices page (where the old counter-payments card was). Nothing when none wait.
 */
export async function PaymentReportsCard({ staff, settings }: { staff: CurrentStaff; settings: Settings }) {
  if (!(staff.role_id === "accounts" || staff.role_id === "owner")) return null;
  const reports = await loadReports({ status: ["waiting"], settings });
  if (!reports.length) return null;
  const reasons = reasonsFor(settings, "payment_query");
  return (
    <Card className="flex flex-col gap-2 border-amber-bar" data-payment-reports>
      <SectionLabel right={`${reports.length}`}>Payments reported by advisors</SectionLabel>
      <p className="text-xs text-muted">Taken at the counter and sent to you with the slip. Record each one (the window opens filled in; you confirm), or Query it back to the advisor.</p>
      <ul className="divide-y divide-line">
        {reports.map((r) => (
          <li key={r.id} className={`py-2 pl-2 border-l-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${r.late ? "border-l-red-bar" : "border-l-amber-bar"}`} data-payment-report-row={r.id} data-report-late={r.late ? "1" : "0"}>
            <span className="min-w-[14rem] flex-1">
              <span className="font-semibold">{r.line}</span>
              <span className="block text-xs text-muted"><ReportMethodWords r={r} />{r.note ? ` · "${r.note}"` : ""}{r.late ? " · not recorded in time" : ""}</span>
            </span>
            <LinkButton href={`/jobs/${r.jobId}`} size="md" tone="ghost" data-report-job-card>Job card</LinkButton>
            <PaymentReportActions reportId={r.id} jobId={r.jobId} thumb={r.photos[0] ? r.thumbs[r.photos[0].path] || null : null} url={r.photos[0]?.url ?? null} contentType={r.photos[0]?.contentType ?? null} path={r.photos[0]?.path ?? null} label={`${r.jobNumber} · slip from ${r.reporter}`} readOnly={!!staff.viewingAs} reasons={reasons} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
