import { notFound } from "next/navigation";
import { Card, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { AnswerBox } from "./AnswerBox";

export const dynamic = "force-dynamic";

/**
 * A question about a car (6 November 2026, Peter's "ask the advisor"): the question, every answer, and the answer box
 * for the advisor asked (or the owner). The asker, the advisor and the owner may open it.
 */
export default async function AskPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  const qid = Number(id);
  if (!Number.isSafeInteger(qid)) notFound();
  const admin = createAdminClient();
  const { data: q } = await admin.from("job_events").select("id, job_id, event_type, from_staff, to_staff, note, created_at").eq("id", qid).maybeSingle();
  if (!q || q.event_type !== "advisor_question") notFound();
  const owner = staff.role_id === "owner";
  if (!owner && staff.id !== q.from_staff && staff.id !== q.to_staff) notFound();
  const [{ data: job }, { data: answers }] = await Promise.all([
    admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", q.job_id).maybeSingle(),
    admin.from("job_events").select("id, from_staff, note, created_at").eq("job_id", q.job_id).eq("event_type", "advisor_answer").eq("from_stage", `q:${qid}`).order("created_at"),
  ]);
  const people = Array.from(new Set([q.from_staff, q.to_staff, ...(answers ?? []).map((a) => a.from_staff)].filter((x): x is string => !!x)));
  const { data: staffRows } = people.length ? await admin.from("staff").select("id, display_name").in("id", people) : { data: [] };
  const nameOf = new Map((staffRows ?? []).map((s) => [s.id as string, s.display_name as string]));
  type V = Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null };
  const v = (job?.vehicle ?? null) as unknown as V | null;
  const car = [v ? formatPlate(v) : null, [v?.make?.name, v?.model?.name].filter(Boolean).join(" ").toUpperCase() || null, job?.job_number].filter(Boolean).join(" · ");
  const mayAnswer = !staff.viewingAs && (staff.id === q.to_staff || owner);
  const role = staff.role_id as RoleId;
  return (
    <>
      <PageHeader
        title={`Question about ${job?.job_number ?? "a car"}`}
        subtitle={car}
        actions={
          <>
            {can(role, "priceParts") ? <LinkButton href={`/parts/${q.job_id}`} tone="secondary" size="lg">Parts page</LinkButton> : null}
            {can(role, "viewJobs") ? <LinkButton href={`/jobs/${q.job_id}`} tone="secondary" size="lg">Job card</LinkButton> : null}
          </>
        }
      />
      <Card className="flex flex-col gap-3" data-ask-question={qid}>
        <SectionLabel>{`${nameOf.get(q.from_staff ?? "") ?? "Someone"} asked ${nameOf.get(q.to_staff ?? "") ?? "the advisor"}`}</SectionLabel>
        <p className="text-base font-semibold whitespace-pre-wrap" data-ask-text>{q.note}</p>
        <span className="text-xs text-muted">{formatDateTime(q.created_at)}</span>
        {(answers ?? []).map((a) => (
          <div key={a.id} className="rounded-control bg-green-soft px-4 py-3 flex flex-col gap-1" data-ask-answer>
            <span className="text-sm font-bold">{nameOf.get(a.from_staff ?? "") ?? "Answer"}: <span className="font-semibold whitespace-pre-wrap">{a.note}</span></span>
            <span className="text-xs text-muted">{formatDateTime(a.created_at)}</span>
          </div>
        ))}
        {mayAnswer ? <AnswerBox questionId={qid} again={(answers ?? []).length > 0} /> : !(answers ?? []).length ? <p className="text-sm text-muted" data-ask-waiting>Waiting for the answer.</p> : null}
      </Card>
    </>
  );
}
