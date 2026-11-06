import "server-only";
import { greetingNameOf } from "./messages";
import { schemaReady } from "./schema-ready";
import { getSettings } from "./settings";
import { shortFor } from "./short-links";
import { PRODUCTION_SITE_URL } from "./site";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

/**
 * THE customer message for a quotation or an estimate (6 November 2026): the template from Settings (the revised one
 * for a version after the first), the greeting, the car, the advisor and the short link. Used by the one send/resend
 * button wherever it is (the job card, the page headers, the lists' menus).
 */
export async function quoteMessageFor(quotationId: string, advisorName: string): Promise<{ message: string; phoneDigits: string; token: string | null } | null> {
  const admin = createAdminClient();
  // "How to address" (Section 7) is asked for only once its column exists (WAITING FOR APPLY until then).
  const addressCol = (await schemaReady("customers", "address_as")) ? ", address_as" : "";
  const quoteSelect = `kind, version, token, sent_to_phone, customer:customers(full_name, company_name, phone${addressCol}), vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))`;
  const { data: rowData } = await admin
    .from("quotations")
    .select(quoteSelect)
    .eq("id", quotationId)
    .maybeSingle();
  const row = rowData as unknown as { kind: string; version: number; token: string | null; sent_to_phone: string | null; customer: unknown; vehicle: unknown } | null;
  if (!row) return null;
  const settings = await getSettings();
  type C = Parameters<typeof greetingNameOf>[0] & { phone: string | null };
  type V = Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null };
  const customer = (row.customer ?? null) as unknown as C | null;
  const vehicle = (row.vehicle ?? null) as unknown as V | null;
  const base = row.kind === "estimate" ? settings.whatsapp_estimate_template : row.version > 1 ? settings.whatsapp_quote_revised_template : settings.whatsapp_quote_template;
  const link = row.token ? await shortFor(`${PRODUCTION_SITE_URL}/quote/${row.token}`) : null;
  const message = String(base ?? "")
    .replaceAll("[name]", greetingNameOf(customer))
    .replaceAll("[make model]", [vehicle?.make?.name, vehicle?.model?.name].filter(Boolean).join(" "))
    .replaceAll("[plate]", vehicle ? formatPlate(vehicle) : "")
    .replaceAll("[advisor]", advisorName)
    .replaceAll("[link]", link ?? "");
  return { message, phoneDigits: String(row.sent_to_phone ?? customer?.phone ?? "").replace(/[^\d]/g, ""), token: row.token ?? null };
}

/** "Resent by Adarsh, 6 Nov 14:05" for each quotation that was resent (its newest resend). */
export async function lastResendWords(quotationIds: string[]): Promise<Record<string, string>> {
  const ids = Array.from(new Set(quotationIds.filter(Boolean)));
  if (!ids.length) return {};
  const admin = createAdminClient();
  const { data } = await admin.from("quotation_events").select("quotation_id, created_at, created_by").in("quotation_id", ids).eq("event_type", "quote_resent").order("created_at", { ascending: false });
  const rows = (data ?? []) as { quotation_id: string; created_at: string; created_by: string | null }[];
  const people = Array.from(new Set(rows.map((r) => r.created_by).filter((x): x is string => !!x)));
  const { data: staff } = people.length ? await admin.from("staff").select("id, display_name").in("id", people) : { data: [] as { id: string; display_name: string }[] };
  const name = new Map((staff ?? []).map((s) => [s.id as string, s.display_name as string]));
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (out[r.quotation_id]) continue;
    const when = new Date(r.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
    out[r.quotation_id] = `Resent by ${name.get(r.created_by ?? "") ?? "someone"}, ${when}`;
  }
  return out;
}
