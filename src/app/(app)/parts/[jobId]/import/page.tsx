import { notFound } from "next/navigation";
import { LinkButton, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { loadPricingRows } from "@/lib/parts-pricing";
import type { SupplierOption } from "@/lib/parts-rows";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { ImportWizard, type ImportTarget } from "./ImportWizard";

export const dynamic = "force-dynamic";

/**
 * "Import prices": a supplier's prices onto this car's parts list. Four ways in (a file, text pasted from an email,
 * a screenshot, or a mapping set once for a supplier), one check screen with every line beside its match on the
 * list, then Apply. Nothing is written before Apply; manual entry on the Parts page is untouched.
 */
export default async function ImportPricesPage({ params }: { params: Promise<{ jobId: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!can(role, "priceParts")) notFound();
  const { jobId } = await params;
  const admin = createAdminClient();
  const settings = await getSettings();
  const types = ((settings.part_types ?? []) as string[]).map((t) => t.toLowerCase());
  const [{ data: job }, { data: supplierRows }, pricing] = await Promise.all([
    admin.from("jobs").select("id, job_number, is_open, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", jobId).maybeSingle(),
    admin.from("suppliers").select("id, name, default_discount_percent, discount_by_type, import_mapping").eq("is_active", true).order("name"),
    loadPricingRows(jobId, types[0] ?? ""),
  ]);
  if (!job) notFound();
  type V = { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };
  const v = job.vehicle as unknown as V;
  const car = [v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" ");
  const suppliers: (SupplierOption & { hasMapping: boolean })[] = (supplierRows ?? []).map((s) => ({ id: s.id as string, name: s.name as string, discount: Number(s.default_discount_percent) || 0, byType: (s.discount_by_type as Record<string, number> | null) ?? {}, hasMapping: !!s.import_mapping }));
  const originals = new Map(pricing.parts.map((p) => [p.id, p.original_description ?? null]));
  const targets: ImportTarget[] = pricing.rows
    .filter((r) => r.state !== "removed")
    .map((r) => ({ key: r.key, partId: r.partId, requestId: r.requestId, name: r.name, original: r.partId ? originals.get(r.partId) ?? null : null, partNumber: r.values.part_number || null, state: r.state, qty: r.values.qty }));

  return (
    <>
      <PageHeader
        title={`Import prices · ${v ? formatPlate(v) : job.job_number}`}
        subtitle={`${car} · ${job.job_number}${v?.vin ? ` · VIN ${v.vin}` : ""}`}
        actions={<LinkButton href={`/parts/${jobId}`} tone="secondary" size="lg">Back to the parts</LinkButton>}
      />
      <ImportWizard jobId={jobId} vin={v?.vin ?? null} suppliers={suppliers} targets={targets} ocrEnabled={!!process.env.ANTHROPIC_API_KEY} canApply={!!job.is_open && !staff.viewingAs} />
    </>
  );
}
