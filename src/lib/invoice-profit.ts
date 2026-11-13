import "server-only";
import { createAdminClient } from "./supabase/admin";
import { approvedQuoteProfits, costRateFor, jobProfits, type JobProfit } from "./profit";
import { expectedFeeCost, type Settings } from "./settings";
import { differLine, marginPercent, maySeeJobProfit, maySeeLifetimeProfit, profitState, type DifferLine } from "./invoice-profit-rules";

/*
 * PROFIT ON EVERY INVOICE (13 November 2026, evening list, Section 8; INV-00011, J-00989). The figures come from THE
 * calculation, `jobProfits` - the same one the Profit report uses - so the box and the report always agree. Shown to the
 * owner, accounts and the job's own advisor only; this module decides on the server, so nothing reaches anyone else.
 */
const r2 = (n: number) => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;

/** The job's OWN advisors for profit: the advisor in charge and the advisors following the car. Strict: a job with no
 * advisor yet has none (never "every advisor", as the car news does). */
async function profitAdvisorsOf(jobIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!jobIds.length) return out;
  const admin = createAdminClient();
  const [{ data: jobs }, { data: follows }] = await Promise.all([
    admin.from("jobs").select("id, advisor_id").in("id", jobIds),
    admin.from("job_followers").select("job_id, staff_id").in("job_id", jobIds).eq("is_active", true),
  ]);
  for (const j of (jobs ?? []) as { id: string; advisor_id: string | null }[]) out.set(j.id, j.advisor_id ? [j.advisor_id] : []);
  for (const f of (follows ?? []) as { job_id: string; staff_id: string }[]) out.set(f.job_id, [...(out.get(f.job_id) ?? []), f.staff_id]);
  return out;
}

export type ProfitCost = { key: string; label: string; amount: number };
export type InvoiceProfitModel = {
  invoiceId: string;
  invoiceNumber: string;
  jobNumber: string | null;
  revenue: number;
  costs: ProfitCost[];
  profit: number;
  margin: number | null;
  state: "provisional" | "final";
  worst: number;
  why: string[];
  /** The approved quotations' profit for the whole job (null with no approved quotation). */
  expected: number | null;
  differs: DifferLine[];
  /** Comebacks of this job since (our fault): their loss, and their job numbers. */
  comeback: { loss: number; jobs: string[] } | null;
  /** This invoice is itself a comeback of another job. */
  comebackOf: string | null;
};

/** May this person see the profit of this job? (THE server check, from the job's own advisors.) */
export async function mayViewJobProfit(staff: { id: string; role_id: string }, jobId: string | null): Promise<boolean> {
  if (staff.role_id === "owner" || staff.role_id === "accounts") return true;
  if (!jobId || staff.role_id !== "service_advisor") return false;
  return maySeeJobProfit(staff.role_id, staff.id, (await profitAdvisorsOf([jobId])).get(jobId) ?? []);
}

function costsOf(p: JobProfit): ProfitCost[] {
  const hours = Math.round((p.labourMinutes / 60) * 10) / 10;
  const list: ProfitCost[] = [
    { key: "parts", label: "Parts", amount: p.partsCost },
    { key: "stock", label: "Stock and consumables", amount: p.stockCost },
    { key: "labour", label: `Labour (${hours} h clocked${p.packageLabour ? ", package hours" : ""})`, amount: p.labourCost },
    { key: "materials", label: "Materials", amount: p.materialsCost },
    { key: "other", label: "Other costs and charges", amount: p.otherCost },
    { key: "recovery", label: "Recovery", amount: p.recoveryCost },
    { key: "bank", label: `Bank fee${p.bankChargesActual ? "" : " (estimated)"}`, amount: p.bankCharges },
    { key: "commission", label: "Commission", amount: p.commission },
    { key: "recheck", label: "PPF recheck visits", amount: p.recheckCost },
  ];
  return list.filter((c) => Math.abs(c.amount) >= 0.005);
}

