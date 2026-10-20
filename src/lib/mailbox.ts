import "server-only";
import { attachmentsOf, getAttachment, getMessage, headerOf, listMessages, scansMailbox, textBodyOf, type GmailMessage } from "./gmail";
import { mailboxConnection, oauthConfigured } from "./google-mailbox";
import { notifyManagers, notifyRoles, notifyStaff } from "./notifications";
import { autelLinksIn, carHintOf, fetchAutelReport, isAutelSender, reportIdOf } from "./autel";
import { readPdfRows } from "./pdf-read";
import { SCANS_BUCKET, attachPrescan, scanKindFor } from "./scans";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/i;

export type MailAttachmentIn = { name: string; contentType: string; bytes: Buffer };
export type MailIn = { messageId: string | null; from: string | null; subject: string; text: string; attachments: MailAttachmentIn[] };
export type MailResult = { stored: number; matched: boolean; jobNumber: string | null; kept: boolean; vin: string | null };

const isPdf = (a: MailAttachmentIn) => a.contentType.includes("pdf") || /\.pdf$/i.test(a.name);
const isImage = (a: MailAttachmentIn) => /^image\/(jpeg|png|webp)/i.test(a.contentType) || /\.(jpe?g|png|webp)$/i.test(a.name);

/**
 * One email from the scanner, wherever it came from (the mailbox, or the local test route): every PDF or picture is
 * kept, the VIN is looked for in the subject, then the body, then inside the PDF itself; the open job for that car
 * takes the file as pre- or post-scan by its stage, and the advisor and the workshop manager hear "Scan report
 * received for <plate>". No match: the file waits in Unmatched scans, where the car is picked with one tap. An
 * email with nothing attached is kept for the owner to read.
 */
export async function processMail(mail: MailIn, opts: { keepEmailOnNoFiles?: boolean } = {}): Promise<MailResult> {
  const admin = createAdminClient();
  const subject = (mail.subject ?? "").slice(0, 300);
  let files = mail.attachments.filter((a) => (isPdf(a) || isImage(a)) && a.bytes.length > 0 && a.bytes.length <= 35 * 1024 * 1024);
  // Autel sends a LINK instead of an attachment: fetch the report at once (their links expire).
  // Only autel.com / auteltech.com are ever followed, time-limited and size-capped (src/lib/autel.ts).
  let sourceUrl: string | null = null;
  if (!files.length && isAutelSender(mail.from)) {
    for (const link of autelLinksIn(`${subject}\n${mail.text ?? ""}`)) {
      const got = await fetchAutelReport(link);
      if ("bytes" in got) {
        files = [{ name: got.fileName, contentType: got.contentType, bytes: got.bytes }];
        sourceUrl = link;
        break;
      }
    }
  }
  const reportId = reportIdOf(`${subject}\n${(mail.text ?? "").slice(0, 2000)}`);
  const carHint = carHintOf(subject);
  if (!files.length) {
    if (opts.keepEmailOnNoFiles !== false) await admin.from("inbound_emails").insert({ from_email: mail.from, subject: subject || null, text_body: (mail.text ?? "").slice(0, 20000) || null, gmail_message_id: mail.messageId });
    return { stored: 0, matched: false, jobNumber: null, kept: true, vin: null };
  }
  // The VIN: the subject, the body, the file names (Autel puts it in the file name), then inside the PDF.
  let vin = (subject.match(VIN_RE)?.[0] ?? (mail.text ?? "").match(VIN_RE)?.[0] ?? files.map((f) => f.name).join(" ").match(VIN_RE)?.[0] ?? "").toUpperCase() || null;
  if (!vin) {
    for (const f of files.filter(isPdf)) {
      try {
        const read = await readPdfRows(f.bytes);
        const found = read.vin ?? read.text.match(VIN_RE)?.[0] ?? null;
        if (found) { vin = found.toUpperCase(); break; }
      } catch {
        // An unreadable PDF: the subject and body were the only clues.
      }
    }
  }
  type Job = { id: string; job_number: string; status: string; department: string | null; assigned_to: string | null; gated_in_by: string | null; vehicle: Parameters<typeof formatPlate>[0] | null };
  let job: Job | null = null;
  if (vin) {
    const { data } = await admin.from("jobs").select("id, job_number, status, department, assigned_to, gated_in_by, vehicle:vehicles!inner(vin, kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant)").eq("is_open", true).ilike("vehicle.vin", vin).order("gated_in_at", { ascending: false }).limit(1).maybeSingle();
    job = (data as unknown as Job | null) ?? null;
  }
  let stored = 0;
  for (const f of files) {
    const safeName = f.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "scan";
    const path = `${job ? job.id : "unmatched"}/${Date.now()}-${stored}-${safeName}`;
    const contentType = isPdf(f) ? "application/pdf" : f.contentType.toLowerCase() === "text/html" ? "text/html" : f.contentType.toLowerCase().startsWith("image/") ? f.contentType.toLowerCase() : "image/jpeg";
    const { error: upError } = await admin.storage.from(SCANS_BUCKET).upload(path, f.bytes, { contentType, upsert: false });
    if (upError) continue;
    const kind = job ? scanKindFor(job.status) : null;
    await admin.from("inbound_scans").insert({ from_email: mail.from, subject, vin, storage_path: path, content_type: contentType, file_name: f.name, job_id: job?.id ?? null, kind, status: job ? "matched" : "unmatched", gmail_message_id: mail.messageId, source_url: sourceUrl, report_id: reportId, car_hint: carHint });
    stored++;
    if (job && kind === "pre" && isPdf(f)) await attachPrescan(job.id, f.bytes, f.name);
  }
  if (!stored) {
    if (opts.keepEmailOnNoFiles === false) return { stored: 0, matched: false, jobNumber: null, kept: false, vin };
    await admin.from("inbound_emails").insert({ from_email: mail.from, subject: subject || null, text_body: `${(mail.text ?? "").slice(0, 19000)}\n\n(${files.length} attachment${files.length === 1 ? "" : "s"} could not be kept)`, gmail_message_id: mail.messageId });
    return { stored: 0, matched: false, jobNumber: null, kept: true, vin };
  }
  if (job) {
    const plate = job.vehicle ? formatPlate(job.vehicle) : job.job_number;
    const kind = scanKindFor(job.status);
    const n = { type: "scan_received", title: `Scan report received for ${plate}`, body: `${stored} file${stored === 1 ? "" : "s"} from the scanner (${kind === "pre" ? "pre-scan" : "post-scan"}), ${job.job_number}.`, jobId: job.id, href: `/jobs/${job.id}` };
    const { data: appr } = await admin.from("approval_requests").select("sent_by").eq("job_id", job.id);
    const advisors = Array.from(new Set([job.gated_in_by, ...(appr ?? []).map((a) => a.sent_by as string | null)].filter((x): x is string => !!x)));
    await notifyStaff(advisors, n);
    await notifyManagers(job.department, n);
    if (job.assigned_to) await notifyStaff([job.assigned_to], { ...n, href: `/my-jobs/${job.id}` });
    await admin.from("job_events").insert({ job_id: job.id, event_type: "scan_received", note: `${kind === "pre" ? "Pre-scan" : "Post-scan"} report received by email (${stored} file${stored === 1 ? "" : "s"})` });
    return { stored, matched: true, jobNumber: job.job_number, kept: false, vin };
  }
  await notifyRoles(["owner", "workshop_manager"], { type: "scan_unmatched", title: "Scan report with no matching car", body: `${subject || "No subject"}${vin ? ` · VIN ${vin}` : " · no VIN found"}. Pick the car on the Scan reports page.`, href: "/scans" });
  return { stored, matched: false, jobNumber: null, kept: false, vin };
}

