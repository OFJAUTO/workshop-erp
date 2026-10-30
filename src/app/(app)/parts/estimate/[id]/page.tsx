import { notFound } from "next/navigation";
import { Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { VinCopy } from "@/components/VinCopy";
import { requirePermission } from "@/lib/auth";
import { estimatePartState, isEstimatePart } from "@/lib/estimate-parts";
import { ESTIMATE_CAR_SELECT, carWords } from "@/lib/estimate-parts-data";
import { formatDateTime } from "@/lib/format";
import { QUOTE_STATUS_LABELS } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate, type PlateFields } from "@/lib/types";
import { EstimatePartRow, type DeskPartLine } from "./EstimatePartRow";

export const dynamic = "force-dynamic";

/**
 * The parts desk prices an ESTIMATE (30 October 2026): the car is not here yet, so the page shows what the parts desk
 * needs instead - the make, model and year, the VIN when known, and each part the advisor named with his note.
 * The desk puts the cost, supplier, part number, type and availability; the advisor's markup does the rest.
 */
export default async function EstimatePartsDesk({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("priceParts");
  const { id } = await params;
  const admin = createAdminClient();
  const { data: q } = await admin
    .from("quotations")
    .select(`id, number, version, kind, status, sent_at, created_by, carried_job_id, is_active, vehicle:vehicles(${ESTIMATE_CAR_SELECT}), creator:staff!quotations_created_by_fkey(display_name)`)
    .eq("id", id)
    .maybeSingle();
  if (!q || q.kind !== "estimate" || !q.is_active) notFound();
  const vehicle = q.vehicle as unknown as (PlateFields & { vin: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null }) | null;
  const advisor = (q.creator as unknown as { display_name: string } | null)?.display_name ?? null;
  const [{ data: lineRows }, settings, { data: supplierRows }] = await Promise.all([
    admin.from("quotation_lines").select("id, line_type, title, quantity, positions, parts_note, unit_cost, part_item_id, is_active, left_off, option_group, chosen, price_requested_at, priced_at, priced_by_advisor, price_checked_at, supplier_text, part_number, part_type, availability, delivery_days, position").eq("quotation_id", q.id).eq("line_type", "part").eq("is_active", true).order("position"),
    getSettings(),
    admin.from("suppliers").select("name").eq("is_active", true).order("name"),
  ]);
  const lines: DeskPartLine[] = (lineRows ?? [])
    .filter((l) => isEstimatePart({ line_type: l.line_type as string, part_item_id: l.part_item_id as string | null }) && !l.left_off)
    .map((l) => ({
      id: l.id as string,
      title: (l.title as string) ?? "",
      quantity: Number(l.quantity) || 1,
      positions: (l.positions as string[] | null) ?? [],
      note: (l.parts_note as string | null) ?? null,
      state: estimatePartState({ id: l.id as string, line_type: "part", title: l.title as string, unit_cost: l.unit_cost === null ? null : Number(l.unit_cost), price_requested_at: l.price_requested_at as string | null, priced_by_advisor: !!l.priced_by_advisor, price_checked_at: l.price_checked_at as string | null }),
      cost: l.unit_cost === null ? null : Number(l.unit_cost),
      supplier: (l.supplier_text as string | null) ?? null,
      partNumber: (l.part_number as string | null) ?? null,
      partType: (l.part_type as string | null) ?? null,
      availability: (l.availability as "in_stock" | "to_order" | null) ?? null,
      days: l.delivery_days === null || l.delivery_days === undefined ? null : Number(l.delivery_days),
      advisorName: advisor,
    }));
  // Only what the advisor sent (or priced himself) is the desk's; a part he is still naming stays with him.
  const deskLines = lines.filter((l) => l.state !== "draft");
  const preparing = q.status === "draft" || q.status === "pending_owner";
  const toPrice = deskLines.filter((l) => l.state === "with_desk").length;
  const toCheck = deskLines.filter((l) => l.state === "advisor").length;

  return (
    <>
      <PageHeader
        title={`ESTIMATE ${q.number} – car not here yet`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-desk-car>
            <span className="font-bold">{vehicle ? formatPlate(vehicle) : "No car"}</span>
            <span>{carWords(vehicle)}</span>
            {vehicle?.vin ? <VinCopy vin={vehicle.vin} /> : <span className="text-muted">VIN not known yet</span>}
            {advisor ? <span className="text-muted">· Advisor {advisor}</span> : null}
          </span>
        }
        actions={<LinkButton href="/parts" tone="secondary" size="lg">Parts</LinkButton>}
      />
      {q.carried_job_id ? <Notice tone="info">The car has arrived: these parts are on the job now and are priced there.</Notice> : null}
      {!preparing ? <Notice tone="info">{q.number} is {QUOTE_STATUS_LABELS[q.status as keyof typeof QUOTE_STATUS_LABELS]?.toLowerCase() ?? q.status}{q.sent_at ? ` (sent ${formatDateTime(q.sent_at)})` : ""}: prices are not changed here any more. Check the advisor&apos;s prices, or tell him a price is different.</Notice> : null}
      <Card className="flex flex-col gap-3" data-desk-estimate={q.number}>
        <SectionLabel right={[toPrice ? `${toPrice} to price` : null, toCheck ? `${toCheck} to check` : null].filter(Boolean).join(" · ") || "all priced"}>Parts on this estimate</SectionLabel>
        {deskLines.length === 0 ? <p className="text-sm text-muted">Nothing sent to the parts desk on this estimate.</p> : (
          <ol className="flex flex-col gap-3">
            {deskLines.map((l, i) => <EstimatePartRow key={l.id} quotationId={q.id} line={l} index={i + 1} partTypes={(settings.part_types ?? []) as string[]} suppliers={(supplierRows ?? []).map((s) => s.name as string)} preparing={preparing && !q.carried_job_id} />)}
          </ol>
        )}
      </Card>
    </>
  );
}
