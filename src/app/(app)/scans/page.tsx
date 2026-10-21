import Link from "next/link";
import { Badge, Button, Card, Empty, Notice, PageHeader, SectionLabel, Select } from "@/components/ui";
import { LiveRefresh } from "@/components/LiveRefresh";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { SCANS_BUCKET } from "@/lib/scans";
import { attachScan, ignoreScan, dismissInboundEmail, checkMailboxNow, disconnectMailboxAction, reprocessEmail } from "./actions";
import { mailboxConfigured, type MailboxCheck } from "@/lib/mailbox";
import { mailboxConnection } from "@/lib/google-mailbox";
import { scansMailbox } from "@/lib/gmail";

export const dynamic = "force-dynamic";

type Scan = { id: string; received_at: string; from_email: string | null; subject: string | null; vin: string | null; storage_path: string; file_name: string | null; job_id: string | null; kind: string | null; status: string; source_url: string | null; report_id: string | null; car_hint: string | null; job: { job_number: string; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null } | null } | null };

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
    admin.from("inbound_scans").select("id, received_at, from_email, subject, vin, storage_path, file_name, job_id, kind, status, source_url, report_id, car_hint, job:jobs(job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin))").eq("is_active", true).order("received_at", { ascending: false }).limit(200),
    admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, make:vehicle_makes(name))").eq("is_open", true).order("gated_in_at", { ascending: false }),
  ]);
  const scans = (rows ?? []) as unknown as Scan[];
  const { data: signed } = scans.length ? await admin.storage.from(SCANS_BUCKET).createSignedUrls(scans.map((s) => s.storage_path), 3600) : { data: [] };
  const urls = new Map((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl]));
  const unmatched = scans.filter((s) => s.status === "unmatched");
  const rest = scans.filter((s) => s.status !== "unmatched");
  type OpenJobRow = { id: string; job_number: string; vehicle: ({ has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; kind?: string | null; model_year: number | null; make: { name: string } | null }) | null };
  const openJobRows = (jobs ?? []) as unknown as OpenJobRow[];
  const openJobs = openJobRows.map((j) => ({ id: j.id, label: `${j.vehicle ? formatPlate(j.vehicle) : j.job_number} · ${j.job_number}${j.vehicle?.vin ? ` · ${j.vehicle.vin}` : ""}` }));
  // "2011 Porsche" from the subject: the open cars of that make (and year when it matches) as one-tap suggestions.
  const suggestionsFor = (hint: string | null) => {
    if (!hint) return [];
    const m = /^(\d{4})\s+(.+)$/.exec(hint.trim());
    const year = m ? Number(m[1]) : null;
    const make = (m ? m[2] : hint).trim().toLowerCase();
    const byMake = openJobRows.filter((j) => (j.vehicle?.make?.name ?? "").toLowerCase().includes(make));
    const exact = year ? byMake.filter((j) => j.vehicle?.model_year === year) : byMake;
    return (exact.length ? exact : byMake).slice(0, 3).map((j) => ({ id: j.id, label: `${j.vehicle ? formatPlate(j.vehicle) : j.job_number} · ${j.job_number}` }));
  };
  const lastCheck = (settings.scans_mailbox_last_check ?? null) as MailboxCheck | null;
  const mailbox = scansMailbox();
  const configured = mailboxConfigured();
  const connection = configured ? await mailboxConnection() : null;
  const ownerHere = role === "owner" && !staff.viewingAs;

  const row = (s: Scan) => (
    <li key={s.id} className="py-3 flex flex-col gap-2" data-flash-id={s.id}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <a href={urls.get(s.storage_path) ?? "#"} target="_blank" rel="noreferrer" className="font-bold underline underline-offset-4">{s.file_name ?? "scan.pdf"}</a>
        {s.kind ? <Badge tone="ink">{s.kind === "pre" ? "Pre-scan" : "Post-scan"}</Badge> : null}
        <Badge tone={s.status === "unmatched" ? "amber" : s.status === "ignored" ? "neutral" : "green"}>{s.status === "unmatched" ? "No matching car" : s.status === "ignored" ? "Ignored" : s.status === "attached" ? "Attached by hand" : "Matched by VIN"}</Badge>
        <span className="text-xs text-muted">{formatDateTime(s.received_at)}{s.from_email ? ` · from ${s.from_email}` : ""}</span>
      </div>
      <span className="text-xs text-muted">{s.subject || "No subject"}{s.vin ? ` · VIN ${s.vin}` : " · no VIN found"}{s.report_id ? ` · Report ${s.report_id}` : ""}{s.source_url ? " · fetched from the Autel link" : ""}</span>
      {s.job ? <Link href={`/jobs/${s.job_id}`} className="text-sm font-semibold underline underline-offset-4">{s.job.vehicle ? formatPlate(s.job.vehicle) : ""} · {s.job.job_number}</Link> : null}
      {s.status === "unmatched" && canAttach && suggestionsFor(s.car_hint).length ? (
        <div className="flex flex-wrap items-center gap-2" data-scan-suggestions>
          <span className="text-xs font-semibold text-muted">Looks like {s.car_hint}:</span>
          {suggestionsFor(s.car_hint).map((sg) => (
            <form key={sg.id} action={attachScan.bind(null, s.id)}>
              <input type="hidden" name="job_id" value={sg.id} />
              <Button type="submit" tone="secondary" size="md" data-suggest-attach>Attach to {sg.label}</Button>
            </form>
          ))}
        </div>
      ) : null}
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
      {/* Section 10: a new report appears in the lists by itself and flashes its row. */}
      <LiveRefresh tables={["inbound_scans"]} pollMs={20000} />
      <PageHeader title="Scan reports" subtitle={`Autel reports read from ${mailbox || "the scans mailbox"} every five minutes. Matched by the VIN (subject, body or inside the report) to the open job; the rest wait here.`} actions={canAttach ? <form action={checkMailboxNow}><Button type="submit" size="lg" data-check-mailbox>Check the mailbox now</Button></form> : undefined} />
      <div className="flex flex-wrap items-center gap-2 text-sm" data-mailbox-status>
        {!configured ? <Badge tone="amber">Mailbox not set up yet</Badge> : !connection ? <Badge tone="amber">Mailbox not connected yet</Badge> : connection.last_error ? <Badge tone="red">Mailbox problem</Badge> : <Badge tone="green">Connected as {connection.mailbox}</Badge>}
        {connection ? <span className="text-muted" data-mailbox-connected>Read only · connected {formatDateTime(connection.connected_at)}{connection.connected_by_name ? ` by ${connection.connected_by_name}` : ""}</span> : null}
        {connection?.last_error ? <span className="font-semibold text-red" data-mailbox-error>{connection.last_error}</span> : null}
        {connection && lastCheck?.at ? <span className="text-muted">Last checked {formatDateTime(lastCheck.at)}{lastCheck.ok ? ` · ${lastCheck.checked} new, ${lastCheck.stored} file${lastCheck.stored === 1 ? "" : "s"} kept` : `: ${lastCheck.error ?? ""}`}</span> : null}
        {!configured && role === "owner" ? <span className="text-muted">Add GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and SCANS_MAILBOX in Vercel (the steps are in the delivery note).</span> : null}
        {configured && !connection && role !== "owner" ? <span className="text-muted">The owner connects it once.</span> : null}
        {configured && ownerHere && (!connection || connection.last_error) ? <a href="/api/google/mailbox/connect" className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-white" data-connect-mailbox>Connect {mailbox || "the scans mailbox"}</a> : null}
        {connection && ownerHere ? <form action={disconnectMailboxAction}><Button type="submit" tone="ghost" size="md" data-disconnect-mailbox>Disconnect</Button></form> : null}
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
                  <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold">{m.subject ?? "(no subject)"}</span><span className="text-xs text-muted">{m.from_email ?? ""} · {formatDateTime(m.received_at)}</span><span className="ml-auto inline-flex gap-2">{ownerHere ? <form action={reprocessEmail.bind(null, m.id)}><Button type="submit" tone="secondary" size="md" data-reprocess-email>Treat as a scan report</Button></form> : null}<form action={dismissInboundEmail.bind(null, m.id)}><Button type="submit" tone="ghost" size="md">Put away</Button></form></span></div>
                  {m.text_body ? <pre className="whitespace-pre-wrap rounded-control bg-chip p-3 text-xs font-sans">{m.text_body.slice(0, 4000)}</pre> : null}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="flex flex-col gap-3">
            <SectionLabel>Where the reports come from</SectionLabel>
            <p className="text-xs text-muted">The system reads {mailbox || "scans@ofjauto.com"} through a one-time Google sign-in as that account (Connect, above): read only, and Google limits the permission to that one mailbox. Nothing is moved or deleted. It checks every five minutes and on &quot;Check the mailbox now&quot;. Point the Autel scanner&apos;s email at that address. The Google Cloud steps and the three Vercel variable names are in the delivery note (docs/16-oct-note.md).</p>
          </Card>
        </>
      ) : null}
    </>
  );
}
