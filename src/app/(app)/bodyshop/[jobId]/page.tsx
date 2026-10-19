import { VinCopy } from "@/components/VinCopy";
import Link from "next/link";
import { CarHeaderThumb } from "@/components/CarHeaderThumb";
import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Avatar, Badge, Button, Card, Input, LinkButton, Notice, PageHeader, SectionLabel, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { bodyshopLabourCost, loadBodyshopJob, type StageRow } from "@/lib/bodyshop";
import { BODYSHOP_KIND_LABELS, SECTION_LABELS, SECTIONS, STAGE_DEFS, sectionOfDepartment, signoffKeyOf, type BodyshopKind, type StageSection } from "@/lib/bodyshop-kinds";
import { formatDate, formatDateTime } from "@/lib/format";
import { dubaiDate } from "@/lib/jobs";
import { INVOICE_SELECT, toInvoice } from "@/lib/invoice-data";
import { approvedQuotations } from "@/lib/quote-data";
import { aed } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { getSiteUrl, PRODUCTION_SITE_URL } from "@/lib/site";
import { shortFor } from "@/lib/short-links";
import { greetingNameOf } from "@/lib/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { JOB_FILE_SELECT, signJobFiles } from "@/lib/work-data";
import { addStageAction, afterPhotoAction, assignAction, bookArrivalAction, clockAction, moveStageAction, notReadyAction, refitTickAction, removeStageAction, removedItemAction, reopenStageAction, requestDepositAction, setStageDueAction, signOffAction, stageDoneAction, startWorkAction, updatePhotoAction, updateSentAction } from "../actions";
import { RemovedItemForm } from "./RemovedItemForm";
import { SignoffPanel } from "./SignoffPanel";
import { UpdatesPanel, type UpdateState } from "./UpdatesPanel";

export const dynamic = "force-dynamic";

const BODYSHOP_DEPTS = ["bodyshop", "paint", "ppf_tint", "detailing"];
const hm = (m: number) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;

/**
 * One bodyshop car: before arrival the booking, the deposit and the quotation; after gate-in the stages with their
 * due dates, who is on the car, the removed-items checklist, the customer updates, the release sign-off and the
 * handover link. Team leaders see no prices; the owner sees the profit of the car.
 */
