import "server-only";
import { getSettings, type Settings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { ZOHO_REAL_ORG_ID, listAccounts, listTaxes, zohoConfigured, zohoConnection, zohoFetch } from "@/lib/zoho";
import { DEPOSIT_METHODS, EXPENSE_TYPES, INCOME_TYPES, PURCHASE_TYPES, readZohoMap } from "@/lib/zoho-sync";

/**
 * Zoho Books go-live (phase 4, 27 October 2026): the owner's switch from OFJ TEST to the REAL organization.
 * The checklist must be ALL green before the switch can flip; documents dated before the chosen start date
 * never post (beforeGoLiveStart in zoho-sync.ts); once live, OFJ TEST is closed to writes (the reversed
 * guard in zohoFetch).
 */

export type ChecklistItem = { key: string; label: string; ok: boolean; detail: string };
export type GoLiveChecklist = { items: ChecklistItem[]; allGreen: boolean; live: boolean; startDate: string };

const DAY = 24 * 3600 * 1000;
const dubaiToday = () => new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
const listDays = (days: string[]) => (days.length > 4 ? `${days.slice(0, 4).join(", ")} and ${days.length - 4} more` : days.join(", "));

/**
 * PURE gate 5: each of the SEVEN CALENDAR DAYS before today has a row, written after that day ended, and green.
 * (The seven newest rows are not enough: a cron outage leaves the freshest days unchecked while old green rows remain.)
 */
export function reconGate(rows: { day: string; status: string; checked_at: string }[], today: string): { ok: boolean; detail: string } {
  const need: string[] = [];
  for (let i = 7; i >= 1; i--) need.push(new Date(Date.parse(`${today}T00:00:00Z`) - i * DAY).toISOString().slice(0, 10));
  const byDay = new Map(rows.map((r) => [String(r.day).slice(0, 10), r]));
  const missing = need.filter((d) => !byDay.has(d));
  const red = need.filter((d) => byDay.has(d) && byDay.get(d)!.status !== "green");
  const early = need.filter((d) => byDay.has(d) && byDay.get(d)!.status === "green" && Date.parse(byDay.get(d)!.checked_at) < Date.parse(`${d}T00:00:00+04:00`) + DAY);
  if (missing.length) return { ok: false, detail: `Not checked yet: ${listDays(missing)} (press "Check every missing day" on the Reconciliation page).` };
  if (red.length) return { ok: false, detail: `Red: ${listDays(red)}.` };
  if (early.length) return { ok: false, detail: `Checked before the day was over: ${listDays(early)} (press Re-check on those days).` };
  return { ok: true, detail: `Seven green days: ${need[0]} to ${need[6]}.` };
}

/** PURE gate 6: a start date, and not in the future — between a flip and a future start date nothing could post anywhere. */
export function startDateGate(start: string, today: string): { ok: boolean; detail: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { ok: false, detail: "Pick the first day the REAL book owns (the 1st of a month)." };
  if (start.slice(8) !== "01") return { ok: false, detail: `${start} is not the 1st of a month: the opening balances are taken as of the 1st.` };
  if (start > today) return { ok: false, detail: `${start} is still ahead: flip on that day or after it (the flip replays everything from the start date into the REAL book).` };
  return { ok: true, detail: `Documents from ${start} post to REAL (those already in OFJ TEST are replayed at the flip); anything earlier never posts.` };
}

/** Every mapped account name, flat, with its group label (for the REAL-chart check). */
function mappedNames(settings: Settings): { name: string; label: string }[] {
  const map = readZohoMap(settings);
  const out: { name: string; label: string }[] = [];
  for (const t of INCOME_TYPES) out.push({ name: map.income[t.key] ?? "", label: t.label });
  for (const m of DEPOSIT_METHODS) out.push({ name: map.depositTo[m.key] ?? "", label: `Deposit-to for ${m.label}` });
  for (const p of PURCHASE_TYPES) out.push({ name: map.purchases[p.key] ?? "", label: p.label });
  for (const e of EXPENSE_TYPES) out.push({ name: map.expense[e.key] ?? "", label: e.label });
  out.push({ name: map.paidFrom ?? "", label: "Paid-from account" });
  // Per-method supplier-payment accounts are optional (empty = the paid-from account), but any that are named must exist.
  for (const name of Object.values(map.paidFromBy ?? {})) if (name?.trim()) out.push({ name, label: "Supplier payments by method" });
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

  // 3b. Zoho's own invoice numbering must not use INV- (the ERP posts its INV- numbers; a clash would be refused).
  const prefixLabel = "Zoho's own invoice prefix is not INV-";
  if (opts.checkReal && zohoConfigured() && (await zohoConnection())) {
    try {
      const j = await zohoFetch<{ invoice_settings?: { prefix_string?: string; prefix?: string } }>("/settings/invoices", { org: ZOHO_REAL_ORG_ID });
      const prefix = String(j.invoice_settings?.prefix_string ?? j.invoice_settings?.prefix ?? "").trim();
      items.push({
        key: "invoice_prefix",
        label: prefixLabel,
        ok: !!prefix && !/^inv-/i.test(prefix),
        detail: !prefix ? "Zoho did not say its invoice prefix: the accountant checks Settings > Invoices in Zoho." : /^inv-/i.test(prefix) ? `Zoho's own invoices start with "${prefix}": the accountant changes it (for example to "Z-").` : `Zoho's own invoices start with "${prefix}".`,
      });
    } catch (e) {
      items.push({ key: "invoice_prefix", label: prefixLabel, ok: false, detail: `Could not read it from Zoho: ${e instanceof Error ? e.message : String(e)}` });
    }
  } else {
    items.push({ key: "invoice_prefix", label: prefixLabel, ok: false, detail: "Checked live on the Settings > Zoho Books page." });
  }

  // 4. Nothing red in the queue.
  const { count: failed } = await admin.from("zoho_outbox").select("id", { count: "exact", head: true }).eq("status", "failed");
  items.push({ key: "no_failed", label: "No failed syncs", ok: (failed ?? 0) === 0, detail: failed ? `${failed} red row${failed === 1 ? "" : "s"} on the sync page.` : "The queue is clean." });

  // 5. The last seven calendar days reconciled green.
  const today = dubaiToday();
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10);
  const { data: recon } = await admin.from("zoho_reconciliation").select("day, status, checked_at").gte("day", from).lt("day", today);
  const gate5 = reconGate((recon ?? []) as { day: string; status: string; checked_at: string }[], today);
  items.push({ key: "recon", label: "Reconciliation green for the last 7 days", ok: gate5.ok, detail: gate5.detail });

  // 6. The start date is chosen, and not in the future.
  const startDate = String(settings.zoho_golive_start_date ?? "").trim();
  const gate6 = startDateGate(startDate, today);
  items.push({ key: "start_date", label: "Go-live start date chosen (today or earlier)", ok: gate6.ok, detail: gate6.detail });

  return { items, allGreen: items.every((i) => i.ok), live: settings.zoho_live_enabled === true, startDate };
}
