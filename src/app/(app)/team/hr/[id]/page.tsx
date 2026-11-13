import { notFound } from "next/navigation";
import { Badge, Button, Card, Field, Input, LinkButton, Notice, PageHeader, SectionLabel, Select, Textarea } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { HR_BUCKET, hrGate, hrOtherReady, loadHrPerson, logHr } from "@/lib/hr";
import { HR_DOC_KINDS, NO_LOGIN_ROLES, expiryTone, expiryWords, maskNumber } from "@/lib/hr-rules";
import { thumbsFor } from "@/lib/media-urls";
import { ROLE_LABELS, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEPARTMENT_LEVELS, LEVEL_TEAMS, placeWords, roleTitleOf } from "@/lib/teams";
import { HrAttach } from "../HrAttach";
import { markPersonLeft, savePerson, uploadHrDocument } from "../actions";
import Link from "next/link";
import { HrGateNotice } from "../HrGateNotice";
import { RevealNumber } from "../RevealNumber";

export const dynamic = "force-dynamic";

const ACTION_WORDS: Record<string, string> = { viewed_person: "Opened the file", viewed: "Opened a document", downloaded: "Downloaded a document", downloaded_all: "Downloaded all documents", number_shown: "Showed an ID number", uploaded: "Uploaded", edited: "Edited", left: "Marked as left", created: "Added" };

