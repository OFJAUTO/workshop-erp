import Link from "next/link";
import { Badge, Button, Card, Empty, Notice, PageHeader, SectionLabel, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { SCANS_BUCKET } from "@/lib/scans";
import { attachScan, ignoreScan, dismissInboundEmail, checkMailboxNow } from "./actions";
import { mailboxConfigured, type MailboxCheck } from "@/lib/mailbox";
import { scansMailbox } from "@/lib/gmail";

export const dynamic = "force-dynamic";

type Scan = { id: string; received_at: string; from_email: string | null; subject: string | null; vin: string | null; storage_path: string; file_name: string | null; job_id: string | null; kind: string | null; status: string; job: { job_number: string; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null } | null } | null };

/** Scan reports that arrived by email: the unmatched ones to attach by hand, and the recent matched ones. */
export default async function ScansPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const { message, error } = await searchParams;
  const canAttach = can(role, "approveInspections") && !staff.viewingAs;
  const admin = createAdminClient();
  const settings = await getSettings();
  const { data: otherRows } = role === "owner" ? await createAdminClient().from("inbound_emails").select("id, received_at, from_email, subject, text_body").eq("is_active", true).order("received_at", { ascending: false }).limit(30) : { data: [] as { id: string; received_at: string; from_email: string | null; subject: string | null; text_body: string | null }[] };
  const otherEmails = (otherRows ?? []) as { id: string; received_at: string; from_email: string | null; subject: string | null; text_body: string | null }[];
  const [{ data: rows }, { data: jobs }] = await Promise.all([
    admin.from("inbound_scans").select("id, received_at, from_email, subject, vin, storage_path, file_name, job_id, kind, status, job:jobs(job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin))").eq("is_active", true).order("received_at", { ascending: false }).limit(200),
    admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin)").eq("is_open", true).order("gated_in_at", { ascending: false }),
  ]);
  const scans = (rows ?? []) as unknown as Scan[];
  const { data: signed } = scans.length ? await admin.storage.from(SCANS_BUCKET).createSignedUrls(scans.map((s) => s.storage_path), 3600) : { data: [] };
  const urls = new Map((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl]));
  const unmatched = scans.filter((s) => s.status === "unmatched");
  const rest = scans.filter((s) => s.status !== "unmatched");
  const openJobs = ((jobs ?? []) as unknown as { id: string; job_number: string; vehicle: Scan["job"] extends infer J ? (J extends { vehicle: infer V } ? V : never) : never }[]).map((j) => ({ id: j.id, label: `${j.vehicle ? formatPlate(j.vehicle) : j.job_number} · ${j.job_number}${j.vehicle?.vin ? ` · ${j.vehicle.vin}` : ""}` }));
  const lastCheck = (settings.scans_mailbox_last_check ?? null) as MailboxCheck | null;
  const mailbox = scansMailbox();
  const configured = mailboxConfigured();

  const row = (s: Scan) => (
    <li key={s.id} className="py-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <a href={urls.get(s.storage_path) ?? "#"} target="_blank" rel="noreferrer" className="font-bold underline underline-offset-4">{s.file_name ?? "scan.pdf"}</a>
        {s.kind ? <Badge tone="ink">{s.kind === "pre" ? "Pre-scan" : "Post-scan"}</Badge> : null}
        <Badge tone={s.status === "unmatched" ? "amber" : s.status === "ignored" ? "neutral" : "green"}>{s.status === "unmatched" ? "No matching car" : s.status === "ignored" ? "Ignored" : s.status === "attached" ? "Attached by hand" : "Matched by VIN"}</Badge>
        <span className="text-xs text-muted">{formatDateTime(s.received_at)}{s.from_email ? ` · from ${s.from_email}` : ""}</span>
      </div>
      <span className="text-xs text-muted">{s.subject || "No subject"}{s.vin ? ` · VIN ${s.vin}` : " · no VIN found"}</span>
      {s.job ? <Link href={`/jobs/${s.job_id}`} className="text-sm font-semibold underline underline-offset-4">{s.job.vehicle ? formatPlate(s.job.vehicle) : ""} · {s.job.job_number}</Link> : null}
      {s.status === "unmatched" && canAttach ? (
        <div className="flex flex-wrap items-end gap-2">
          <form action={attachScan.bind(null, s.id)} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Attach to the job</span>
              <Select name="job_id" defaultValue="" required className="min-w-64">
                <option value="" disabled>Choose the car…</option>
                {openJobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.label}</option>
                ))}
              </Select>
            </label>
            <Button type="submit" size="md">Attach</Button>
          </form>
          <form action={ignoreScan.bind(null, s.id)}><Button type="submit" tone="secondary" size="md">Ignore</Button></form>
        </div>
      ) : null}
    </li>
  );

  return (
    <>
      <PageHeader title="Scan reports" subtitle={`Autel reports read from ${mailbox || "the scans mailbox"} every five minutes. Matched by the VIN (subject, body or inside the report) to the open job; the rest wait here.`} actions={canAttach ? <form action={checkMailboxNow}><Button type="submit" size="lg" data-check-mailbox>Check the mailbox now</Button></form> : undefined} />
      <div className="flex flex-wrap items-center gap-2 text-sm" data-mailbox-status>
        {!configured ? <Badge tone="amber">Mailbox not connected yet</Badge> : lastCheck?.at ? <Badge tone={lastCheck.ok ? "green" : "red"}>{lastCheck.ok ? "Mailbox connected" : "Mailbox problem"}</Badge> : <Badge tone="neutral">Not checked yet</Badge>}
        {lastCheck?.at ? <span className="text-muted">Last checked {formatDateTime(lastCheck.at)}{lastCheck.ok ? ` · ${lastCheck.checked} new, ${lastCheck.stored} file${lastCheck.stored === 1 ? "" : "s"} kept` : `: ${lastCheck.error ?? ""}`}</span> : null}
        {!configured && role === "owner" ? <span className="text-muted">Add GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY and SCANS_MAILBOX in Vercel (the steps are in the delivery note).</span> : null}
      </div>
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${unmatched.length}`}>Unmatched scans</SectionLabel>
        {unmatched.length ? <ul className="divide-y divide-line">{unmatched.map(row)}</ul> : <Empty title="Nothing waiting" />}
      </Card>
      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${rest.length}`}>Recent scans</SectionLabel>
        {rest.length ? <ul className="divide-y divide-line">{rest.slice(0, 60).map(row)}</ul> : <p className="text-sm text-muted">No scans received yet.</p>}
      </Card>
      {role === "owner" ? (
        <>
          <Card className="flex flex-col gap-3">
            <SectionLabel right={`${otherEmails.length}`}>Other emails</SectionLabel>
            <p className="text-xs text-muted">Emails that arrived without a scan report: a forwarding confirmation from Gmail, a reply. Read the code here, then put the email away.</p>
            {otherEmails.length === 0 ? <p className="text-sm text-muted">None.</p> : null}
            <ul className="divide-y divide-line">
              {otherEmails.map((m) => (
                <li key={m.id} className="py-2 flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold">{m.subject ?? "(no subject)"}</span><span className="text-xs text-muted">{m.from_email ?? ""} · {formatDateTime(m.received_at)}</span><form action={dismissInboundEmail.bind(null, m.id)} className="ml-auto"><Button type="submit" tone="ghost" size="md">Put away</Button></form></div>
                  {m.text_body ? <pre className="whitespace-pre-wrap rounded-control bg-chip p-3 text-xs font-sans">{m.text_body.slice(0, 4000)}</pre> : null}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="flex flex-col gap-3">
            <SectionLabel>Where the reports come from</SectionLabel>
            <p className="text-xs text-muted">The system reads the mailbox {mailbox || "scans@ofjauto.com"} directly (read only, nothing is moved or deleted), every five minutes and on &quot;Check the mailbox now&quot;. Point the Autel scanner&apos;s email at that address. The one-time Google Workspace and Google Cloud steps, and the three Vercel variable names, are in the delivery note (docs/16-oct-note.md).</p>
          </Card>
        </>
      ) : null}
    </>
  );
}
