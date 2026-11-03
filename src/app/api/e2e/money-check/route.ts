import { e2eRefused } from "@/lib/e2e-guard";
import { NextResponse, type NextRequest } from "next/server";
import { buildInvoiceDraft, draftFrom, loadDraftInputs, type InvoiceDraft } from "@/lib/invoice-data";
import { jobMoneyMany, jobMoneyOf } from "@/lib/customer-money";
import { pageAll } from "@/lib/page-all";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The money rule's proof (3 November 2026, section 4), on the TEST database only, behind the e2e secret: every job's
 * draft and money one job at a time against all of them at once (the money list's way), { mode: "batch" }. Returns the
 * number of jobs compared and every difference (job number, what differs). The one-off proof that the batched draft
 * equals the draft as it was built before (one job, six reads) ran the same way on 3 November: 40 jobs, 0 differences.
 */
export async function POST(request: NextRequest) {
  if (e2eRefused(request)) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { mode?: string; limit?: number; jobIds?: string[] };
  const settings = await getSettings();
  const admin = createAdminClient();
  const jobs = body.jobIds?.length
    ? ((await admin.from("jobs").select("id, job_number").in("id", body.jobIds)).data ?? []) as { id: string; job_number: string }[]
    : await pageAll<{ id: string; job_number: string }>((a, b) => admin.from("jobs").select("id, job_number").order("job_number").range(a, b) as unknown as PromiseLike<{ data: { id: string; job_number: string }[] | null; error: { message: string } | null }>);
  const list = body.limit ? jobs.slice(0, body.limit) : jobs;
  const ids = list.map((j) => j.id);
  const numberOf = new Map(list.map((j) => [j.id, j.job_number]));
  const shape = (d: InvoiceDraft) => JSON.stringify({ lines: d.lines, totals: d.totals, quotationNumbers: d.quotationNumbers, vatPercent: d.vatPercent });
  const diffs: { job: string; what: string; old?: string; now?: string }[] = [];
  // A few at a time: the one-job reading makes six reads per job.
  const eachJob = async <T,>(f: (id: string) => Promise<T>): Promise<Map<string, T>> => {
    const out = new Map<string, T>();
    for (let i = 0; i < ids.length; i += 8) {
      const part = ids.slice(i, i + 8);
      const got = await Promise.all(part.map((id) => f(id)));
      part.forEach((id, k) => out.set(id, got[k]));
    }
    return out;
  };
  const batched = await loadDraftInputs(ids);
  let withLines = 0;
  if (body.mode === "batch") {
    const single = await eachJob((id) => buildInvoiceDraft(id, settings));
    for (const id of ids) {
      const a = single.get(id)!;
      const b = draftFrom(batched.get(id)!, settings);
      if (a.lines.length) withLines++;
      const sa = shape(a);
      const sb = shape(b);
      if (sa !== sb) diffs.push({ job: numberOf.get(id) ?? id, what: "draft", old: sa.slice(0, 600), now: sb.slice(0, 600) });
    }
  }
  let moneyCompared = 0;
  if (body.mode === "batch") {
    const many = await jobMoneyMany(ids, settings);
    const one = await eachJob((id) => jobMoneyOf(id, settings));
    for (const id of ids) {
      const a = JSON.stringify(one.get(id) ?? null);
      const b = JSON.stringify(many.get(id) ?? null);
      moneyCompared++;
      if (a !== b) diffs.push({ job: numberOf.get(id) ?? id, what: "money", old: a, now: b });
    }
  }
  return NextResponse.json({ jobs: ids.length, withLines, moneyCompared, differences: diffs.length, diffs: diffs.slice(0, 40) });
}