export default async function BodyshopJobPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!can(role, "viewBodyshop")) notFound();
  const { jobId } = await params;
  const { message, error } = await searchParams;
  const [data, settings, site] = await Promise.all([loadBodyshopJob(jobId), getSettings(), getSiteUrl()]);
  if (!data) notFound();
  const { job, stages, assignments, clockings, signoffs, removedItems, updates, kinds, film, tintPercent, people } = data;
  const v = job.vehicle;
  const admin = createAdminClient();
  const { data: vinRow } = await admin.from("vehicles").select("vin").eq("id", job.vehicle_id).maybeSingle();
  const isOwner = role === "owner";
  const isBodyshopManager = role === "workshop_manager" && BODYSHOP_DEPTS.includes(staff.department_id ?? "");
  const canManage = !staff.viewingAs && (isOwner || isBodyshopManager);
  const canLead = !staff.viewingAs && (isOwner || isBodyshopManager || role === "team_leader");
  const canQuote = !staff.viewingAs && can(role, "bodyshopQuote");
  const seesMoney = isOwner || role === "accounts" || role === "service_advisor";
  const mySection = sectionOfDepartment(staff.department_id);
  const myKey = signoffKeyOf(role, staff.department_id);
  // A server page: today is read once.
  const today = dubaiDate();
  const [{ data: quoteRows }, approved, { data: depositRows }, { data: photoRows }, labour] = await Promise.all([
    admin.from("quotations").select("id, number, status, total_aed, sent_at, responded_at").eq("job_id", jobId).eq("is_active", true).eq("kind", "quotation").order("created_at", { ascending: false }),
    approvedQuotations(jobId),
    admin.from("invoices").select(INVOICE_SELECT).eq("job_id", jobId).eq("kind", "proforma").eq("is_active", true).not("deposit_for_quotation_id", "is", null).order("issued_at", { ascending: false }),
    admin.from("job_files").select(JOB_FILE_SELECT).eq("job_id", jobId).in("kind", ["bodyshop_photo", "work_photo", "wash_photo", "gate_out_photo"]).order("taken_at"),
    seesMoney ? bodyshopLabourCost(jobId, settings) : Promise.resolve({ minutes: 0, cost: 0 }),
  ]);
  const quotes = (quoteRows ?? []) as { id: string; number: string; status: string; total_aed: number | string | null; sent_at: string | null; responded_at: string | null }[];
  const latestQuote = quotes[0] ?? null;
  const approvedQuote = approved[0] ?? null;
  const deposits = ((depositRows ?? []) as Record<string, unknown>[]).map(toInvoice);
  const photos = (photoRows ?? []) as { id: string; storage_path: string; caption: string | null; content_type: string | null }[];
  const photoUrls = await signJobFiles(photos.map((p) => p.storage_path));
  const photoFiles = photos.map((p) => ({ id: p.id, path: p.storage_path, url: photoUrls[p.storage_path] ?? null, caption: p.caption, contentType: p.content_type }));
  const customerName = data.customer?.company_name ?? data.customer?.full_name ?? "Customer";
  const carName = [v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" ");
  const phoneDigits = (data.customer?.phone ?? "").replace(/[^\d]/g, "");
  const fill = (tpl: string, link: string) => tpl.replaceAll("[make model]", [v?.make?.name, v?.model?.name].filter(Boolean).join(" ")).replaceAll("[plate]", v ? formatPlate(v) : "").replaceAll("[name]", greetingNameOf(data.customer)).replaceAll("[link]", link);
  const updateStates: UpdateState[] = [];
  for (const kind of ["arrived", "film", "ready"] as const) {
    const u = updates.find((x) => x.kind === kind);
    const long = kind === "ready" ? (job.bodyshop_handover_token ? `${PRODUCTION_SITE_URL}/handover/${job.bodyshop_handover_token}` : null) : u ? `${PRODUCTION_SITE_URL}/progress/${u.token}` : null;
    const link = long ? await shortFor(long) : null;
    const tpl = String(kind === "arrived" ? settings.whatsapp_bodyshop_arrived_template : kind === "film" ? settings.whatsapp_bodyshop_film_template : settings.whatsapp_bodyshop_ready_template);
    updateStates.push({ kind, title: kind === "arrived" ? "Your car has arrived" : kind === "film" ? "Film is going on" : "Your car is ready for collection", photoId: u?.photo_id ?? null, token: u?.token ?? null, sentAt: u?.sent_at ?? null, message: link ? fill(tpl, link) : null });
  }
  const booked = job.status === "booked";
  const statusLabel = booked ? "Booked, not arrived" : job.status === "in_work" ? "In the bodyshop" : job.status === "ready" || job.status === "pending_payment" ? "Ready, waiting for the handover" : job.status === "closed" ? "Handed over" : job.status.replaceAll("_", " ");
  const openClockBy = new Set(clockings.filter((c) => !c.ended_at).map((c) => c.staff_id));
  const stripOrRefit = stages.some((s) => s.key === "strip" || s.key === "refit" || s.key === "repair");
  const needsSignoff = stages.length > 0 && (job.status === "ready" || job.status === "pending_payment" || job.status === "in_work");
  const stageTone = (s: StageRow) => (s.status === "done" ? "done" : s.due_date && s.due_date < today ? "red" : s.due_date === today ? "amber" : "normal");
  const kindWords = kinds.map((k) => BODYSHOP_KIND_LABELS[k as BodyshopKind] ?? k);

  return (
    <>
      <LiveRefresh tables={["jobs", "bodyshop_stages", "bodyshop_assignments", "bodyshop_clockings", "bodyshop_signoffs"]} jobId={jobId} />
      <PageHeader
        picture={<CarHeaderThumb vehicleId={job.vehicle_id} />}
        title={`${v ? formatPlate(v) : job.job_number} · ${carName}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{job.job_number}{v?.colour ? ` · ${v.colour}` : ""}{seesMoney ? ` · ${customerName}` : ""}</span>
            <VinCopy vin={vinRow?.vin ?? null} />
            <Badge tone={job.status === "closed" ? "neutral" : job.status === "ready" ? "green" : "ink"}>{statusLabel}</Badge>
            {job.promised_at ? <Badge tone={job.promised_at < today && job.is_open ? "red" : job.promised_at === today ? "amber" : "neutral"}>Handover {formatDate(job.promised_at)}</Badge> : null}
            {kindWords.length ? <span className="text-sm text-muted">{kindWords.join(", ")}{film?.colour || film?.code ? ` · film ${[film.colour, film.code].filter(Boolean).join(" ")}` : ""}{tintPercent ? ` · tint ${tintPercent}%` : ""}</span> : null}
          </span>
        }
        actions={
          <>
            <LinkButton href="/bodyshop" tone="secondary" size="lg">Board</LinkButton>
            {!booked && can(role, "viewJobs") ? <LinkButton href={`/jobs/${jobId}`} tone="secondary" size="lg">Job card</LinkButton> : null}
            {latestQuote && (isOwner || role === "service_advisor") ? <LinkButton href={`/jobs/${jobId}/quote/${latestQuote.id}`} tone="secondary" size="lg">Quotation {latestQuote.number}</LinkButton> : null}
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {booked ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card className="flex flex-col gap-3" data-booking-card>
            <SectionLabel>Before the car arrives</SectionLabel>
            <ol className="flex flex-col gap-2 text-sm">
              <li className="flex items-center gap-2"><span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold ${approvedQuote ? "bg-green text-white" : latestQuote?.status === "sent" || latestQuote?.status === "opened" ? "bg-amber-bar text-white" : "border border-line-strong"}`}>1</span><span>Quotation {latestQuote ? <>{latestQuote.number}: <span className="font-semibold">{approvedQuote ? `approved ${formatDate(latestQuote.responded_at)}` : latestQuote.status === "draft" ? "being built" : latestQuote.status === "sent" || latestQuote.status === "opened" ? "sent, waiting for the customer" : latestQuote.status}</span></> : "not started"}</span></li>
              <li className="flex items-center gap-2"><span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold ${job.booked_arrival_at ? "bg-green text-white" : "border border-line-strong"}`}>2</span><span>Arrival {job.booked_arrival_at ? <span className="font-semibold">{formatDateTime(job.booked_arrival_at)}</span> : "not booked"} · handover {job.promised_at ? <span className="font-semibold">{formatDate(job.promised_at)}</span> : "not set"}</span></li>
              <li className="flex items-center gap-2"><span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold ${deposits.length ? "bg-green text-white" : "border border-line-strong"}`}>3</span><span>Deposit {deposits.length ? <span className="font-semibold">{deposits[0].number} for {aed(deposits[0].total_aed)}</span> : "optional"}</span></li>
            </ol>
            <p className="text-xs text-muted">When the car arrives, gate it in from the calendar entry: the gate-in links to this quotation and nothing is retyped. The stages start by themselves once the gate-in photos are in.</p>
          </Card>
          {canQuote ? (
            <Card className="flex flex-col gap-3" data-book-card>
              <SectionLabel>Book the arrival and the handover</SectionLabel>
              <form action={bookArrivalAction.bind(null, jobId)} className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Arrival day</span><Input type="date" name="arrival_date" defaultValue={job.booked_arrival_at ? new Date(job.booked_arrival_at).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" }) : ""} required className="w-44" /></label>
                <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Time</span><Input type="time" name="arrival_time" defaultValue={job.booked_arrival_at ? new Date(job.booked_arrival_at).toLocaleTimeString("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false }) : "10:00"} className="w-32" /></label>
                <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Promised handover</span><Input type="date" name="promised_at" defaultValue={job.promised_at ?? ""} required className="w-44" /></label>
                <Button type="submit" size="md" data-book-submit>{job.booked_arrival_at ? "Change the booking" : "Book"}</Button>
              </form>
              {approvedQuote ? (
                <form action={requestDepositAction.bind(null, jobId)} className="flex flex-wrap items-end gap-3 border-t border-line pt-3" id="deposit">
                  <span className="w-full text-xs font-bold uppercase tracking-[0.08em] text-muted">Request deposit (optional)</span>
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Amount</span><Input name="amount" inputMode="decimal" placeholder="0" className="w-32" aria-label="Deposit amount" data-deposit-amount /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">As</span><Select name="kind" defaultValue="aed" className="w-36"><option value="aed">AED</option><option value="percent">% of {aed(approvedQuote.total_aed)}</option></Select></label>
                  <Button type="submit" tone="secondary" size="md" disabled={deposits.length > 0} data-deposit-submit>{deposits.length ? "Deposit requested" : "Request deposit"}</Button>
                  {deposits.length ? <span className="text-xs text-muted">{deposits[0].number} · send it from the job card once the car is in, or copy the link: {site}/proforma/{deposits[0].token}</span> : null}
                </form>
              ) : null}
            </Card>
          ) : null}
        </div>
      ) : null}

      {!booked && !job.bodyshop_started_at && job.is_open ? (
        <Card className="flex flex-col gap-2 border-ink">
          <SectionLabel>Not started yet</SectionLabel>
          <p className="text-sm">{kinds.length ? "The stages are built from the approved packages when the gate-in photos are complete." : "No approved bodyshop packages yet: the quotation has to be approved first."}</p>
          {canManage && kinds.length ? <form action={startWorkAction.bind(null, jobId)}><Button type="submit" size="md" data-start-work>Start the work now</Button></form> : null}
        </Card>
      ) : null}

      {stages.length ? (
        <Card id="stages" className="flex flex-col gap-3" data-stages-card>
          <SectionLabel right={`${stages.filter((s) => s.status === "done").length} of ${stages.length} done`}>Stages and due dates</SectionLabel>
          <ol className="divide-y divide-line">
            {stages.map((s, i) => {
              const tone = stageTone(s);
              const mayDone = canLead && s.status === "active" && (isOwner || isBodyshopManager || mySection === s.section || (s.section === "qc" && role === "team_leader") || (s.section === "handover" && false));
              return (
                <li key={s.id} className="py-2 flex flex-wrap items-center gap-2" data-stage={s.key} data-stage-status={s.status} data-tone={tone}>
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold ${s.status === "done" ? "bg-green text-white" : s.status === "active" ? "bg-ink text-white" : "border border-line-strong text-muted"}`}>{s.status === "done" ? "✓" : i + 1}</span>
                  <span className={`font-semibold ${s.status === "done" ? "text-muted" : ""}`}>{s.label}</span>
                  <Badge tone="outline">{SECTION_LABELS[s.section]}</Badge>
                  {s.status === "active" ? <Badge tone="ink">Now</Badge> : null}
                  {s.done_at ? <span className="text-xs text-muted">done {formatDateTime(s.done_at)}</span> : null}
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {canManage && s.status !== "done" ? (
                      <form action={setStageDueAction.bind(null, jobId, s.id)} className="flex items-center gap-1">
                        <Input type="date" name="date" defaultValue={s.due_date ?? ""} className={`h-9 min-h-9 w-40 text-xs ${tone === "red" ? "border-red-bar text-red font-bold" : tone === "amber" ? "border-amber-bar text-amber font-bold" : ""}`} aria-label={`Due date for ${s.label}`} data-stage-due />
                        <Button type="submit" tone="ghost" size="md">Save</Button>
                      </form>
                    ) : (
                      <span className={`text-xs ${tone === "red" ? "font-bold text-red" : tone === "amber" ? "font-bold text-amber" : "text-muted"}`} data-stage-due-text>{s.due_date ? (tone === "red" && s.status !== "done" ? `Late · due ${formatDate(s.due_date)}` : tone === "amber" && s.status !== "done" ? "Due today" : `Due ${formatDate(s.due_date)}`) : ""}</span>
                    )}
                    {mayDone && s.key !== "handover" ? <form action={stageDoneAction.bind(null, jobId, s.id)}><Button type="submit" size="md" data-stage-done={s.key}>Done</Button></form> : null}
                    {canManage && s.status === "done" && s.key !== "handover" ? <form action={reopenStageAction.bind(null, jobId, s.id)}><Button type="submit" tone="ghost" size="md">Reopen</Button></form> : null}
                    {canManage && s.status !== "done" && s.key !== "handover" ? (
                      <>
                        <form action={moveStageAction.bind(null, jobId, s.id, -1)}><Button type="submit" tone="ghost" size="md" aria-label="Move up">↑</Button></form>
                        <form action={moveStageAction.bind(null, jobId, s.id, 1)}><Button type="submit" tone="ghost" size="md" aria-label="Move down">↓</Button></form>
                        <form action={removeStageAction.bind(null, jobId, s.id)}><Button type="submit" tone="ghost" size="md" aria-label="Remove stage">Remove</Button></form>
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
          {canManage ? (
            <form action={addStageAction.bind(null, jobId)} className="flex flex-wrap items-end gap-2 border-t border-line pt-3" data-add-stage>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Add a stage</span><Select name="key" defaultValue="" className="w-56"><option value="">Choose…</option>{STAGE_DEFS.filter((d) => d.key !== "handover").map((d) => <option key={d.key} value={d.key}>{d.label} ({SECTION_LABELS[d.section]})</option>)}<option value="custom">Other (type it)</option></Select></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Or its name</span><Input name="label" placeholder="Stage name" className="w-48" textCase="sentence" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Team</span><Select name="section" defaultValue="detailing" className="w-40">{(["strip_refit", "ppf", "paint", "detailing", "electrical"] as StageSection[]).map((s) => <option key={s} value={s}>{SECTION_LABELS[s]}</option>)}</Select></label>
              <Button type="submit" tone="secondary" size="md">Add</Button>
            </form>
          ) : null}
        </Card>
      ) : null}

      {stages.length && stripOrRefit ? (
        <Card id="removed" className="flex flex-col gap-3" data-removed-card>
          <SectionLabel right={`${removedItems.filter((r) => r.refitted_at).length} of ${removedItems.length} back on`}>Removed at Strip, back on at Refit</SectionLabel>
          {removedItems.length === 0 ? <p className="text-sm text-muted">Nothing written down yet. Tick what comes off the car, with a photo.</p> : (
            <ul className="divide-y divide-line">
              {removedItems.map((r) => (
                <li key={r.id} className="py-2 flex flex-wrap items-center gap-2" data-removed-item>
                  <form action={refitTickAction.bind(null, jobId, r.id)}>
                    <input type="hidden" name="on" value={r.refitted_at ? "0" : "1"} />
                    <button type="submit" disabled={!canLead} className={`inline-flex min-h-10 items-center gap-2 rounded-control border px-3 text-sm font-bold ${r.refitted_at ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`} aria-pressed={!!r.refitted_at} data-refit-tick>{r.refitted_at ? "✓ Back on" : "Tick when back on"}</button>
                  </form>
                  <span className="font-semibold">{r.label}</span>
                  <span className="text-xs text-muted">off {formatDateTime(r.removed_at)}{r.refitted_at ? ` · on ${formatDateTime(r.refitted_at)}` : ""}{r.photo_path ? " · photo" : ""}</span>
                </li>
              ))}
            </ul>
          )}
          {canLead && job.is_open ? <RemovedItemForm jobId={jobId} action={removedItemAction.bind(null, jobId)} /> : null}
        </Card>
      ) : null}

      {!booked ? (
        <Card id="people" className="flex flex-col gap-3" data-people-card>
          <SectionLabel right={seesMoney || canLead ? `${hm(data.minutes)} clocked` : undefined}>Who is on the car</SectionLabel>
          <div className="flex flex-wrap items-center gap-2">
            {assignments.length === 0 ? <span className="text-sm text-muted">Nobody yet.</span> : null}
            {assignments.map((a) => (
              <span key={a.id} className={`inline-flex items-center gap-2 rounded-control border px-2.5 min-h-10 text-sm font-bold ${openClockBy.has(a.staff_id) ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`} data-on-car={a.staff_id}>
                <Avatar name={a.name} photoUrl={a.photoUrl} size={24} />{a.name}
                <span className="text-[11px] font-semibold text-muted">{SECTION_LABELS[a.section as StageSection] ?? a.section}{openClockBy.has(a.staff_id) ? " · clocked in" : ""}</span>
                {canLead && job.is_open ? (
                  <>
                    <form action={clockAction.bind(null, jobId)}><input type="hidden" name="staff_id" value={a.staff_id} />{openClockBy.has(a.staff_id) ? <input type="hidden" name="out" value="1" /> : null}<button type="submit" className="rounded-control border border-line px-2 py-0.5 text-[11px] font-bold" data-clock={openClockBy.has(a.staff_id) ? "out" : "in"}>{openClockBy.has(a.staff_id) ? "Clock out" : "Clock in"}</button></form>
                    <form action={assignAction.bind(null, jobId)}><input type="hidden" name="staff_id" value={a.staff_id} /><input type="hidden" name="off" value="1" /><button type="submit" className="text-muted px-1" aria-label={`Take ${a.name} off`}>✕</button></form>
                  </>
                ) : null}
              </span>
            ))}
          </div>
          {canLead && job.is_open ? (
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Put someone on the car (one tap)</span>
              {SECTIONS.map((sec) => {
                const list = people.staff.filter((p) => p.section === sec && !assignments.some((a) => a.staff_id === p.id));
                if (!list.length) return null;
                return (
                  <div key={sec} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-28 text-xs text-muted">{SECTION_LABELS[sec]}</span>
                    {list.map((p) => (
                      <form key={p.id} action={assignAction.bind(null, jobId)}><input type="hidden" name="staff_id" value={p.id} /><button type="submit" className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-line-strong bg-white px-2 text-xs font-bold" data-add-person={p.id}><Avatar name={p.name} photoUrl={p.photoUrl} size={20} />{p.name}</button></form>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : null}
        </Card>
      ) : null}

      {!booked && stages.length ? (
        <Card id="updates" className="flex flex-col gap-3" data-updates-card>
          <SectionLabel>Customer updates (one photo, one line, three moments)</SectionLabel>
          <UpdatesPanel jobId={jobId} updates={updateStates} photos={photoFiles} afterPhotoId={job.bodyshop_after_photo_id} phoneDigits={phoneDigits} canAct={canLead || canQuote} onPhoto={updatePhotoAction.bind(null, jobId)} onSent={updateSentAction.bind(null, jobId)} onAfterPhoto={afterPhotoAction.bind(null, jobId)} />
          {job.bodyshop_handover_token ? <p className="text-xs text-muted">Handover page: <Link href={`/handover/${job.bodyshop_handover_token}`} target="_blank" className="font-semibold underline underline-offset-4">{site}/handover/{job.bodyshop_handover_token.slice(0, 8)}…</Link>{kinds.includes("ppf") || kinds.includes("coloured_ppf") ? <> · <Link href={`/api/pdf/warranty/${job.bodyshop_handover_token}`} target="_blank" className="font-semibold underline underline-offset-4">Warranty certificate (PDF)</Link></> : null}</p> : null}
        </Card>
      ) : null}

      {needsSignoff ? (
        <Card id="signoff" className={`flex flex-col gap-3 ${data.waitingOn.length ? "border-ink" : "border-green"}`} data-signoff-card>
          <SectionLabel right={job.status === "in_work" ? "after the work" : undefined}>Release sign-off</SectionLabel>
          {job.status === "in_work" ? <p className="text-xs text-muted">The sign-off opens when the work is complete. Who is needed: {data.needed.map((k) => ({ manager: "the bodyshop manager", ppf: "the PPF leader", detailing: "the detailing leader", paint: "the paint leader" })[k]).join(", ")}.</p> : null}
          <SignoffPanel needed={data.needed} signed={signoffs.map((s) => ({ role_key: s.role_key, name: s.name, signed_at: s.signed_at, on_behalf: s.on_behalf }))} mine={myKey} isOwner={isOwner} canAct={!staff.viewingAs && job.status !== "in_work" && job.is_open} onSign={signOffAction.bind(null, jobId)} onNotReady={notReadyAction.bind(null, jobId)} />
          {data.waitingOn.length === 0 && job.is_open && can(role, "gateOut") ? <LinkButton href={`/jobs/${jobId}/gate-out`} size="md">Hand the car over</LinkButton> : null}
        </Card>
      ) : null}

      {isOwner && approvedQuote ? (
        <Card className="flex flex-col gap-2" data-profit-card>
          <SectionLabel>Profit of this car (owner only)</SectionLabel>
          <p className="text-xs text-muted">Price less materials, clocked labour, commission and the bank charge. Materials and commission are typed in the internal box of the quotation.</p>
          <p className="text-sm">Quotation total {aed(approvedQuote.total_aed)} · labour clocked {hm(labour.minutes)} = {aed(labour.cost)}. <Link href={`/jobs/${jobId}/quote/${approvedQuote.id}`} className="font-semibold underline underline-offset-4">Open the internal box</Link></p>
        </Card>
      ) : null}
    </>
  );
}