/** One person's HR file (11 November 2026, Section 15): details, documents with expiry, Left, and the access log. */
export default async function HrPersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const gate = await hrGate();
  if (!gate.ok) return <HrGateNotice why={gate.why} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  await logHr(gate.staff.id, "viewed_person", { personId: id });
  const data = await loadHrPerson(id);
  if (!data) notFound();
  const { person: p, docs, log, staff } = data;
  // eslint-disable-next-line react-hooks/purity -- a server page: today is read once per request
  const today = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
  const left = p.status === "left";
  const current = docs.filter((d) => !d.replaced_at);
  // 13 November 2026 (Section 13): role and department come from the Team record for anyone with an ERP login.
  const { data: team } = staff ? await createAdminClient().from("staff").select("role_id, department_id, team").eq("id", staff.id).maybeSingle() : { data: null };
  const teamRole = team ? roleTitleOf(team as { role_id: string; department_id: string | null; team: string | null }, ROLE_LABELS[team.role_id as RoleId] ?? String(team.role_id)) : null;
  const teamPlace = team ? placeWords(team as { role_id: string; department_id: string | null; team: string | null }) : null;
  const places = DEPARTMENT_LEVELS.flatMap((d) => (d.key === "office" ? [d.label] : [d.label, ...LEVEL_TEAMS[d.key].map((t) => `${d.label} · ${t.label}`)]));
  const thumbs = await thumbsFor(HR_BUCKET, current.filter((d) => (d.content_type ?? "").startsWith("image/")).map((d) => d.storage_path), 160, 600);
  const otherOn = await hrOtherReady();
  const attach = uploadHrDocument.bind(null, id);
  const older = docs.filter((d) => d.replaced_at);
  return (
    <>
      <PageHeader
        title={p.passport_name}
        subtitle={[teamRole ?? p.role_title, teamPlace ?? p.department, staff ? (staff.is_active ? "ERP login" : "ERP login off") : "No ERP login", left ? "LEFT" : null].filter(Boolean).join(" · ")}
        views={<LinkButton href="/team/hr" tone="secondary">HR</LinkButton>}
        actions={current.length ? <LinkButton href={`/api/hr/zip/${id}`} tone="secondary" data-hr-download-all>Download all documents</LinkButton> : null}
      />
      {sp.message ? <Notice tone="success">{sp.message}</Notice> : null}
      {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
      {left ? <div data-hr-left-notice><Notice tone="info">Left on {formatDateTime(p.left_at)}: {p.left_reason}. The file is archived; nothing was deleted.</Notice></div> : null}
      <Card className="flex flex-col gap-4" data-hr-details>
        <SectionLabel>Details</SectionLabel>
        <form action={savePerson.bind(null, id)} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name as on the passport"><Input name="passport_name" defaultValue={p.passport_name} required /></Field>
          {team ? (
            <div className="flex flex-col gap-1 text-sm sm:col-span-2" data-hr-team-record>
              <span className="text-xs font-semibold text-muted">Role and department (from the Team page)</span>
              <span className="font-semibold">{teamRole}{teamPlace ? ` · ${teamPlace}` : ""} · <Link href={`/team/${staff?.id}`} className="underline underline-offset-4">change on Team</Link></span>
            </div>
          ) : (
            <>
              <Field label="Role">
                <Select name="role_title" defaultValue={p.role_title ?? ""} data-hr-role>
                  <option value="">Not set</option>
                  {(NO_LOGIN_ROLES.includes(p.role_title ?? "") || !p.role_title ? NO_LOGIN_ROLES : [p.role_title, ...NO_LOGIN_ROLES]).map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
              <Field label="Department and team">
                <Select name="department" defaultValue={p.department ?? ""} data-hr-department>
                  <option value="">None</option>
                  {(places.includes(p.department ?? "") || !p.department ? places : [p.department, ...places]).map((d) => <option key={d} value={d}>{d}</option>)}
                </Select>
              </Field>
            </>
          )}
          <Field label="Joining date" optional><Input name="joining_date" type="date" defaultValue={p.joining_date ?? ""} /></Field>
          <Field label="Phone" optional><Input name="phone" type="tel" defaultValue={p.phone ?? ""} /></Field>
          <Field label="Emergency contact (name)" optional><Input name="emergency_name" defaultValue={p.emergency_name ?? ""} /></Field>
          <Field label="Emergency contact (phone)" optional><Input name="emergency_phone" type="tel" defaultValue={p.emergency_phone ?? ""} /></Field>
          <Field label="Contract end" optional><Input name="contract_end" type="date" defaultValue={p.contract_end ?? ""} /></Field>
          <Field label="Probation end" optional><Input name="probation_end" type="date" defaultValue={p.probation_end ?? ""} /></Field>
          <Button type="submit" className="self-start" disabled={left} data-hr-save>Save the details</Button>
        </form>
      </Card>
      <Card className="flex flex-col gap-3" data-hr-documents>
        <SectionLabel right={`${HR_DOC_KINDS.filter((k) => current.some((d) => d.kind === k.kind)).length} of ${HR_DOC_KINDS.length}`}>Documents</SectionLabel>
        <ul className="flex flex-col divide-y divide-line">
          {[...HR_DOC_KINDS.map((k) => ({ key: k.kind, kind: k.kind, label: k.label, numbered: k.numbered, warn: !!k.warnDays, files: current.filter((d) => d.kind === k.kind) })),
            ...Array.from(new Set(current.filter((d) => d.kind === "other").map((d) => (d as { other_label?: string | null }).other_label ?? "Other"))).map((label) => ({ key: `other:${label}`, kind: "other", label, numbered: true, warn: false, files: current.filter((d) => d.kind === "other" && ((d as { other_label?: string | null }).other_label ?? "Other") === label) }))].map((row) => {
            const first = row.files[0];
            const tone = first ? expiryTone(row.kind, first.expires_on, today) : "none";
            return (
              <li key={row.key} className="flex min-h-16 flex-wrap items-center gap-3 py-2" data-hr-doc={row.kind} data-hr-doc-state={first ? "have" : "missing"}>
                <span className="w-40 shrink-0 font-bold">{row.label}</span>
                {!first ? (
                  <>
                    <span className="min-w-0 flex-1"><Badge tone="outline" data-hr-missing>Missing</Badge></span>
                    {!left ? <HrAttach action={attach} kind={row.kind} label={row.label} numbered={row.numbered} needsExpiry={row.warn} trigger="Attach" /> : null}
                  </>
                ) : (
                  <>
                    <span className="flex gap-1.5">
                      {row.files.slice(0, 3).map((d) =>
                        thumbs.get(d.storage_path) ? (
                          // eslint-disable-next-line @next/next/no-img-element -- a signed thumbnail of a private file
                          <a key={d.id} href={`/api/hr/file/${d.id}`} target="_blank" rel="noreferrer"><img src={thumbs.get(d.storage_path)} alt={row.label} className="h-12 w-16 rounded border border-line object-cover" data-hr-thumb /></a>
                        ) : (
                          <a key={d.id} href={`/api/hr/file/${d.id}`} target="_blank" rel="noreferrer" className="flex h-12 w-16 items-center justify-center rounded border border-line bg-chip text-xs font-bold" data-hr-thumb>PDF</a>
                        ),
                      )}
                    </span>
                    {row.numbered ? <RevealNumber documentId={first.id} masked={maskNumber(first.doc_number ?? "")} /> : null}
                    <span className="min-w-0 flex-1 text-sm">
                      {first.expires_on ? <>{first.expires_on} · </> : null}
                      {tone === "none" ? <span className={first.expires_on ? "font-semibold text-green-text" : "text-muted"} data-hr-expiry="green">{expiryWords(first.expires_on, today)}</span> : <Badge tone={tone === "red" ? "red" : "amber"} data-hr-expiry={tone}>{expiryWords(first.expires_on, today)}</Badge>}
                      {row.files.length > 1 ? <span className="whitespace-nowrap text-muted"> · {row.files.length} files</span> : null}
                    </span>
                    {row.files.map((d, n) => <LinkButton key={d.id} href={`/api/hr/file/${d.id}`} tone="secondary" target="_blank" rel="noreferrer" data-hr-view={d.id}>{row.files.length > 1 ? `View ${n + 1}` : "View"}</LinkButton>)}
                    {!left && row.kind !== "other" ? <HrAttach action={attach} kind={row.kind} label={row.label} numbered={row.numbered} needsExpiry={row.warn} trigger="Replace" /> : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {!left && otherOn ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3" data-hr-other>
            <span className="w-40 shrink-0 font-bold">Other document</span>
            <span className="min-w-0 flex-1 text-xs text-muted">A trade licence, a medical certificate, anything else.</span>
            <HrAttach action={attach} kind="other" label="Other document" numbered needsExpiry={false} other trigger="Add other document" />
          </div>
        ) : null}
        {older.length ? (
          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer font-bold">Replaced documents ({older.length})</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {older.map((d) => <li key={d.id}>{HR_DOC_KINDS.find((k) => k.kind === d.kind)?.label ?? "Other document"} · uploaded {formatDateTime(d.created_at)} · replaced {formatDateTime(d.replaced_at)} · <a className="underline underline-offset-4" href={`/api/hr/file/${d.id}`} target="_blank" rel="noreferrer">View</a></li>)}
            </ul>
          </details>
        ) : null}
      </Card>
      {!left && staff?.id !== gate.staff.id ? (
        <Card className="flex flex-col gap-3" data-hr-left>
          <SectionLabel>Left the company</SectionLabel>
          <p className="text-xs text-muted">Their ERP sign-in is switched off at once and the file is archived. Nothing is deleted; the documents stay here.</p>
          <form action={markPersonLeft.bind(null, id)} className="flex flex-col gap-2">
            <Textarea name="reason" rows={2} required placeholder="Why they left and the last working day" data-hr-left-reason />
            <Button type="submit" tone="danger" className="self-start" data-hr-left-save>Mark as left</Button>
          </form>
        </Card>
      ) : null}
      <Card className="flex flex-col gap-2" data-hr-log>
        <SectionLabel>Who opened this file</SectionLabel>
        {log.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {log.map((l, i) => <li key={i} data-hr-log-row={l.action}><span className="font-semibold">{ACTION_WORDS[l.action] ?? l.action}</span>{l.detail ? ` · ${l.detail}` : ""} · {l.by ?? "?"} · {formatDateTime(l.at)}</li>)}
          </ul>
        )}
      </Card>
    </>
  );
}
