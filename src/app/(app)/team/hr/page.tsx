import Link from "next/link";
import { Badge, Button, Card, Field, Input, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { hrExpiring, hrGate, loadHrList } from "@/lib/hr";
import { HR_DOC_KINDS } from "@/lib/hr-rules";
import { addPersonWithoutLogin, openStaffFile } from "./actions";
import { HrGateNotice } from "./HrGateNotice";

export const dynamic = "force-dynamic";

/**
 * HR (11 November 2026, Section 15), under Team, for the owner and the head accountant only: everyone on the Team
 * page plus people with no ERP login, the documents expiring first. Server-checked; nothing here is in any other page.
 */
export default async function HrPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; show?: string }> }) {
  const gate = await hrGate();
  if (!gate.ok) return <HrGateNotice why={gate.why} />;
  const sp = await searchParams;
  const [rows, expiring] = await Promise.all([loadHrList(), hrExpiring()]);
  const showLeft = sp.show === "left";
  const list = rows.filter((r) => (showLeft ? r.status === "left" : r.status === "active"));
  const label = (k: string) => HR_DOC_KINDS.find((d) => d.kind === k)?.label ?? k;
  return (
    <>
      <PageHeader title="HR" subtitle="Everyone who works here, with or without an ERP login: details and documents. Only you and the head accountant see this." views={<LinkButton href="/team" tone="secondary">Team</LinkButton>} />
      {sp.message ? <Notice tone="success">{sp.message}</Notice> : null}
      {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
      {expiring.length ? (
        <Card className="flex flex-col gap-2 border-amber-bar" data-hr-expiring>
          <SectionLabel right={`${expiring.length}`}>Documents expiring</SectionLabel>
          <ul className="flex flex-col divide-y divide-line">
            {expiring.map((d) => (
              <li key={d.id} className="flex min-h-11 flex-wrap items-center gap-2 py-1.5">
                <Badge tone={d.stage === 0 ? "red" : "amber"}>{d.stage === 0 ? "Expired" : `${d.stage} days`}</Badge>
                <Link href={`/team/hr/${d.personId}`} className="font-semibold underline underline-offset-4">{d.name}</Link>
                <span className="text-sm text-muted">{label(d.kind)} · {d.expiresOn}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <nav className="flex gap-1 self-start rounded-control border border-line-strong bg-white p-1">
        <Link href="/team/hr" aria-current={!showLeft ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-control px-4 text-sm font-bold ${!showLeft ? "bg-ink text-on-dark" : ""}`}>Working here ({rows.filter((r) => r.status === "active").length})</Link>
        <Link href="/team/hr?show=left" aria-current={showLeft ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-control px-4 text-sm font-bold ${showLeft ? "bg-ink text-on-dark" : ""}`}>Left ({rows.filter((r) => r.status === "left").length})</Link>
      </nav>
      <Card className="flex flex-col gap-2" data-hr-list>
        <ul className="flex flex-col divide-y divide-line">
          {list.map((r) => (
            <li key={r.key} className="flex min-h-12 flex-wrap items-center gap-3 py-2" data-hr-row={r.personId ?? r.staffId}>
              <span className="min-w-0 flex-1">
                <span className="block font-bold uppercase">{r.name}</span>
                <span className="block text-xs text-muted">{[r.role, r.department, r.login ? (r.staffActive ? "ERP login" : "ERP login off") : "No ERP login"].filter(Boolean).join(" · ")}</span>
              </span>
              {r.expired ? <Badge tone="red">{r.expired} expired</Badge> : null}
              {r.expiring ? <Badge tone="amber">{r.expiring} expiring</Badge> : null}
              {r.personId ? (
                <LinkButton href={`/team/hr/${r.personId}`} tone="secondary" data-hr-open={r.personId}>Open</LinkButton>
              ) : (
                <form action={openStaffFile.bind(null, r.staffId as string)}>
                  <Button type="submit" tone="secondary" data-hr-open-staff={r.staffId}>Open</Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="flex flex-col gap-3" data-hr-add>
        <SectionLabel>Add a person with no ERP login</SectionLabel>
        <form action={addPersonWithoutLogin} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Name as on the passport"><Input name="passport_name" required data-hr-add-name /></Field>
          <Field label="Role" optional><Input name="role_title" /></Field>
          <Field label="Department" optional><Input name="department" /></Field>
          <Button type="submit" className="self-start" data-hr-add-save>Add</Button>
        </form>
      </Card>
    </>
  );
}
