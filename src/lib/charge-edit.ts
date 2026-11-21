import "server-only";
import { createAdminClient } from "./supabase/admin";
import { schemaReady } from "./schema-ready";
import { notifyRoles } from "./notifications";
import { resolveProvider } from "./providers";
import { flagZohoAttention, reopenZoho } from "./zoho-sync";
import { chargeChanges, chargeEditState, changeWords, editRefusal, type ChargeEditState, type ChargeEditable } from "./charge-edit-rules";

/**
 * EDIT A CHARGE AFTER IT IS SAVED (21 November 2026, Section 1). The rules are pure in charge-edit-rules.ts. Every change
 * is written to the charge's own history (who, when, old value, new value) and to the job's history.
 */

export async function chargeEditReady(): Promise<boolean> {
  return schemaReady("charge_lines", "supplier_id, note, edit_history");
}

export type ChargeHistoryEntry = { at: string; by: string; changes: { label: string; old: string; new: string }[] };

type Row = { id: string; job_id: string | null; kind: string; description: string; provider: string | null; trips: number | null; cost_aed: number | string; charge_aed: number | string; free: boolean; free_status: string | null; agreed_at: string | null; quotation_line_id: string | null; invoice_id: string | null; supplier_trn: string | null; supplier_id?: string | null; note?: string | null; edit_history?: ChargeHistoryEntry[] | null };

const EDIT_ROLES = ["owner", "service_advisor", "accounts"];

/** Where each charge stands (for the Edit window): locks, the voucher, the history and the note. */
export async function chargeEditFacts(lineIds: string[], role: string): Promise<Map<string, { state: ChargeEditState; voucher: string | null; history: ChargeHistoryEntry[]; note: string | null; supplierId: string | null }>> {
  const out = new Map<string, { state: ChargeEditState; voucher: string | null; history: ChargeHistoryEntry[]; note: string | null; supplierId: string | null }>();
  if (!lineIds.length) return out;
  const admin = createAdminClient();
  const ready = await chargeEditReady();
  const { data: rows } = await admin.from("charge_lines").select(`id, agreed_at, quotation_line_id, invoice_id${ready ? ", supplier_id, note, edit_history" : ""}`).in("id", lineIds);
  const list = (rows ?? []) as unknown as Row[];
  const qlIds = list.map((r) => r.quotation_line_id).filter((x): x is string => !!x);
  const invIds = list.map((r) => r.invoice_id).filter((x): x is string => !!x);
  const [{ data: ql }, { data: invs }, { data: jvl }] = await Promise.all([
    qlIds.length ? admin.from("quotation_lines").select("id, quotation:quotations!quotation_lines_quotation_id_fkey(number, status)").in("id", qlIds) : Promise.resolve({ data: [] }),
    invIds.length ? admin.from("invoices").select("id, number").in("id", invIds) : Promise.resolve({ data: [] }),
    admin.from("journal_voucher_lines").select("charge_line_id, voucher:journal_vouchers!journal_voucher_lines_voucher_id_fkey(number, status)").in("charge_line_id", lineIds).eq("is_active", true),
  ]);
  const quoteOf = new Map(((ql ?? []) as unknown as { id: string; quotation: { number: string; status: string } | null }[]).map((q) => [q.id, q.quotation]));
  const invOf = new Map(((invs ?? []) as { id: string; number: string }[]).map((i) => [i.id, i.number]));
  const jvOf = new Map(((jvl ?? []) as unknown as { charge_line_id: string; voucher: { number: string; status: string } | null }[]).map((v) => [v.charge_line_id, v.voucher]));
  for (const r of list) {
    const voucher = jvOf.get(r.id) ?? null;
    const state = chargeEditState({ invoiceNumber: r.invoice_id ? invOf.get(r.invoice_id) ?? "the invoice" : null, agreed: !!r.agreed_at, quote: r.quotation_line_id ? quoteOf.get(r.quotation_line_id) ?? { number: "the quotation", status: "draft" } : null, voucher, role });
    out.set(r.id, { state, voucher: voucher && voucher.status !== "void" ? voucher.number : null, history: Array.isArray(r.edit_history) ? r.edit_history : [], note: r.note ?? null, supplierId: r.supplier_id ?? null });
  }
  return out;
}

export type ChargeEditInput = { description: string; kind: string; trips: number | null; charge: number; free: boolean; supplierId: string | null; newProvider: string | null; trn: string | null; cost: number; note: string | null };

