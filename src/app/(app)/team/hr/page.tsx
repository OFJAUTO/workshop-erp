import Link from "next/link";
import { Button, Card, Field, Input, LinkButton, Notice, PageHeader, Select } from "@/components/ui";
import { hrGate, loadHrBoard } from "@/lib/hr";
import { NO_LOGIN_ROLES } from "@/lib/hr-rules";
import { DEPARTMENT_LEVELS, LEVEL_TEAMS } from "@/lib/teams";
import { addPersonWithoutLogin } from "./actions";
import { HrGateNotice } from "./HrGateNotice";
import { HrList } from "./HrList";

export const dynamic = "force-dynamic";

/**
 * HR (11 November 2026, Section 15; the list rebuilt 13 November 2026, Section 13), under Team, for the owner and the
 * head accountant only (server-checked): search, the four tiles as filters, groups by department and team, one status
 * line per person, "+ Add person" for staff with no ERP login, the expiry list download (logged).
 */
export default async function HrPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; show?: string }> }) {
  const gate = await hrGate();
  if (!gate.ok) return <HrGateNotice why={gate.why} />;
  const sp = await searchParams;
  const rows = await loadHrBoard();
  const showLeft = sp.show === "left";
  const list = rows.filter((r) => (showLeft ? r.status === "left" : r.status === "active"));
  // The same department and team list as the Team form, for people with no ERP login.
  const places = DEPARTMENT_LEVELS.flatMap((d) => (d.key === "office" ? [d.label] : [d.label, ...LEVEL_TEAMS[d.key].map((t) => `${d.label} · ${t.label}`)]));
  return (
    <>
      <PageHeader
        title="HR"
        subtitle="Everyone who works here, with or without an ERP login. Only you and the head accountant see this."
        actions={
          <>
            <LinkButton href="/api/hr/expiry-list" tone="secondary" data-hr-expiry-download>Download expiry list</LinkButton>
            <LinkButton href="#add-person" data-hr-add-open>+ Add person</LinkButton>
          </>
        }
      />
      {sp.message ? <Notice tone="success">{sp.message}</Notice> : null}
      {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
      <nav className="flex gap-1 self-start rounded-control border border-line-strong bg-white p-1">
        <Link href="/team/hr" aria-current={!showLeft ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-control px-4 text-sm font-bold ${!showLeft ? "bg-ink text-on-dark" : ""}`}>Working here ({rows.filter((r) => r.status === "active").length})</Link>
        <Link href="/team/hr?show=left" aria-current={showLeft ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-control px-4 text-sm font-bold ${showLeft ? "bg-ink text-on-dark" : ""}`}>Left ({rows.filter((r) => r.status === "left").length})</Link>
      </nav>
      <HrList rows={list} />
      <Card className="flex scroll-mt-20 flex-col gap-3" id="add-person" data-hr-add>
        <h2 className="text-base font-bold">+ Add person (no ERP login)</h2>
        <p className="text-xs text-muted">For office boys, cleaners, drivers and anyone else who does not sign in. People who sign in are added on the Team page.</p>
        <form action={addPersonWithoutLogin} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Name as on the passport"><Input name="passport_name" required data-hr-add-name /></Field>
          <Field label="Role">
            <Select name="role_title" required defaultValue="" data-hr-add-role>
              <option value="" disabled>Pick…</option>
              {NO_LOGIN_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Department and team" hint="Support roles (office boy, cleaner, driver) need none.">
            <Select name="department" defaultValue="" data-hr-add-department>
              <option value="">None</option>
              {places.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Button type="submit" className="self-start" data-hr-add-save>Add person</Button>
        </form>
      </Card>
    </>
  );
}
