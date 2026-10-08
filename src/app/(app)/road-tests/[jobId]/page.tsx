import { notFound } from "next/navigation";
import { Badge, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { loadInspection } from "@/lib/inspection-data";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { CONDITIONS, labelOf } from "@/lib/jobs";
import { ROAD_TEST_STATUS_LABELS, type RoadTestRow } from "@/lib/road-test";
import { can, type RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { saveRoadTest } from "../actions";
import { RoadTestForm } from "./RoadTestForm";

export const dynamic = "force-dynamic";

export default async function RoadTestPage({ params }: { params: Promise<{ jobId: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const { jobId } = await params;
  if (!(can(role, "roadTest") || can(role, "approveInspections") || role === "service_advisor")) notFound();
  const supabase = await createClient();
  const [card, bundle, { data: test }] = await Promise.all([
    loadJobCard(supabase, jobId),
    loadInspection(jobId),
    supabase.from("road_tests").select("id, job_id, inspector_id, status, items, not_possible_reason, started_at, done_at, created_at, updated_at").eq("job_id", jobId).maybeSingle(),
  ]);
  if (!card) notFound();
  const rt = (test as RoadTestRow | null) ?? null;
  const readOnly = !can(role, "roadTest") || !card.job.is_open;
  const files = (bundle?.media ?? []).filter((m) => m.item_key?.startsWith("road.")).map((m) => ({ id: m.id, kind: m.kind, url: bundle?.mediaUrls[m.storage_path] ?? null, caption: m.caption, itemKey: m.item_key }));

  return (
    <>
      <PageHeader
        title={`Road test · ${formatPlate(card.vehicle)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{vehicleTitle(card.vehicle)}</span>
            <span>· {card.job.job_number}</span>
            <Badge tone={rt?.status === "done" ? "green" : rt?.status === "not_possible" ? "neutral" : "amber"}>{ROAD_TEST_STATUS_LABELS[rt?.status ?? "not_started"]}</Badge>
          </span>
        }
        actions={<LinkButton href="/road-tests" tone="secondary" size="lg">Road tests</LinkButton>}
      />
      {card.gateIn?.condition && card.gateIn.condition !== "runs_drives" ? <Notice tone="error">Gate-in condition: {labelOf(CONDITIONS, card.gateIn.condition)}. If the car cannot be driven, mark the road test not possible.</Notice> : null}
      {card.gateIn?.dash_cam ? <Notice tone="error">Dash cam fitted: disconnect before driving.</Notice> : null}
      <Card className="flex flex-col gap-2">
        <SectionLabel right={`${card.requests.length}`}>Customer requests</SectionLabel>
        <ol className="list-decimal pl-5 text-[15px] font-medium flex flex-col gap-0.5">
          {card.requests.map((r) => (
            <li key={r.id}>{r.text}</li>
          ))}
        </ol>
      </Card>
      {rt?.done_at ? <p className="text-xs text-muted">Last saved {formatDateTime(rt.done_at)}.</p> : null}
      <RoadTestForm action={saveRoadTest.bind(null, jobId)} inspectionId={bundle?.inspection.id ?? null} initial={rt?.items ?? {}} initialFiles={files} initialNotPossible={rt?.status === "not_possible"} initialReason={rt?.not_possible_reason ?? ""} readOnly={readOnly} />
    </>
  );
}
