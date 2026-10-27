import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import {
  ZOHO_CALLBACK_PATH,
  ZOHO_REAL_ORG_ID,
  listAccounts,
  listBankAccounts,
  listOrganizations,
  listPaymentModes,
  listTaxes,
  zohoConfigured,
  zohoConnection,
  zohoTestOrgId,
  type ZohoAccount,
  type ZohoOrg,
} from "@/lib/zoho";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { disconnectZohoAction, finishGoLiveFollowup, flipGoLive, flipGoLiveBack, mirrorZohoAction, resumeGoLive, setGoLiveStartDate, setZohoTestOrg } from "./actions";
import { wentLiveOf } from "@/lib/zoho-sync";
import { goLiveChecklist } from "@/lib/zoho-golive";
import { getSettings } from "@/lib/settings";
import { Field, Input } from "@/components/ui";

export const dynamic = "force-dynamic";

/** The standard Zoho modes, shown when the API does not expose the configured list. */
const STANDARD_MODES = ["Cash", "Check", "Credit Card", "Bank Transfer", "Bank Remittance", "Auto Transaction", "Others"];

type OrgRead = { org: string; title: string; taxes?: { name: string; pct: number }[]; accounts?: ZohoAccount[]; banks?: string[]; modes?: string[] | null; error?: string };

