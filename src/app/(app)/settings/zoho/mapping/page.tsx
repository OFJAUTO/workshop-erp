import { Button, Card, Field, LinkButton, Notice, PageHeader, SectionLabel, Select } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { listAccounts, zohoConfigured, zohoConnection, type ZohoAccount } from "@/lib/zoho";
import { DEPOSIT_METHODS, EXPENSE_TYPES, INCOME_TYPES, PURCHASE_TYPES, SUGGESTED_MAP, SUPPLIER_PAY_METHODS, readZohoMap, zohoWriteOrg } from "@/lib/zoho-sync";
import { saveZohoMapping, useSuggestedMapping } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Settings > Zoho Books > Mapping (owner and accounts): which Zoho income account each kind of work posts to, and
 * which cash or bank account each payment method deposits to. Stored as NAMES so the same mapping reads in OFJ
 * TEST today and in the REAL book at go-live. A document whose type has no account fails in plain words.
 */

/** The straightforward best match: the stored name, an account whose name contains the key words, else the suggestion. */
function bestMatch(stored: string | undefined, suggestion: string, names: string[], words: string[]): string {
  if (stored) return stored;
  const lower = names.map((n) => n.toLowerCase());
  const exact = lower.indexOf(suggestion.toLowerCase());
  if (exact >= 0) return names[exact];
  for (const w of words) {
    const hit = lower.findIndex((n) => n.includes(w));
    if (hit >= 0) return names[hit];
  }
  return suggestion;
}

const MATCH_WORDS: Record<string, string[]> = {
  labour: ["labour", "labor", "service income"],
  parts: ["parts", "spare"],
  bodyshop: ["bodyshop", "body shop", "ppf"],
  recovery: ["recovery", "towing"],
  inspection_fee: ["inspection"],
  other: ["other income", "general income", "sales"],
  cash: ["petty cash", "cash"],
  card: ["card machine", "card clearing", "pos"],
  link: ["payment link", "online clearing", "gateway"],
  transfer: ["bank - aed", "current account", "wio", "bank"],
  cheque: ["bank - aed", "current account", "bank"],
  bank_charges: ["bank fees", "bank charge"],
  advances: ["advance", "unearned"],
  purchase_parts: ["parts purchase", "cost of goods", "purchases"],
  purchase_courier: ["courier", "freight", "shipping"],
  expense_commission: ["commission"],
  expense_recovery: ["recovery", "towing", "transport"],
  paid_from: ["bank - aed", "current account", "bank"],
  advances_refund: ["bank - aed", "bank"],
};

