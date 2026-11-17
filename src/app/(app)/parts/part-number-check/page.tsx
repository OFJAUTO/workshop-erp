import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { refuse } from "@/lib/refusal";
import { flaggedPartNumbers } from "@/lib/pn-flags";
import { Card, PageHeader, SectionLabel } from "@/components/ui";

/**
 * PART NUMBER CHECK (17 November 2026, Section 7): the part numbers on cars still in the workshop that are not real ones
 * (the part's name, a word of it, or a word with digits added like BLADE78), by car and by who typed them. The owner and
 * the parts desk. Each line opens the car's parts page, where the real number is entered (or "No part number yet").
 */
export default async function PartNumberCheckPage() {
  const staff = await requireStaff();
  if (!["owner", "parts", "accounts"].includes(staff.role_id)) return refuse("no_permission");
  const list = await flaggedPartNumbers();
  const byCar = new Map<string, typeof list>();
  for (const f of list) byCar.set(f.jobId, [...(byCar.get(f.jobId) ?? []), f]);
  return (
    <div className="flex flex-col gap-4" data-pn-check>
      <PageHeader title="Part number check" subtitle="Part numbers that are not real ones, on cars still in the workshop: enter the real number, or tick &quot;No part number yet&quot;." />
      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${list.length}`}>Made-up part numbers</SectionLabel>
        {list.length === 0 ? <p className="text-sm text-muted" data-pn-check-none>None: every part number on the cars in the workshop looks real.</p> : null}
        {Array.from(byCar.entries()).map(([jobId, rows]) => (
          <div key={jobId} className="flex flex-col gap-1" data-pn-check-car={rows[0].jobNumber}>
            <Link href={`/parts/${jobId}`} className="text-sm font-extrabold underline underline-offset-4">{rows[0].jobNumber}{rows[0].car ? ` · ${rows[0].car}` : ""}</Link>
            <ul className="flex flex-col gap-0.5 text-sm">
              {rows.map((f) => (
                <li key={f.partId} data-pn-check-row={f.partNumber}>
                  <b>{f.part}</b> · &quot;{f.partNumber}&quot;{f.typedBy ? ` · typed by ${f.typedBy}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Card>
    </div>
  );
}