/** The profit box of one tax invoice, or null when it is not an issued tax invoice of a job. */
export async function invoiceProfitFor(invoiceId: string, settings: Settings): Promise<InvoiceProfitModel | null> {
  const admin = createAdminClient();
  const { data: inv } = await admin.from("invoices").select("id, number, kind, status, job_id, total_aed").eq("id", invoiceId).maybeSingle();
  const row = inv as { id: string; number: string; kind: string; status: string; job_id: string | null; total_aed: number | string } | null;
  if (!row || row.kind !== "tax_invoice" || row.status !== "issued" || !row.job_id) return null;
  const jobId = row.job_id;
  const all = await jobProfits(settings, { jobIds: [jobId] });
  const p = all.find((x) => x.invoice.id === invoiceId);
  if (!p) return null;

  // Expected: the approved quotations' own profit (THE quotation calculation), for the job.
  const { data: firstQ } = await admin.from("quotations").select("responded_at").eq("job_id", jobId).eq("kind", "quotation").eq("status", "approved").eq("is_active", true).order("responded_at").limit(1).maybeSingle();
  const from = (firstQ as { responded_at: string | null } | null)?.responded_at ?? null;
  const quoted = from ? (await approvedQuoteProfits(settings, from)).filter((q) => q.jobId === jobId) : [];
  const expected = quoted.length ? r2(quoted.reduce((a, q) => a + q.profit, 0)) : null;

  // The lines that differ: each part's cost against the quotation's, the clocked labour against the quoted hours, the
  // bank fee against the expected way to pay.
  const differs: DifferLine[] = [];
  const { data: invLines } = await admin.from("invoice_lines").select("description, section, cost_aed, quotation_line_id").eq("invoice_id", invoiceId).eq("is_active", true);
  const parts = ((invLines ?? []) as { description: string; section: string; cost_aed: number | string; quotation_line_id: string | null }[]).filter((l) => l.section === "parts" && l.quotation_line_id);
  const qlIds = parts.map((l) => l.quotation_line_id as string);
  const { data: qls } = qlIds.length ? await admin.from("quotation_lines").select("id, unit_cost, quantity").in("id", qlIds) : { data: [] as { id: string; unit_cost: number | string | null; quantity: number | string }[] };
  const qlOf = new Map(((qls ?? []) as { id: string; unit_cost: number | string | null; quantity: number | string }[]).map((q) => [q.id, q]));
  for (const l of parts) {
    const q = qlOf.get(l.quotation_line_id as string);
    if (!q || q.unit_cost === null) continue;
    const d = differLine(String(l.description).toUpperCase(), (Number(q.unit_cost) || 0) * (Number(q.quantity) || 1), Number(l.cost_aed) || 0);
    if (d) differs.push(d);
  }
  if (quoted.length) {
    const { data: qrows } = await admin.from("quotations").select("id, expected_payment_method").eq("job_id", jobId).eq("kind", "quotation").eq("status", "approved").eq("is_active", true);
    const qIds = ((qrows ?? []) as { id: string }[]).map((q) => q.id);
    const { data: lab } = qIds.length ? await admin.from("quotation_lines").select("hours, hours_estimate, quantity, left_off").in("quotation_id", qIds).eq("is_active", true).eq("line_type", "labour") : { data: [] as { hours: number | string | null; hours_estimate: number | string | null; quantity: number | string; left_off: boolean | null }[] };
    const quotedHours = ((lab ?? []) as { hours: number | string | null; hours_estimate: number | string | null; left_off: boolean | null }[]).filter((l) => !l.left_off).reduce((a, l) => a + (Number(l.hours_estimate ?? l.hours) || 0), 0);
    const { data: job } = await admin.from("jobs").select("department").eq("id", jobId).maybeSingle();
    if (quotedHours > 0) {
      const d = differLine(`LABOUR (${r2(quotedHours)} h quoted, ${Math.round((p.labourMinutes / 60) * 10) / 10} h clocked)`, quotedHours * costRateFor(settings, (job as { department: string | null } | null)?.department), p.labourCost);
      if (d) differs.push(d);
    }
    const method = ((qrows ?? []) as { expected_payment_method: string | null }[])[0]?.expected_payment_method ?? null;
    if (p.bankChargesActual || !p.provisionalWhy.includes("bank charge estimated until payment")) {
      const d = differLine("BANK FEE", expectedFeeCost(settings, method, p.invoice.total_aed), p.bankCharges);
      if (d) differs.push(d);
    }
  }

  // PROVISIONAL with the worst case, or FINAL.
  const feeEstimated = p.provisionalWhy.includes("bank charge estimated until payment");
  const worstFee = Math.max(expectedFeeCost(settings, "card", p.invoice.total_aed), expectedFeeCost(settings, "link", p.invoice.total_aed));
  const st = profitState({ profit: p.profit, provisional: p.provisional, feeEstimated, bankCharges: p.bankCharges, worstFee });

  // Comebacks since (our fault), and whether this invoice is itself one.
  let comeback: InvoiceProfitModel["comeback"] = null;
  if (p.profitAfterComeback !== null) {
    const { data: cbs } = await admin.from("jobs").select("job_number").eq("comeback_of", jobId).in("comeback_cause", ["workmanship", "faulty_part"]);
    comeback = { loss: r2(p.profit - p.profitAfterComeback), jobs: ((cbs ?? []) as { job_number: string }[]).map((c) => c.job_number) };
  }
  let comebackOf: string | null = null;
  if (p.comeback?.of) {
    const { data: orig } = await admin.from("jobs").select("job_number").eq("id", p.comeback.of).maybeSingle();
    comebackOf = (orig as { job_number: string } | null)?.job_number ?? null;
  }
  return { invoiceId, invoiceNumber: row.number, jobNumber: p.jobNumber, revenue: p.revenue, costs: costsOf(p), profit: p.profit, margin: marginPercent(p.profit, p.revenue), state: st.state, worst: st.worst, why: p.provisionalWhy, expected, differs, comeback, comebackOf };
}

/** The profit per job (all its tax invoices, comebacks counted on their own visits) from THE calculation. */
export async function profitByJob(jobIds: string[], settings: Settings): Promise<Map<string, { profit: number; revenue: number; provisional: boolean; invoices: number }>> {
  const out = new Map<string, { profit: number; revenue: number; provisional: boolean; invoices: number }>();
  if (!jobIds.length) return out;
  for (const p of await jobProfits(settings, { jobIds })) {
    const id = p.invoice.job_id;
    if (!id) continue;
    const cur = out.get(id) ?? { profit: 0, revenue: 0, provisional: false, invoices: 0 };
    out.set(id, { profit: r2(cur.profit + p.profit), revenue: r2(cur.revenue + p.revenue), provisional: cur.provisional || p.provisional, invoices: cur.invoices + 1 });
  }
  return out;
}

/** Which of these jobs' profits this person may see (owner/accounts all; an advisor the jobs he is advisor of). */
export async function visibleProfitJobs(staff: { id: string; role_id: string }, jobIds: string[]): Promise<Set<string>> {
  if (maySeeLifetimeProfit(staff.role_id)) return new Set(jobIds);
  if (staff.role_id !== "service_advisor") return new Set();
  const advisors = await profitAdvisorsOf(jobIds);
  return new Set(jobIds.filter((id) => (advisors.get(id) ?? []).includes(staff.id)));
}
