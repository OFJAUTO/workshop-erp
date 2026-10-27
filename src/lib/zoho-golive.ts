import "server-only";
import { getSettings, type Settings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { ZOHO_REAL_ORG_ID, listAccounts, listTaxes, zohoConfigured, zohoConnection } from "@/lib/zoho";
import { DEPOSIT_METHODS, EXPENSE_TYPES, INCOME_TYPES, PURCHASE_TYPES, readZohoMap } from "@/lib/zoho-sync";

/**
 * Zoho Books go-live (phase 4, 27 October 2026): the owner's switch from OFJ TEST to the REAL organization.
 * The checklist must be ALL green before the switch can flip; documents dated before the chosen start date
 * never post (beforeGoLiveStart in zoho-sync.ts); once live, OFJ TEST is closed to writes (the reversed
 * guard in zohoFetch).
 */

export type ChecklistItem = { key: string; label: string; ok: boolean; detail: string };
export type GoLiveChecklist = { items: ChecklistItem[]; allGreen: boolean; live: boolean; startDate: string };

/** Every mapped account name, flat, with its group label (for the REAL-chart check). */
function mappedNames(settings: Settings): { name: string; label: string }[] {
  const map = readZohoMap(settings);
  const out: { name: string; label: string }[] = [];
  for (const t of INCOME_TYPES) out.push({ name: map.income[t.key] ?? "", label: t.label });
  for (const m of DEPOSIT_METHODS) out.push({ name: map.depositTo[m.key] ?? "", label: `Deposit-to for ${m.label}` });
  for (const p of PURCHASE_TYPES) out.push({ name: map.purchases[p.key] ?? "", label: p.label });
  for (const e of EXPENSE_TYPES) out.push({ name: map.expense[e.key] ?? "", label: e.label });
  out.push({ name: map.paidFrom ?? "", label: "Paid-from account" });
  out.push({ name: map.advancesRefund ?? "", label: "Advance refunds paid from" });
  return out;
}

/** The six gates, each in plain words. checkReal = read the REAL chart live (owner's settings page only). */
export async function goLiveChecklist(opts: { checkReal?: boolean } = {}): Promise<GoLiveChecklist> {
  const settings = await getSettings();
  const admin = createAdminClient();
  const items: ChecklistItem[] = [];

  // 1. Mathew's side-by-side review of OFJ TEST (his own login ticks it).
  const reviewed = (settings.zoho_golive_reviewed ?? {}) as { by?: string; name?: string; at?: string };
  items.push({
    key: "reviewed",
    label: "Accountant reviewed OFJ TEST side by side",
    ok: !!reviewed.at,
    detail: reviewed.at ? `Ticked by ${reviewed.name ?? "accounts"} on ${String(reviewed.at).slice(0, 10)}` : "Mathew ticks this from his own login once the review is done.",
  });

  // 2. The mapping has a name in every box.
  const names = mappedNames(settings);
  const missing = names.filter((n) => !n.name.trim());
  items.push({
    key: "mapping",
    label: "Account mapping saved, every box picked",
    ok: !missing.length,
    detail: missing.length ? `Missing: ${missing.map((m) => m.label).join(", ")}` : `${names.length} accounts mapped.`,
  });

  // 3. The same account names exist in the REAL organization (read live; read-only is always allowed).
  if (opts.checkReal) {
    if (!zohoConfigured() || !(await zohoConnection())) {
      items.push({ key: "real_chart", label: "The mapped names exist in the REAL organization", ok: false, detail: "Cannot check from here: Zoho is not connected on this server." });
    } else {
      try {
        const [chart, taxes] = await Promise.all([listAccounts(ZOHO_REAL_ORG_ID), listTaxes(ZOHO_REAL_ORG_ID)]);
        const have = new Set(chart.filter((a) => a.is_active !== false).map((a) => a.account_name.trim().toLowerCase()));
        const absent = names.filter((n) => n.name.trim() && !have.has(n.name.trim().toLowerCase()));
        const tax = taxes.some((t) => Number(t.tax_percentage) === 5);
        items.push({
          key: "real_chart",
          label: "The mapped names exist in the REAL organization",
          ok: !absent.length && tax,
          detail: !tax ? "No 5% tax in the REAL organization." : absent.length ? `The accountant still creates: ${absent.map((a) => a.name).join(", ")}` : "Every mapped account and the 5% tax exist in REAL.",
        });
      } catch (e) {
        items.push({ key: "real_chart", label: "The mapped names exist in the REAL organization", ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
    }
  } else {
    items.push({ key: "real_chart", label: "The mapped names exist in the REAL organization", ok: false, detail: "Checked live on the Settings > Zoho Books page." });
  }

  // 4. Nothing red in the queue.
  const { count: failed } = await admin.from("zoho_outbox").select("id", { count: "exact", head: true }).eq("status", "failed");
  items.push({ key: "no_failed", label: "No failed syncs", ok: (failed ?? 0) === 0, detail: failed ? `${failed} red row${failed === 1 ? "" : "s"} on the sync page.` : "The queue is clean." });

  // 5. The last seven reconciliation days are green.
  const { data: recon } = await admin.from("zoho_reconciliation").select("day, status").order("day", { ascending: false }).limit(7);
  const rows = (recon ?? []) as { day: string; status: string }[];
  const reds = rows.filter((r) => r.status !== "green");
  items.push({
    key: "recon",
    label: "Reconciliation green for the last 7 days",
    ok: rows.length >= 7 && !reds.length,
    detail: rows.length < 7 ? `Only ${rows.length} day${rows.length === 1 ? "" : "s"} checked so far (backfill on the Reconciliation page).` : reds.length ? `Red: ${reds.map((r) => String(r.day).slice(0, 10)).join(", ")}` : "Seven green days.",
  });

  // 6. The start date is chosen.
  const startDate = String(settings.zoho_golive_start_date ?? "").trim();
  items.push({
    key: "start_date",
    label: "Go-live start date chosen",
    ok: /^\d{4}-\d{2}-\d{2}$/.test(startDate),
    detail: /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? `Documents from ${startDate} post to REAL; anything earlier never posts.` : "Pick the first day the REAL book owns.",
  });

  return { items, allGreen: items.every((i) => i.ok), live: settings.zoho_live_enabled === true, startDate };
}