async function readOrg(org: string, title: string): Promise<OrgRead> {
  try {
    const [taxes, accounts, banks, modes] = await Promise.all([listTaxes(org), listAccounts(org), listBankAccounts(org).catch(() => []), listPaymentModes(org)]);
    return { org, title, taxes: taxes.map((t) => ({ name: t.tax_name, pct: Number(t.tax_percentage) })), accounts, banks: banks.map((b) => `${b.account_name} (${b.account_type})`), modes };
  } catch (e) {
    return { org, title, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Zoho Books, phase 0 (26 October 2026, docs/zoho-plan.md): the owner's connection, the organization picker
 * (REAL read-only, OFJ TEST writable) and the READ-ONLY listing of both organizations' taxes, chart of
 * accounts, bank accounts and payment modes — proof the connection works before anything is ever written.
 */
export default async function ZohoSettingsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("manageSettings");
  const { message, error } = await searchParams;
  const configured = zohoConfigured();
  const conn = configured ? await zohoConnection() : null;
  const testOrg = await zohoTestOrgId();

  let orgs: ZohoOrg[] = [];
  let orgsError: string | null = null;
  const reads: OrgRead[] = [];
  if (conn) {
    try {
      orgs = await listOrganizations();
    } catch (e) {
      orgsError = e instanceof Error ? e.message : String(e);
    }
    if (!orgsError) {
      const real = orgs.find((o) => String(o.organization_id) === ZOHO_REAL_ORG_ID);
      const test = testOrg ? orgs.find((o) => String(o.organization_id) === testOrg) : null;
      if (real) reads.push(await readOrg(ZOHO_REAL_ORG_ID, `${real.name} — REAL, read-only`));
      if (test) reads.push(await readOrg(String(test.organization_id), `${test.name} — TEST, writable`));
    }
  }

  const accountGroups = (accounts: ZohoAccount[]) => {
    const groups = new Map<string, string[]>();
    for (const a of accounts.filter((x) => x.is_active !== false)) groups.set(a.account_type, [...(groups.get(a.account_type) ?? []), a.account_name]);
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  };

  // After go-live the test organization is fixed for good (OFJ TEST's archive is keyed to it).
  const orgsWentLive = wentLiveOf(await getSettings());
  return (
    <>
      <PageHeader
        title="Zoho Books"
        subtitle="One-way: the ERP posts to Zoho, never the other way round. The REAL organization is read-only until go-live; every write goes to OFJ TEST."
        actions={
          <span className="flex flex-wrap gap-2">
            <LinkButton href="/zoho" tone="secondary">Sync page</LinkButton>
            <LinkButton href="/settings/zoho/mapping" tone="secondary">Account mapping</LinkButton>
            <LinkButton href="/settings" tone="secondary">Back to Settings</LinkButton>
          </span>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card className="flex flex-col gap-3" data-zoho-connection>
        <SectionLabel>Connection</SectionLabel>
        {!configured ? (
          <p className="text-sm">
            Not set up yet. Add <span className="font-mono font-bold">ZOHO_CLIENT_ID</span> and <span className="font-mono font-bold">ZOHO_CLIENT_SECRET</span> in Vercel (the client comes from api-console.zoho.com, a Server-based Application with the redirect address <span className="font-mono">{PRODUCTION_SITE_URL}{ZOHO_CALLBACK_PATH}</span>), redeploy, then press Connect here.
          </p>
        ) : conn ? (
          <>
            <p className="text-sm" data-zoho-status>
              <span className="font-bold text-green">Connected ✓</span> · by {conn.connected_by_name ?? "the owner"} on {formatDate(conn.connected_at)} · one-way, ERP → Zoho only
            </p>
            {conn.last_error ? <Notice tone="error">Zoho problem: {conn.last_error}</Notice> : null}
            <div className="flex flex-wrap gap-2">
              <form action={disconnectZohoAction}>
                <Button type="submit" tone="secondary" size="md" data-zoho-disconnect>Disconnect</Button>
              </form>
              <LinkButton href="/api/zoho/connect" tone="ghost" size="md">Connect again</LinkButton>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm">Ready to connect. Sign in as the accounts admin Zoho user; the permission is stored encrypted and only the server can read it.</p>
            <div>
              <LinkButton href="/api/zoho/connect" size="lg" data-zoho-connect>Connect Zoho Books</LinkButton>
            </div>
          </div>
        )}
      </Card>

      {conn ? (
        <Card className="flex flex-col gap-3" data-zoho-orgs>
          <SectionLabel right={orgs.length ? `${orgs.length}` : undefined}>Organizations</SectionLabel>
          {orgsError ? <Notice tone="error">{orgsError}</Notice> : null}
          <ul className="flex flex-col divide-y divide-line">
            {orgs.map((o) => {
              const id = String(o.organization_id);
              const isReal = id === ZOHO_REAL_ORG_ID;
              const isTest = testOrg === id;
              return (
                <li key={id} className="py-2.5 flex flex-wrap items-center gap-3" data-zoho-org={id}>
                  <span className="font-bold">{o.name}</span>
                  <span className="text-xs text-muted font-mono">{id}</span>
                  <span className="text-xs text-muted">{[o.country, o.currency_code].filter(Boolean).join(" · ")}</span>
                  <span className="flex-1" />
                  {isReal ? <Badge tone="ink">{orgsWentLive ? "REAL · the live book" : "REAL · read-only until go-live"}</Badge> : isTest ? <Badge tone="amber">{orgsWentLive ? "TEST · closed for good" : "TEST · writable"}</Badge> : orgsWentLive ? null : (
                    <form action={setZohoTestOrg}>
                      <input type="hidden" name="org_id" value={id} />
                      <input type="hidden" name="org_name" value={o.name} />
                      <Button type="submit" tone="secondary" size="md">Use as the test organization</Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
          {!testOrg ? <p className="text-sm text-muted">Pick OFJ TEST above: until go-live, every write goes there and nowhere else.</p> : null}
        </Card>
      ) : null}

      {reads.map((r) => (
        <Card key={r.org} className="flex flex-col gap-3" data-zoho-read={r.org}>
          <SectionLabel>{r.title}</SectionLabel>
          {r.error ? (
            <Notice tone="error">{r.error}</Notice>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold tracking-[0.08em] uppercase text-muted">Taxes ({r.taxes?.length ?? 0})</span>
                {(r.taxes ?? []).map((t) => (
                  <span key={t.name}>{t.name} · {t.pct}%</span>
                ))}
                <span className="mt-2 text-xs font-bold tracking-[0.08em] uppercase text-muted">Bank and cash accounts ({r.banks?.length ?? 0})</span>
                {(r.banks ?? []).map((b) => (
                  <span key={b}>{b}</span>
                ))}
                <span className="mt-2 text-xs font-bold tracking-[0.08em] uppercase text-muted">Payment modes</span>
                {r.modes ? r.modes.map((m) => <span key={m}>{m}</span>) : <span className="text-muted">Zoho does not expose the configured list over the API; the standard modes are {STANDARD_MODES.join(", ")}.</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold tracking-[0.08em] uppercase text-muted">Chart of accounts ({(r.accounts ?? []).filter((a) => a.is_active !== false).length})</span>
                {accountGroups(r.accounts ?? []).map(([type, names]) => (
                  <div key={type}>
                    <span className="font-semibold">{type.replace(/_/g, " ")} · {names.length}</span>
                    <p className="text-xs text-muted">{names.join(" · ")}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      ))}

      {await (async () => {
        // Phase 4: the go-live panel. Before go-live: the checklist (all green or the switch stays locked), the start
        // date and the typed confirmation. After it (once in the books' life): Stop / Resume posting to the REAL book.
        const checklist = await goLiveChecklist({ checkReal: !!conn });
        const settings = await getSettings();
        const wentLive = wentLiveOf(settings);
        const stopped = wentLive && !checklist.live;
        const followup = (settings.zoho_golive_followup ?? {}) as { pending?: boolean; since?: string };
        const log = Array.isArray(settings.zoho_golive_log) ? (settings.zoho_golive_log as { action?: string; name?: string; at?: string; reason?: string; start_date?: string }[]) : [];
        // A live Zoho test leaves its documents in OFJ TEST (those days stay red): none in the 7 days before the flip.
        const lastLiveTest = String(settings.zoho_last_live_test_at ?? "").trim();
        // eslint-disable-next-line react-hooks/purity
        const liveTestAgeDays = lastLiveTest ? (Date.now() - Date.parse(lastLiveTest)) / 86400000 : Infinity;
        const liveTestClearOn = lastLiveTest ? new Date(Date.parse(lastLiveTest) + 7 * 86400000 + 4 * 3600000).toISOString().slice(0, 10) : "";
        const logWords = (l: { action?: string; reason?: string; start_date?: string }) =>
          l.action === "live" ? `LIVE from ${l.start_date}` : l.action === "stop" ? `stopped (${l.reason})` : l.action === "resume" ? "resumed" : `back (${l.reason})`;
        return (
          <Card className={`flex flex-col gap-3 ${checklist.live ? "border-red-bar" : ""}`} data-golive-panel data-golive-state={checklist.live ? "live" : stopped ? "stopped" : "test"}>
            <SectionLabel right={checklist.live ? "LIVE" : stopped ? "STOPPED" : checklist.allGreen ? "Ready" : "Not yet"}>Go-live</SectionLabel>
            {followup.pending ? (
              <div className="flex flex-wrap items-center gap-2 rounded-control bg-red-soft p-3" data-golive-followup>
                <p className="text-sm font-semibold text-red flex-1 min-w-60">The documents from the start date have not been queued for the REAL book yet. Run it now — nothing is ever queued twice.</p>
                <form action={finishGoLiveFollowup}>
                  <Button type="submit" tone="danger" size="md" data-golive-followup-btn>Finish the go-live queue</Button>
                </form>
              </div>
            ) : null}
            {!wentLive && liveTestAgeDays < 7 ? (
              <div data-golive-live-test-warning>
                <Notice tone="error">A live Zoho test ran on {new Date(Date.parse(lastLiveTest) + 4 * 3600000).toISOString().slice(0, 10)}. Its documents stay in OFJ TEST and keep those days red: do not go live before {liveTestClearOn}.</Notice>
              </div>
            ) : null}
            {checklist.live ? (
              <Notice tone="error">The books are LIVE on the REAL organization (942979945) from {checklist.startDate || "the start date"}. OFJ TEST is closed for good.</Notice>
            ) : stopped ? (
              <Notice tone="error">Posting to the REAL book is STOPPED. Nothing posts to any Zoho book; new documents wait in the queue until Resume. OFJ TEST stays closed for good.</Notice>
            ) : (
              <p className="text-sm text-muted">The switch moves every write from OFJ TEST to the REAL book, once — only when every line below is green. At the flip, OFJ TEST&apos;s queue is archived and everything dated from the start date is posted to the REAL book; anything earlier stays in OFJ TEST (the accountant carries it over as opening balances), and anything earlier that never reached OFJ TEST shows red for entry by hand.</p>
            )}
            {!wentLive ? (
              <ul className="flex flex-col divide-y divide-line" data-golive-checklist>
                {checklist.items.map((i) => (
                  <li key={i.key} className="py-2 flex flex-col gap-0.5" data-golive-item={i.key} data-golive-ok={i.ok ? "1" : "0"}>
                    <div className="flex items-center gap-2">
                      <Badge tone={i.ok ? "green" : "red"}>{i.ok ? "✓" : "✗"}</Badge>
                      <span className="font-semibold text-sm">{i.label}</span>
                    </div>
                    <p className={`text-xs ${i.ok ? "text-muted" : "font-semibold text-red"}`}>{i.detail}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            {!wentLive ? (
              <div className="flex flex-col gap-3">
                <form action={setGoLiveStartDate} className="flex flex-wrap items-end gap-2">
                  <Field label="Go-live start date" hint="The first day the REAL book owns. The switch unlocks on that day, never before.">
                    <Input name="start_date" type="date" defaultValue={checklist.startDate} className="w-44" />
                  </Field>
                  <Button type="submit" tone="secondary" size="md" data-golive-date-save>Save the date</Button>
                </form>
                <form action={flipGoLive} className="flex flex-wrap items-end gap-2 rounded-control border border-red-bar p-3" data-golive-flip>
                  <Field label='Type REAL to confirm' hint="Once only: writes move to O F J AUTOMOTIVE WORKS LLC (942979945) and OFJ TEST closes for good.">
                    <Input name="confirm" placeholder="REAL" className="w-44" autoComplete="off" />
                  </Field>
                  <Button type="submit" tone="danger" size="md" disabled={!checklist.allGreen} data-golive-flip-btn>Go live on the REAL organization</Button>
                  {!checklist.allGreen ? <span className="text-xs font-semibold text-red">Locked until every line above is green.</span> : null}
                </form>
              </div>
            ) : checklist.live ? (
              <form action={flipGoLiveBack} className="flex flex-wrap items-end gap-2" data-golive-back>
                <Field label="Reason for stopping" hint="Pauses posting to the REAL book (nothing goes to OFJ TEST). Logged, and accounts are told.">
                  <Input name="reason" className="w-80" />
                </Field>
                <Button type="submit" tone="danger" size="md" data-golive-back-btn>Stop posting to the REAL book</Button>
              </form>
            ) : (
              <form action={resumeGoLive} className="flex flex-wrap items-end gap-2 rounded-control border border-red-bar p-3" data-golive-resume>
                <Field label="Type REAL to resume" hint="The waiting documents post to the REAL book in order.">
                  <Input name="confirm" placeholder="REAL" className="w-44" autoComplete="off" />
                </Field>
                <Button type="submit" tone="danger" size="md" data-golive-resume-btn>Resume posting to the REAL book</Button>
              </form>
            )}
            {log.length ? (
              <p className="text-xs text-muted" data-golive-log>
                History: {log.map((l) => `${String(l.at ?? "").slice(0, 16).replace("T", " ")} ${logWords(l)} by ${l.name}`).join(" · ")}
              </p>
            ) : null}
          </Card>
        );
      })()}

      {conn ? (
        <Card className="flex flex-col gap-3" data-zoho-mirror>
          <SectionLabel>Mirror REAL into OFJ TEST</SectionLabel>
          <p className="text-sm text-muted">Reads the REAL organization&apos;s taxes and chart of accounts and creates anything missing in OFJ TEST, so tests run against the same lists. Creates only — it never deletes and never touches REAL.</p>
          <form action={mirrorZohoAction}>
            <Button type="submit" size="lg" disabled={!testOrg} data-zoho-mirror-run>Mirror into OFJ TEST</Button>
          </form>
          {!testOrg ? <p className="text-xs text-muted">Pick the test organization first.</p> : null}
        </Card>
      ) : null}
    </>
  );
}
