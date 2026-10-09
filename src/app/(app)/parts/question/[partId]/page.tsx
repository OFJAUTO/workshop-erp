import { notFound } from "next/navigation";
import { Button, Card, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { PARTS_BUCKET, PART_SELECT, signPaths, toPart } from "@/lib/quote-data";
import { partTypeText } from "@/lib/quotes";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { answerQuestion } from "../../actions";

export const dynamic = "force-dynamic";

/** The workshop manager's one-tap answer to a question from Parts: the part, the diagram, Yes or No. */
export default async function PartQuestionPage({ params, searchParams }: { params: Promise<{ partId: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("manageWork");
  const { partId } = await params;
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const { data: raw } = await admin.from("part_items").select(PART_SELECT).eq("id", partId).maybeSingle();
  if (!raw) notFound();
  const p = toPart(raw as Record<string, unknown>);
  const [{ data: job }, { data: req }, { data: asker }] = await Promise.all([
    admin.from("jobs").select("id, job_number, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", p.job_id).maybeSingle(),
    p.part_request_id ? admin.from("part_requests").select("label, requested_text").eq("id", p.part_request_id).maybeSingle() : Promise.resolve({ data: null }),
    p.question_by ? admin.from("staff").select("display_name").eq("id", p.question_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const v = job?.vehicle as unknown as { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null;
  const urls = await signPaths(PARTS_BUCKET, p.diagram_path ? [p.diagram_path] : []);
  const diagram = p.diagram_path ? urls[p.diagram_path] : null;
  const canAnswer = !staff.viewingAs && !p.answer_text;
  return (
    <>
      <PageHeader title={`Question from Parts · ${v ? formatPlate(v) : job?.job_number ?? ""}`} subtitle={`${[v?.make?.name, v?.model?.name].filter(Boolean).join(" ")} · ${job?.job_number ?? ""}`} actions={job ? <LinkButton href={`/jobs/${job.id}`} tone="secondary" size="lg">Job card</LinkButton> : undefined} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card className="flex flex-col gap-3 max-w-2xl">
        <SectionLabel>The part</SectionLabel>
        <p className="text-lg font-bold">{p.description}{p.part_number ? <span className="text-muted font-normal"> · {p.part_number}</span> : null}</p>
        <p className="text-sm text-muted">× {p.quantity}{p.part_type ? ` · ${partTypeText(p)}` : ""}{req ? ` · for "${req.label}"${req.requested_text ? ` (technician wrote: ${req.requested_text})` : ""}` : ""}</p>
        {diagram ? (
          p.diagram_path?.endsWith(".pdf") ? <a href={diagram} target="_blank" rel="noreferrer" className="text-sm font-bold underline underline-offset-4">Open the catalogue diagram (PDF)</a> : (
            // eslint-disable-next-line @next/next/no-img-element
            <a href={diagram} target="_blank" rel="noreferrer"><img src={diagram} alt="Catalogue diagram" className="max-h-96 rounded-control border border-line object-contain" /></a>
          )
        ) : <p className="text-xs text-muted">No diagram attached.</p>}
        <p className="text-base"><span className="font-semibold">{asker?.display_name ?? "Parts"} asks:</span> {p.question_text ?? "Is this the right part?"}{p.question_at ? <span className="text-xs text-muted"> · {formatDateTime(p.question_at)}</span> : null}</p>
        {p.answer_text ? <Notice tone="success">Answered {formatDateTime(p.answered_at)}: {p.answer_text}</Notice> : null}
        {canAnswer ? (
          <form action={answerQuestion.bind(null, partId)} className="flex flex-col gap-2">
            <Textarea name="note" rows={2} placeholder="Note (optional)" />
            <div className="flex gap-2">
              <Button type="submit" name="answer" value="yes" size="lg">Yes, that is right</Button>
              <Button type="submit" name="answer" value="no" tone="secondary" size="lg">No</Button>
            </div>
          </form>
        ) : null}
      </Card>
    </>
  );
}
