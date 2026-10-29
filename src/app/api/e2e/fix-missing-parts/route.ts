import { e2eRefused } from "@/lib/e2e-guard";
import { NextResponse, type NextRequest } from "next/server";
import { createNextVersion, missingPricedParts, syncMissingParts } from "@/lib/quote-versions";
import { notifyStaff } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Every open job's latest quotation against its priced parts (Our stock included). A draft takes the missing parts at
 * once; a sent or declined one gets the next version with them and the advisor is told; an approved or invoiced one is
 * only listed for the owner. Local only, behind the e2e secret; { "dryRun": true } reports without changing anything.
 */
export async function POST(request: NextRequest) {
  if (e2eRefused(request)) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean; by?: string };
  const admin = createAdminClient();
  const { data: jobs } = await admin.from("jobs").select("id, job_number, gated_in_by").eq("is_open", true);
  const { data: owner } = await admin.from("staff").select("id, display_name").eq("role_id", "owner").eq("is_active", true).order("created_at").limit(1).maybeSingle();
  const actor = { id: body.by ?? owner?.id ?? "", display_name: owner?.display_name ?? "Owner" };
  const report: { job: string; quotation: string; status: string; missing: string[]; action: string }[] = [];
  for (const job of jobs ?? []) {
    const { data: latest } = await admin.from("quotations").select("id, number, version, status, created_by, sent_by").eq("job_id", job.id).eq("kind", "quotation").eq("is_active", true).neq("status", "cancelled").order("version", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!latest) continue;
    const missing = await missingPricedParts(job.id, latest.id);
    if (!missing.length) continue;
    const names = missing.map((m) => m.description);
    const label = `${latest.number} v${latest.version}`;
    const { data: invoices } = await admin.from("invoices").select("id").eq("job_id", job.id).eq("is_active", true).limit(1);
    if (latest.status === "approved" || (invoices ?? []).length) {
      report.push({ job: job.job_number, quotation: label, status: latest.status, missing: names, action: "left for the owner: approved or invoiced" });
      continue;
    }
    if (latest.status === "draft" || latest.status === "pending_owner") {
      if (!body.dryRun) await syncMissingParts(job.id, latest.id, actor.id);
      report.push({ job: job.job_number, quotation: label, status: latest.status, missing: names, action: body.dryRun ? "would add to the draft" : "added to the draft" });
      continue;
    }
    if (["sent", "opened", "expired", "declined", "urgent_requested"].includes(latest.status)) {
      if (body.dryRun) { report.push({ job: job.job_number, quotation: label, status: latest.status, missing: names, action: "would start the next version with them" }); continue; }
      const r = await createNextVersion(latest.id, actor, { reason: "priced parts were missing" });
      if ("error" in r) { report.push({ job: job.job_number, quotation: label, status: latest.status, missing: names, action: `could not revise: ${r.error}` }); continue; }
      const ids = Array.from(new Set([job.gated_in_by, latest.created_by, latest.sent_by].filter((x): x is string => !!x)));
      await notifyStaff(ids, { type: "quote_revised_by_parts", title: `Parts were missing on ${job.job_number}: send the revised quotation`, body: `${latest.number} version ${r.version} now carries ${names.join(", ")}. Check it and send it.`, jobId: job.id, href: `/jobs/${job.id}/quote/${r.id}?send=1` });
      report.push({ job: job.job_number, quotation: label, status: latest.status, missing: names, action: `next version ${r.version} started with them, advisor told` });
      continue;
    }
    report.push({ job: job.job_number, quotation: label, status: latest.status, missing: names, action: "left as is" });
  }
  return NextResponse.json({ checked: (jobs ?? []).length, report });
}
