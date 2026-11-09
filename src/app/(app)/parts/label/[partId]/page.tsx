import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import { formatPlate } from "@/lib/types";
import { realPartNumber } from "@/lib/parts-rows";
import { qtyWithUnit, cleanUnit } from "@/lib/part-units";
import { refuseRecord } from "@/lib/refusal";

export const dynamic = "force-dynamic";

/**
 * The page behind a part sticker's QR (9 November 2026, Section 5): staff only, after sign-in (anyone else sees the
 * sign-in page and nothing more). Everything the sticker no longer carries: part name, part number, side, quantity,
 * job, plate, car, LPO, supplier, received date, advisor and technician, with the way to the job's parts trail.
 */
export default async function PartLabelPage({ params }: { params: Promise<{ partId: string }> }) {
  await requireStaff();
  const { partId } = await params;
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id, description, part_number, positions, quantity, confirmed_quantity, received_qty, supplier, po_id, po_line_id, unit").eq("id", partId).maybeSingle();
  if (!p) return refuseRecord("job", partId);
  const [{ data: job }, { data: po }, { data: line }, { data: techs }] = await Promise.all([
    p.job_id ? admin.from("jobs").select("id, job_number, advisor_id, assigned_to, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", p.job_id).maybeSingle() : Promise.resolve({ data: null }),
    p.po_id ? admin.from("purchase_orders").select("number, supplier_name").eq("id", p.po_id).maybeSingle() : Promise.resolve({ data: null }),
    p.po_line_id ? admin.from("purchase_order_lines").select("received_at").eq("id", p.po_line_id).maybeSingle() : Promise.resolve({ data: null }),
    p.job_id ? admin.from("job_technicians").select("staff_id, added_at").eq("job_id", p.job_id).eq("is_active", true).is("left_at", null).order("added_at") : Promise.resolve({ data: [] }),
  ]);
  const j = job as unknown as { id: string; job_number: string; advisor_id: string | null; assigned_to: string | null; vehicle: (Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null }) | null } | null;
  const techIds = ((techs ?? []) as { staff_id: string }[]).map((t) => t.staff_id);
  const people = Array.from(new Set([j?.advisor_id, j?.assigned_to, ...techIds].filter((x): x is string => !!x)));
  const { data: staff } = people.length ? await admin.from("staff").select("id, display_name").in("id", people) : { data: [] };
  const name = new Map(((staff ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  const technicians = (techIds.length ? techIds : j?.assigned_to ? [j.assigned_to] : []).map((id) => name.get(id)).filter(Boolean).join(", ");
  const qty = Number(p.confirmed_quantity ?? p.quantity) || 1;
  const unit = cleanUnit((p as { unit?: string | null }).unit ?? null);
  const rows: [string, string][] = [
    ["Part", String(p.description).toUpperCase()],
    ["Part number", realPartNumber(p.part_number as string | null) ?? "–"],
    ["Side", ((p.positions as string[] | null) ?? []).join(", ") || "–"],
    ["Quantity", unit === "l" ? qtyWithUnit(qty, unit) : `${qty} (one label per piece: 1 of ${qty}${qty > 1 ? ` … ${qty} of ${qty}` : ""})`],
    ["Job", j?.job_number ?? "Stock order"],
    ["Plate", j?.vehicle ? formatPlate(j.vehicle) : "–"],
    ["Car", [j?.vehicle?.make?.name, j?.vehicle?.model?.name].filter(Boolean).join(" ") || "–"],
    ["LPO", (po?.number as string | undefined) ?? "–"],
    ["Supplier", (p.supplier as string | null) || ((po?.supplier_name as string | undefined) ?? "–")],
    ["Received", line?.received_at ? formatDate(line.received_at as string) : Number(p.received_qty) > 0 ? "Yes" : "Not yet"],
    ["Advisor", j?.advisor_id ? (name.get(j.advisor_id) ?? "–") : "–"],
    ["Technician", technicians || "–"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={String(p.description).toUpperCase()} subtitle="The part behind this sticker" />
      <Card className="flex flex-col gap-2" data-part-label-page>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents" data-part-field={k}>
              <dt className="text-muted">{k}</dt>
              <dd className="font-semibold break-words">{v}</dd>
            </div>
          ))}
        </dl>
        {j ? <div className="flex flex-wrap gap-2 pt-2"><Link href={`/parts/trail/${j.id}?part=${p.id}#part-${p.id}`} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold">Parts trail</Link><Link href={`/jobs/${j.id}`} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold">Job card</Link></div> : null}
      </Card>
    </div>
  );
}
