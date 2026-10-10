import { NextResponse, type NextRequest } from "next/server";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { SCANS_BUCKET, attachPrescan, scanKindFor } from "@/lib/scans";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/i;

type Attachment = { Name?: string; Content?: string; ContentType?: string; ContentLength?: number };
type Inbound = { From?: string; FromFull?: { Email?: string }; Subject?: string; TextBody?: string; Attachments?: Attachment[] };

/**
 * Where the scanner's emails arrive (Postmark inbound webhook, JSON with base64 attachments). Each PDF
 * is kept, matched to an open job by the VIN in the subject (then the body), filed as pre-scan or
 * post-scan by the job's stage, and everyone concerned is told. No match: it waits in Scan reports.
 */
export async function POST(request: NextRequest) {
  const settings = await getSettings();
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!settings.inbound_scan_token || token !== settings.inbound_scan_token) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  let mail: Inbound;
  try {
    mail = (await request.json()) as Inbound;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const admin = createAdminClient();
  const from = mail.FromFull?.Email ?? mail.From ?? null;
  const subject = (mail.Subject ?? "").slice(0, 300);
  const attachments = (mail.Attachments ?? []).filter((a) => a.Content && (a.ContentType?.includes("pdf") || /\.pdf$/i.test(a.Name ?? "")));
  // The VIN: the subject first, then the body. The PDF itself is not read (see the delivery note).
  const vin = (subject.match(VIN_RE)?.[0] ?? (mail.TextBody ?? "").match(VIN_RE)?.[0] ?? "").toUpperCase() || null;
  type Job = { id: string; job_number: string; status: string; department: string | null; assigned_to: string | null };
  let job: Job | null = null;
  if (vin) {
    const { data } = await admin.from("jobs").select("id, job_number, status, department, assigned_to, vehicle:vehicles!inner(vin)").eq("is_open", true).ilike("vehicle.vin", vin).order("gated_in_at", { ascending: false }).limit(1).maybeSingle();
    job = (data as unknown as Job | null) ?? null;
  }
  const stored: string[] = [];
  for (const a of attachments) {
    const bytes = Buffer.from(String(a.Content), "base64");
    if (!bytes.length || bytes.length > 35 * 1024 * 1024) continue;
    const safeName = (a.Name ?? "scan.pdf").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
    const path = `${job ? job.id : "unmatched"}/${Date.now()}-${safeName}`;
    const { error: upError } = await admin.storage.from(SCANS_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (upError) continue;
    const kind = job ? scanKindFor(job.status) : null;
    await admin.from("inbound_scans").insert({ from_email: from, subject, vin, storage_path: path, content_type: "application/pdf", file_name: a.Name ?? null, job_id: job?.id ?? null, kind, status: job ? "matched" : "unmatched", matched_by: job ? "vin_subject" : null });
    stored.push(path);
    if (job && kind === "pre") await attachPrescan(job.id, bytes, a.Name ?? "scan.pdf");
  }
  if (!stored.length) {
    // Not a scan report (a forwarding confirmation, a reply): kept for the owner to read, never thrown away.
    await admin.from("inbound_emails").insert({ from_email: from, subject: subject || null, text_body: String(mail.TextBody ?? "").slice(0, 20000) || null });
    return NextResponse.json({ ok: true, stored: 0, kept: true });
  }
  if (job) {
    const kind = scanKindFor(job.status);
    const n = { type: "scan_received", title: `${kind === "pre" ? "Pre-scan" : "Post-scan"} report received · ${job.job_number}`, body: `${stored.length} PDF${stored.length === 1 ? "" : "s"} from the scanner${vin ? ` for VIN ${vin}` : ""}.`, jobId: job.id, href: `/jobs/${job.id}/inspection` };
    await notifyManagers(job.department, n);
    if (job.assigned_to) await notifyStaff([job.assigned_to], { ...n, href: `/my-jobs/${job.id}` });
  } else {
    await notifyRoles(["owner", "workshop_manager"], { type: "scan_unmatched", title: "Scan report with no matching car", body: `${subject || "No subject"}${vin ? ` · VIN ${vin}` : " · no VIN found"}. Attach it to a job by hand.`, href: "/scans" });
  }
  return NextResponse.json({ ok: true, stored: stored.length, matched: !!job });
}