/** Save an edited charge. Locked parts are refused in words; a cost on a voucher moves the voucher too. */
export async function editCharge(lineId: string, input: ChargeEditInput, by: { id: string; display_name: string; role_id: string }): Promise<{ words?: string; error?: string }> {
  if (!EDIT_ROLES.includes(by.role_id)) return { error: "Only the owner, the advisors or accounts edit a charge." };
  if (!(await chargeEditReady())) return { error: "Editing a charge switches on once the database change is applied (WAITING FOR APPLY)." };
  const admin = createAdminClient();
  const { data: raw } = await admin.from("charge_lines").select("id, job_id, kind, description, provider, trips, cost_aed, charge_aed, free, free_status, agreed_at, quotation_line_id, invoice_id, supplier_trn, supplier_id, note, edit_history, is_active").eq("id", lineId).maybeSingle();
  const row = raw as (Row & { is_active: boolean }) | null;
  if (!row || !row.is_active) return { error: "This charge is not there any more. Reload the page." };
  if (!(input.cost >= 0) || !(input.charge >= 0)) return { error: "Amounts must be 0 or more." };
  if (input.description.trim().length < 2) return { error: "Say what the charge is for." };
  if (!["recovery", "fuel", "delivery", "other"].includes(input.kind)) return { error: "Pick the type." };
  const facts = (await chargeEditFacts([lineId], by.role_id)).get(lineId)!;
  const prov = await resolveProvider({ supplierId: input.supplierId, newName: input.newProvider, trn: input.trn }, by);
  if (prov.error) return { error: prov.error };
  const before: ChargeEditable = { description: row.description, kind: row.kind, trips: row.trips ?? null, charge: Number(row.charge_aed) || 0, free: !!row.free, provider: row.provider ?? null, cost: Number(row.cost_aed) || 0, note: row.note ?? null };
  const after: ChargeEditable = { description: input.description.trim().replace(/\s+/g, " "), kind: input.kind, trips: input.kind === "recovery" ? input.trips ?? null : before.trips, charge: input.free ? 0 : Math.round(input.charge * 100) / 100, free: input.free, provider: prov.provider?.name ?? before.provider, cost: Math.round(input.cost * 100) / 100, note: input.note?.trim() || null };
  const changes = chargeChanges(before, after);
  const supplierChanged = !!prov.provider && prov.provider.id !== (row.supplier_id ?? null);
  if (!changes.length && !supplierChanged) return { error: "Nothing changed." };
  const refused = editRefusal(facts.state, changes);
  if (refused) return { error: refused };
  const entry: ChargeHistoryEntry = { at: new Date().toISOString(), by: by.display_name, changes: changes.map((c) => ({ label: c.label, old: c.old, new: c.new })) };
  const freeTurnedOn = after.free && !before.free;
  const update: Record<string, unknown> = {
    description: after.description,
    kind: after.kind,
    trips: after.trips,
    charge_aed: after.charge,
    free: after.free,
    free_status: !after.free ? null : freeTurnedOn ? (by.role_id === "owner" ? "approved" : "pending_owner") : row.free_status,
    provider: after.provider,
    cost_aed: after.cost,
    note: after.note,
    ...(prov.provider ? { supplier_id: prov.provider.id, supplier_trn: prov.provider.trn ?? row.supplier_trn } : {}),
    edit_history: [...(Array.isArray(row.edit_history) ? row.edit_history : []), entry],
    updated_by: by.id,
  };
  const { data: saved, error } = await admin.from("charge_lines").update(update).eq("id", lineId).eq("is_active", true).select("id");
  if (error || !saved?.length) return { error: "Couldn't save – nothing was changed. Try again." };
  const words = changeWords(changes.length ? changes : [{ label: "Provider", old: before.provider ?? "—", new: prov.provider?.name ?? "—" }]);
  if (row.job_id) await admin.from("job_events").insert({ job_id: row.job_id, event_type: "charge_edited", note: `Charge edited by ${by.display_name}: ${words}.`, created_by: by.id });
  if (freeTurnedOn && by.role_id !== "owner") await notifyRoles(["owner"], { type: "owner_approval_needed", title: `Free charge to approve · ${after.description}`, body: `${by.display_name} made a charge free: ${after.description} (cost AED ${after.cost.toFixed(2)}).`, jobId: row.job_id, href: row.job_id ? `/jobs/${row.job_id}#charges` : "/pending-charges" }).catch(() => null);
  // The voucher moves with the charge: its line and its total; the provider too when the voucher is this charge alone.
  let jvWords = "";
  const { data: jvLine } = await admin.from("journal_voucher_lines").select("id, voucher_id, amount_aed").eq("charge_line_id", lineId).eq("is_active", true).maybeSingle();
  if (jvLine) {
    const costChanged = changes.some((c) => c.field === "cost");
    const { data: v } = await admin.from("journal_vouchers").select("id, number, status, zoho_expense_id, edit_history").eq("id", jvLine.voucher_id).maybeSingle();
    if (v && v.status !== "void") {
      if (costChanged) await admin.from("journal_voucher_lines").update({ amount_aed: after.cost, updated_by: by.id }).eq("id", jvLine.id);
      const { data: lines } = await admin.from("journal_voucher_lines").select("amount_aed, charge_line_id").eq("voucher_id", v.id).eq("is_active", true);
      const sum = Math.round(((lines ?? []) as { amount_aed: number | string }[]).reduce((t, l) => t + (Number(l.amount_aed) || 0), 0) * 100) / 100;
      const single = (lines ?? []).length === 1;
      const vUpdate: Record<string, unknown> = { amount_aed: sum, edit_history: [...(Array.isArray(v.edit_history) ? v.edit_history : []), { at: entry.at, by: by.display_name, from: "charge edit", changes: entry.changes }], updated_by: by.id };
      if (single && prov.provider) Object.assign(vUpdate, { provider: prov.provider.name, provider_trn: prov.provider.trn, supplier_id: prov.provider.id });
      await admin.from("journal_vouchers").update(vUpdate).eq("id", v.id);
      if (costChanged || (single && supplierChanged)) {
        if (v.zoho_expense_id) {
          await flagZohoAttention("jv", v.id, `${v.number} changed after it reached Zoho (${words}): correct the expense in Zoho by hand, then press "Done by hand".`);
          jvWords = ` ${v.number} follows; it is already in Zoho, so accounts correct it there by hand.`;
        } else {
          await reopenZoho("jv", v.id);
          jvWords = ` ${v.number} follows.`;
        }
      }
    }
  }
  return { words: `Saved: ${words}.${jvWords}` };
}
