import { notFound } from "next/navigation";
import { Badge, Button, Card, Field, Input, LinkButton, Notice, PageHeader, SectionLabel, Select, Textarea } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { hrGate, loadHrPerson, logHr } from "@/lib/hr";
import { HR_DOC_KINDS, expiryTone, expiryWords } from "@/lib/hr-rules";
import { markPersonLeft, savePerson, uploadHrDocument } from "../actions";
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
  const older = docs.filter((d) => d.replaced_at);
  return (
    <>
      <PageHeader
        title={p.passport_name}
        subtitle={[p.role_title, p.department, staff ? (staff.is_active ? "ERP login" : "ERP login off") : "No ERP login", left ? "LEFT" : null].filter(Boolean).join(" · ")}
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
          <Field label="Role" optional><Input name="role_title" defaultValue={p.role_title ?? ""} /></Field>
          <Field label="Department" optional><Input name="department" defaultValue={p.department ?? ""} /></Field>
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
        <SectionLabel right={`${current.length}`}>Documents</SectionLabel>
        {current.length === 0 ? <p className="text-sm text-muted">Nothing uploaded yet.</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {current.map((d) => {
              const tone = expiryTone(d.kind, d.expires_on, today);
              return (
                <li key={d.id} className="flex min-h-12 flex-wrap items-center gap-3 py-2" data-hr-doc={d.kind}>
                  <span className="w-36 shrink-0 font-bold">{HR_DOC_KINDS.find((k) => k.kind === d.kind)?.label ?? d.kind}</span>
                  <RevealNumber documentId={d.id} masked={d.doc_number ?? ""} />
                  <span className="min-w-0 flex-1 text-sm">{d.expires_on ? <>{d.expires_on} · </> : null}{tone === "none" ? <span className="text-muted">{expiryWords(d.expires_on, today)}</span> : <Badge tone={tone === "red" ? "red" : "amber"} data-hr-expiry={tone}>{expiryWords(d.expires_on, today)}</Badge>}</span>
                  <LinkButton href={`/api/hr/file/${d.id}`} tone="secondary" target="_blank" rel="noreferrer" data-hr-view={d.id}>View</LinkButton>
                  <LinkButton href={`/api/hr/file/${d.id}?download=1`} tone="secondary" data-hr-download={d.id}>Download</LinkButton>
                </li>
              );
            })}
          </ul>
        )}
        {older.length ? (
          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer font-bold">Replaced documents ({older.length})</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {older.map((d) => <li key={d.id}>{HR_DOC_KINDS.find((k) => k.kind === d.kind)?.label} · uploaded {formatDateTime(d.created_at)} · replaced {formatDateTime(d.replaced_at)} · <a className="underline underline-offset-4" href={`/api/hr/file/${d.id}`} target="_blank" rel="noreferrer">View</a></li>)}
            </ul>
          </details>
        ) : null}
        {!left ? (
          <form action={uploadHrDocument.bind(null, id)} encType="multipart/form-data" className="grid grid-cols-1 gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4" data-hr-upload>
            <Field label="Document">
              <Select name="kind" required defaultValue="">
                <option value="" disabled>Pick…</option>
                {HR_DOC_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </Select>
            </Field>
            <Field label="ID number" optional><Input name="doc_number" spell={false} autoComplete="off" /></Field>
            <Field label="Expiry date" hint="Needed for every document but the photo." optional><Input name="expires_on" type="date" /></Field>
            <Field label="File (photo or PDF, up to 4 MB)"><input name="file" type="file" accept="image/*,application/pdf" required className="min-h-11 text-sm" data-hr-file /></Field>
            <Button type="submit" className="self-start" data-hr-upload-save>Upload</Button>
          </form>
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