export default async function ZohoMappingPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("zohoSync");
  const { message, error } = await searchParams;
  const settings = await getSettings();
  const map = readZohoMap(settings);
  const configured = zohoConfigured();
  const conn = configured ? await zohoConnection() : null;
  const org = await zohoWriteOrg();

  let chart: ZohoAccount[] = [];
  let chartError: string | null = null;
  if (conn && org) {
    try {
      chart = (await listAccounts(org)).filter((a) => a.is_active !== false);
    } catch (e) {
      chartError = e instanceof Error ? e.message : String(e);
    }
  }
  const chartNames = chart.map((a) => a.account_name);
  const income = chart.filter((a) => a.account_type === "income").map((a) => a.account_name);
  const depositable = chart.filter((a) => ["bank", "cash", "other_current_asset"].includes(a.account_type)).map((a) => a.account_name);
  const expense = chart.filter((a) => a.account_type === "expense").map((a) => a.account_name);
  const liability = chart.filter((a) => a.account_type.includes("liability")).map((a) => a.account_name);

  /** The select shows the live chart, with the picked or suggested name added when the chart does not hold it yet. */
  const box = (name: string, picked: string, options: string[]) => {
    const list = options.includes(picked) || !picked ? options : [picked, ...options];
    return (
      <Select name={name} defaultValue={picked} data-map-box={name}>
        <option value="">— pick —</option>
        {list.map((o) => (
          <option key={o} value={o}>
            {o}
            {chartNames.length && !chartNames.includes(o) ? " (will be created in OFJ TEST)" : ""}
          </option>
        ))}
      </Select>
    );
  };

  return (
    <>
      <PageHeader
        title="Zoho account mapping"
        subtitle="What each kind of work posts to in Zoho, and where each payment method deposits. Names, not numbers: the same mapping works in OFJ TEST today and in the real book at go-live."
        actions={<LinkButton href="/zoho" tone="secondary">Back to the sync page</LinkButton>}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!configured ? <Notice tone="info">Zoho is not set up on this server, so the live chart cannot be shown — the names can still be typed and saved.</Notice> : null}
      {chartError ? <Notice tone="error">The chart of accounts could not be read: {chartError}</Notice> : null}

      <form action={saveZohoMapping} className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3" data-map-income>
          <SectionLabel>Income accounts — where each kind of work posts</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {INCOME_TYPES.map((t) => (
              <Field key={t.key} label={t.label}>
                {box(`map__income__${t.key}`, bestMatch(map.income[t.key], SUGGESTED_MAP.income[t.key], income, MATCH_WORDS[t.key] ?? []), income)}
              </Field>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col gap-3" data-map-deposit>
          <SectionLabel>Deposit-to accounts — where each payment method lands</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {DEPOSIT_METHODS.map((m) => (
              <Field key={m.key} label={m.label}>
                {box(`map__deposit__${m.key}`, bestMatch(map.depositTo[m.key], SUGGESTED_MAP.depositTo[m.key], depositable, MATCH_WORDS[m.key] ?? []), depositable)}
              </Field>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col gap-3" data-map-purchases>
          <SectionLabel>Purchases and expenses — bills, commissions and recovery</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {PURCHASE_TYPES.map((p) => (
              <Field key={p.key} label={p.label} hint={p.key === "parts" ? "Where supplier bills put the parts (at net cost)." : "Courier/freight charged on a supplier's invoice — its own line on that bill, never doubled as an expense."}>
                {box(`map__purchase__${p.key}`, bestMatch(map.purchases[p.key], SUGGESTED_MAP.purchases[p.key], expense, MATCH_WORDS[`purchase_${p.key}`] ?? []), expense)}
              </Field>
            ))}
            {EXPENSE_TYPES.map((e) => (
              <Field key={e.key} label={e.label} hint={e.key === "commission" ? "One expense per paid voucher (CPV), with the signed proof attached." : "One expense per driver/company per paid month, with the trip list attached."}>
                {box(`map__expense__${e.key}`, bestMatch(map.expense[e.key], SUGGESTED_MAP.expense[e.key], expense, MATCH_WORDS[`expense_${e.key}`] ?? []), expense)}
              </Field>
            ))}
            <Field label="Paid from" hint="The cash/bank account supplier payments and expenses are paid from.">
              {box("map__paid_from", bestMatch(map.paidFrom, SUGGESTED_MAP.paidFrom, depositable, MATCH_WORDS.paid_from), depositable)}
            </Field>
            {SUPPLIER_PAY_METHODS.map((m) => (
              <Field key={m.key} label={`Supplier payments by ${m.label.toLowerCase()}`} hint="Where the money left from when accounts pick this method on the LPO. Empty = the Paid-from account above.">
                {box(`map__paid_by__${m.key}`, map.paidFromBy?.[m.key] ?? "", depositable)}
              </Field>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col gap-3" data-map-other>
          <SectionLabel>Charges and advances — for the accountant&apos;s reference</SectionLabel>
          <p className="text-xs text-muted">The sync sends the bank-charge amount on each payment and leaves deposits unapplied until the invoice takes them; WHICH accounts Zoho books those to is decided by Zoho&apos;s own organization settings, not here. These two boxes record the agreed names so the accountant sets Zoho to match.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Bank charges (card 2.26%, link 1.75%)" hint="Agreed expense account — set it in Zoho's own settings too.">
              {box("map__bank_charges", bestMatch(map.bankCharges, SUGGESTED_MAP.bankCharges, expense, MATCH_WORDS.bank_charges), expense)}
            </Field>
            <Field label="Customer advances" hint="Agreed liability account for unapplied deposits — set it in Zoho's own settings too.">
              {box("map__advances", bestMatch(map.advances, SUGGESTED_MAP.advances, liability, MATCH_WORDS.advances), liability)}
            </Field>
            <Field label="Advance refunds paid from" hint="The cash/bank account a credit-note refund is paid from (used the moment accounts record one).">
              {box("map__advances_refund", bestMatch(map.advancesRefund, SUGGESTED_MAP.advancesRefund, depositable, MATCH_WORDS.advances_refund), depositable)}
            </Field>
          </div>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" data-map-save>Save mapping</Button>
        </div>
      </form>

      <Card className="flex flex-col gap-2" data-map-suggest>
        <SectionLabel>Suggested names</SectionLabel>
        <p className="text-sm text-muted">One tap fills every empty box with the suggested name. An account that does not exist yet is created in OFJ TEST at the first sync; in the REAL book the accountant creates the same names before go-live.</p>
        <form action={useSuggestedMapping}>
          <Button type="submit" tone="secondary" size="md" data-map-use-suggested>Fill the empty boxes with the suggested names</Button>
        </form>
      </Card>
    </>
  );
}