export type MailboxCheck = { ok: boolean; checked: number; stored: number; matched: number; kept: number; skipped: number; error?: string; at: string };

/** The Google sign-in is set up in Vercel (client ID, secret, the mailbox address); the owner still connects it once. */
export function mailboxConfigured(): boolean {
  return oauthConfigured() && !!scansMailbox();
}

/**
 * Reads the scans mailbox (gmail.readonly, nothing is changed in Gmail): every message of the last three days that
 * has not been processed yet is taken through processMail. The result is written to Settings for the Scan reports
 * page. Runs every five minutes from the Vercel cron and on "Check now".
 */
export async function checkScansMailbox(): Promise<MailboxCheck> {
  const at = new Date().toISOString();
  const admin = createAdminClient();
  const finish = async (r: MailboxCheck) => {
    await admin.from("settings").update({ value: r }).eq("key", "scans_mailbox_last_check");
    return r;
  };
  const mailbox = scansMailbox();
  if (!mailboxConfigured() || !mailbox) return finish({ ok: false, checked: 0, stored: 0, matched: 0, kept: 0, skipped: 0, at, error: "Mailbox not set up yet: add GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and SCANS_MAILBOX in Vercel." });
  if (!(await mailboxConnection())) return finish({ ok: false, checked: 0, stored: 0, matched: 0, kept: 0, skipped: 0, at, error: "Mailbox not connected yet: the owner presses Connect on the Scan reports page." });
  try {
    const ids = await listMessages("newer_than:3d", 30);
    if (!ids.length) return finish({ ok: true, checked: 0, stored: 0, matched: 0, kept: 0, skipped: 0, at });
    const [{ data: seenScans }, { data: seenMails }] = await Promise.all([
      admin.from("inbound_scans").select("gmail_message_id").in("gmail_message_id", ids),
      admin.from("inbound_emails").select("gmail_message_id").in("gmail_message_id", ids),
    ]);
    const seen = new Set([...(seenScans ?? []).map((r) => r.gmail_message_id as string), ...(seenMails ?? []).map((r) => r.gmail_message_id as string)]);
    const result: MailboxCheck = { ok: true, checked: 0, stored: 0, matched: 0, kept: 0, skipped: 0, at };
    for (const id of ids) {
      if (seen.has(id)) { result.skipped++; continue; }
      const msg: GmailMessage = await getMessage(id);
      const attachments: MailAttachmentIn[] = [];
      for (const a of attachmentsOf(msg)) {
        const bytes = a.data ?? (a.attachmentId ? await getAttachment(id, a.attachmentId) : null);
        if (bytes) attachments.push({ name: a.filename || "attachment", contentType: a.mimeType, bytes });
      }
      const r = await processMail({ messageId: id, from: headerOf(msg, "From"), subject: headerOf(msg, "Subject") ?? "", text: textBodyOf(msg), attachments });
      result.checked++;
      result.stored += r.stored;
      if (r.matched) result.matched++;
      if (r.kept) result.kept++;
    }
    return finish(result);
  } catch (e) {
    return finish({ ok: false, checked: 0, stored: 0, matched: 0, kept: 0, skipped: 0, at, error: e instanceof Error ? e.message : String(e) });
  }
}
