import Link from "next/link";
import { Badge, Button, Card, Empty, Input, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { wentLiveOf, zohoOpenUrl, zohoWriteOrg, type OutboxRow } from "@/lib/zoho-sync";
import { ZOHO_REAL_ORG_ID } from "@/lib/zoho";
import { outboxDocs } from "@/lib/zoho-docs";
import { loadRecentRuns, loadRun, pendingNeedsMap, waitingCounts } from "@/lib/zoho-manual";
import { RUN_STALE_MS, SYNC_MODE_WORDS, kindWord, reasonHref, resultWords, retryRefusal, runWords, syncModeOf, waitingTurnWords, type NeedLine, type PendingRow } from "@/lib/zoho-sync-rules";
import { pageAll } from "@/lib/page-all";
import { backfillZoho, markZohoDoneByHand, retryZohoRow, tickGoLiveReview } from "./actions";
import { ZohoSyncButton } from "./ZohoSyncButton";
import { SyncThisButton, ZohoSelectBar } from "./ZohoSelect";
import { ZohoSyncModeCard } from "./ZohoSyncModeCard";

export const dynamic = "force-dynamic";
// 3 November 2026: Sync to Zoho runs as server actions of this page, part by part (each part about 45 seconds).
export const maxDuration = 120;

/**
 * The Zoho Books sync page (phase 1, owner and accounts): what is waiting, what posted with the matching figures,
 * and what failed with the reason in plain words. Reads the ERP's own database only — Zoho is never read here.
 */

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Waiting" },
  { key: "failed", label: "Failed" },
  { key: "synced", label: "Posted" },
] as const;

/** "All" and "Posted" show the newest rows only; "Waiting" and "Failed" always show every row (review of 3 November 2026). */
const LIST_LIMIT = 400;
const OUTBOX_LIST_SELECT = "id, kind, record_id, job_id, status, attempts, last_error, zoho_id, zoho_result, enqueued_at, synced_at";

export default async function ZohoSyncPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; show?: string; run?: string }> }) {
  const staff = await requirePermission("zohoSync");
  const { message, error, show: showRaw, run: runParam } = await searchParams;
  const show = FILTERS.some((f) => f.key === showRaw) ? (showRaw as (typeof FILTERS)[number]["key"]) : "all";
  const admin = createAdminClient();
  // The list is filtered in the database, not in the newest 400 rows (review of 3 November 2026): a bill red since
  // October stays on "Failed" however many rows came after it. Every red row is also on "All", so the links from the
  // results window and Waiting on you (/zoho?show=failed#z-<id>) always land on their row. The chips count in the database.
  const countOf = async (status?: "pending" | "failed" | "synced") => {
    let q = admin.from("zoho_outbox").select("id", { count: "exact", head: true });
    if (status) q = q.eq("status", status);
    return (await q).count ?? 0;
  };
  const everyRow = (status: "pending" | "failed") => pageAll<OutboxRow>((a, b) => admin.from("zoho_outbox").select(OUTBOX_LIST_SELECT).eq("status", status).order("enqueued_at", { ascending: false }).range(a, b));
  const newest = async (status?: "synced") => {
    let q = admin.from("zoho_outbox").select(OUTBOX_LIST_SELECT);
    if (status) q = q.eq("status", status);
    return ((await q.order("enqueued_at", { ascending: false }).limit(LIST_LIMIT)).data ?? []) as OutboxRow[];
  };
  const [settings, org, nAll, nPending, nFailed, nSynced, filtered] = await Promise.all([
    getSettings(),
    zohoWriteOrg(),
    countOf(),
    countOf("pending"),
    countOf("failed"),
    countOf("synced"),
    (async (): Promise<OutboxRow[]> => {
      if (show === "failed" || show === "pending") return everyRow(show);
      if (show === "synced") return newest("synced");
      const [recent, red] = await Promise.all([newest(), everyRow("failed")]);
      const seen = new Set(recent.map((r) => r.id));
      return [...recent, ...red.filter((r) => !seen.has(r.id))].sort((a, b) => b.enqueued_at.localeCompare(a.enqueued_at));
    })(),
  ]);
  const rows = filtered;

  // The document names, batched per kind (THE lookup shared with the Sync to Zoho window and the reminder).
  // Fix 3 (4 November 2026, Mathew): every waiting or failed row shows its AMOUNT - a supplier bill or payment
  // reads its real figure (a few reads per row); posted rows keep the cheap name (their green line carries
  // Zoho's own figures already).
  const liveRows = rows.filter((r) => r.status !== "synced");
  const docs = new Map([...(await outboxDocs(rows.filter((r) => r.status === "synced"))), ...(await outboxDocs(liveRows, { billFigures: true }))]);
  const [waiting, runs, runView] = await Promise.all([waitingCounts(), loadRecentRuns(5), runParam ? loadRun(runParam) : Promise.resolve(null)]);
  // Why a waiting row waits (Mathew, 3 November 2026): the document it hangs on, with the fix link when that one is red.
  const pendingShown: PendingRow[] = rows.filter((r) => r.status === "pending").map((r) => ({ id: r.id, kind: r.kind, record_id: r.record_id, enqueued_at: r.enqueued_at, last_error: r.last_error, claimed_at: null, name: docs.get(`${r.kind}:${r.record_id}`)?.name ?? null, amount: null }));
  const whyMap = await pendingNeedsMap(pendingShown).catch(() => new Map<string, NeedLine>());
  const dubaiDayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(iso));
  const tickDays = Array.from(new Set(pendingShown.map((r) => dubaiDayOf(r.enqueued_at)))).sort();
  const tickKinds = Array.from(pendingShown.reduce((m, r) => m.set(r.kind, (m.get(r.kind) ?? 0) + 1), new Map<string, number>()).entries()).map(([kind, count]) => ({ kind, count }));
  const maySync = !staff.viewingAs;
  const mode = syncModeOf(settings.zoho_sync_mode);
  const isOwner = staff.role_id === "owner" && !staff.viewingAs && !staff.actingAs;
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  const counts: Record<(typeof FILTERS)[number]["key"], number> = { all: nAll, pending: nPending, failed: nFailed, synced: nSynced };
  const total = counts[show];
  const capped = filtered.length < total;
  const live = settings.zoho_live_enabled === true;
  const stopped = !live && wentLiveOf(settings);
  const followupPending = (settings.zoho_golive_followup as { pending?: boolean } | undefined)?.pending === true;

  return (
    <>
      <PageHeader
        title="Zoho Books sync"
        subtitle={`One-way: the ERP posts its documents to Zoho. ${live ? "LIVE: writes go to the REAL organization." : stopped ? "STOPPED by the owner: nothing posts to any Zoho book until Resume; documents wait in the queue." : `Writes go to OFJ TEST only (${org ?? "no test organization picked"}); the REAL book (${ZOHO_REAL_ORG_ID}) stays read-only until the books go live.`}`}
        actions={
          <span className="flex flex-wrap gap-2">
            <LinkButton href="/zoho/reconciliation" tone="secondary">Reconciliation</LinkButton>
            <LinkButton href="/zoho/close" tone="secondary">Monthly close</LinkButton>
            <LinkButton href="/settings/zoho/mapping" tone="secondary">Account mapping</LinkButton>
          </span>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {followupPending ? (
        <div data-zoho-followup-warning>
          <Notice tone="error">The go-live queue is not finished: the documents from the start date are not all queued for the REAL book yet. The owner presses &quot;Finish the go-live queue&quot; on Settings &gt; Zoho Books.</Notice>
        </div>
      ) : null}

      <Card className="flex flex-wrap items-center gap-2" data-zoho-controls data-zoho-mode={mode}>
        {!staff.viewingAs ? <ZohoSyncButton waiting={waiting.total} /> : <span className="text-sm font-semibold text-muted">Viewing only: Sync to Zoho is pressed from your own login.</span>}
        {staff.role_id === "owner" && !staff.viewingAs ? (
          <form action={backfillZoho}>
            <Button type="submit" tone="secondary" size="md" className="!whitespace-normal text-center" data-zoho-backfill>Backfill: queue everything already in the ERP</Button>
          </form>
        ) : null}
        <span className="text-xs text-muted basis-full" data-zoho-mode-line>
          <span className="font-bold text-ink">{SYNC_MODE_WORDS[mode].title}:</span> {SYNC_MODE_WORDS[mode].line} {mode === "manual" ? `${waiting.total ? `${waiting.total} waiting now.` : "Nothing waiting now."} ${waiting.stuckWords ? `${waiting.stuckWords} ` : ""}` : ""}
          {isOwner ? "You change this below." : "Only the owner changes this."}
        </span>
      </Card>

      {runView ? (
        <Card className="flex flex-col gap-2" data-zoho-run-view={runView.run.id}>
          <SectionLabel right={runWords({ posted: runView.run.posted, removed: runView.run.removed, skipped: runView.run.skipped, failed: runView.run.failed, waiting: runView.run.waiting })}>Sync of {formatDateTime(runView.run.started_at)}</SectionLabel>
          <p className="text-sm text-muted">
            By {runView.run.started_name ?? "someone"} · to {runView.run.book_label ?? runView.run.org ?? "Zoho"} ·{" "}
            {runView.run.status === "running" && nowMs - Date.parse(runView.run.heartbeat_at) > RUN_STALE_MS ? "stopped part-way (the window closed)" : runView.run.status === "running" ? "still sending" : runView.run.status === "stopped" ? `stopped: ${runView.run.stop_reason ?? "part-way"}` : "finished"}
          </p>
          <ul className="divide-y divide-line">
            {(Array.isArray(runView.run.items) ? runView.run.items : []).map((i) => {
              const now = runView.now.get(i.id);
              const nowWord = now?.status === "synced" ? "posted" : now?.status === "failed" ? "failed" : now ? "waiting" : null;
              return (
                <li key={i.id} className="py-2 flex flex-col gap-1" data-zoho-run-item={i.outcome} data-zoho-run-now={nowWord ?? "gone"}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="outline">{kindWord(i.kind)}</Badge>
                    <span className="font-bold">{i.name ?? i.record_id.slice(0, 8)}</span>
                    <span className="flex-1" />
                    {nowWord === "posted" ? <Badge tone="green">Posted ✓</Badge> : nowWord === "failed" ? <Badge tone="red">Failed</Badge> : nowWord === "waiting" ? <Badge tone="amber">Waiting</Badge> : null}
                  </div>
                  {i.outcome === "removed" ? <Badge tone="outline">Removed from Zoho</Badge> : i.outcome === "skipped" ? <Badge tone="outline">Nothing sent</Badge> : null}
                  {i.words ? <p className={`text-sm ${i.outcome === "failed" && nowWord !== "posted" ? "font-semibold text-red" : i.outcome === "posted" || i.outcome === "removed" ? "font-semibold text-green" : "text-muted"}`}>{i.words}</p> : null}
                  {nowWord === "failed" && i.outcome !== "posted" && now?.last_error && now.last_error !== i.words ? <p className="text-sm font-semibold text-red">Now: {now.last_error}</p> : null}
                  {nowWord === "failed" && retryRefusal(now?.zoho_result) ? (
                    <p className="text-sm font-semibold" data-zoho-retry-refused>{retryRefusal(now?.zoho_result)}</p>
                  ) : nowWord === "failed" && !staff.viewingAs ? (
                    <form action={retryZohoRow.bind(null, i.id)}>
                      <input type="hidden" name="run" value={runView.run.id} />
                      <Button type="submit" tone="secondary" size="md" data-zoho-retry data-zoho-run-retry>Retry</Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <LinkButton href="/zoho" tone="secondary" size="md">Close this sync</LinkButton>
        </Card>
      ) : runParam ? (
        <Notice tone="error">That sync is not on record (the history starts once the database change is applied).</Notice>
      ) : null}

      {runs.length ? (
        <Card className="flex flex-col gap-1" data-zoho-runs>
          <SectionLabel>Last syncs</SectionLabel>
          <ul className="divide-y divide-line">
            {runs.map((r) => {
              const stale = r.status === "running" && nowMs - Date.parse(r.heartbeat_at) > RUN_STALE_MS;
              return (
                <li key={r.id} className="py-2" data-zoho-run={r.id} data-zoho-run-status={stale ? "stopped" : r.status}>
                  <Link href={`/zoho?run=${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-11 text-sm">
                    <span className="font-bold">{formatDateTime(r.started_at)}</span>
                    <span>{r.started_name ?? "Someone"}</span>
                    <span className="text-muted">{r.book_label ?? r.org ?? ""}</span>
                    <span className="flex-1" />
                    <span className="font-semibold">{runWords({ posted: r.posted, removed: r.removed, skipped: r.skipped, failed: r.failed, waiting: r.waiting })}</span>
                    <span className="text-muted">{stale ? "stopped part-way" : r.status === "running" ? "sending…" : r.status === "stopped" ? "stopped" : "done"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {isOwner ? <ZohoSyncModeCard mode={mode} waiting={waiting.total} back="/zoho" /> : null}

      {staff.role_id === "accounts" && !staff.viewingAs
        ? await (async () => {
            // Phase 4: Mathew's own tick that the OFJ TEST side-by-side review is done (one of the go-live gates).
            const reviewed = (settings.zoho_golive_reviewed ?? {}) as { name?: string; at?: string };
            return (
              <Card className="flex flex-wrap items-center gap-3" data-golive-review>
                <SectionLabel>Go-live review</SectionLabel>
                {reviewed.at ? (
                  <p className="text-sm font-semibold text-green" data-golive-reviewed>Reviewed side by side by {reviewed.name ?? "accounts"} on {formatDate(String(reviewed.at))}.</p>
                ) : (
                  <form action={tickGoLiveReview} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted">Once OFJ TEST matches the ERP side by side, tick it here — the owner&apos;s go-live checklist turns green.</span>
                    <Button type="submit" size="md" data-golive-tick>The review is done</Button>
                  </form>
                )}
              </Card>
            );
          })()
        : null}

      <div className="flex flex-wrap gap-1 text-xs font-bold" data-zoho-filters>
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/zoho?show=${f.key}`} className={`min-h-9 inline-flex items-center rounded-control px-3 ${show === f.key ? "bg-ink text-white" : "bg-chip"}`} data-filter={f.key}>
            {f.label} · {counts[f.key]}
          </Link>
        ))}
      </div>

      <Card className="flex flex-col gap-1" data-zoho-rows>
        <SectionLabel right={String(total)}>Documents</SectionLabel>
        {maySync && pendingShown.length ? <ZohoSelectBar kinds={tickKinds} days={tickDays} /> : null}
        {capped ? (
          <p className="text-xs text-muted" data-zoho-rows-capped>
            {show === "all" ? `The newest ${LIST_LIMIT} of ${total}, plus every red row.` : `The newest ${LIST_LIMIT} of ${total}.`} Every waiting row is under Waiting and every red row under Failed.
          </p>
        ) : null}
        {!filtered.length ? (
          <Empty title="Nothing here">{show === "failed" ? "No failures. Everything that was queued has posted or is waiting its turn." : "Nothing queued yet. Recording a payment, a deposit or a tax invoice queues it by itself (press Sync to Zoho to send it); Backfill queues what already exists."}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((r) => {
              const name = docs.get(`${r.kind}:${r.record_id}`)?.name ?? r.record_id.slice(0, 8);
              const words = resultWords(r.kind, r.zoho_result);
              return (
                <li key={r.id} id={`z-${r.id}`} className="py-3 flex flex-col gap-1.5 scroll-mt-24" data-zoho-row={r.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    {maySync && r.status === "pending" ? <input type="checkbox" className="h-5 w-5 accent-ink" aria-label={`Select ${kindWord(r.kind)} ${name}`} data-zoho-tick={r.id} data-kind={r.kind} data-day={dubaiDayOf(r.enqueued_at)} /> : null}
                    <Badge tone="outline">{kindWord(r.kind)}</Badge>
                    <span className="font-bold">{name}</span>
                    <span className="flex-1" />
                    {r.status === "synced" ? <Badge tone="green">Posted ✓</Badge> : r.status === "failed" ? <Badge tone="red">Failed</Badge> : <Badge tone="amber">Waiting</Badge>}
                    {maySync && r.status === "pending" ? <SyncThisButton id={r.id} /> : null}
                  </div>
                  <p className="text-xs text-muted">
                    Queued {formatDateTime(r.enqueued_at)}
                    {r.synced_at ? ` · posted ${formatDateTime(r.synced_at)}` : ""}
                    {r.attempts > 1 ? ` · ${r.attempts} tries` : ""}
                  </p>
                  {words ? <p className="text-sm font-semibold text-green" data-zoho-result>{words}</p> : null}
                  {r.last_error && r.status !== "synced" ? (
                    <p className="text-sm text-red font-semibold" data-zoho-reason>
                      {r.last_error}
                      {(() => { const fix = reasonHref(r.last_error, { kind: r.kind, recordId: r.record_id }); return fix ? <> <Link href={fix.href} className="underline underline-offset-4" data-zoho-fix-link>→ {fix.label}</Link></> : null; })()}
                    </p>
                  ) : null}
                  {r.status === "pending" ? (
                    whyMap.get(r.id) ? (
                      <p className="text-sm text-muted" data-zoho-why>
                        {whyMap.get(r.id)!.words}
                        {whyMap.get(r.id)!.href ? <> <Link href={whyMap.get(r.id)!.href!} className="font-bold underline underline-offset-4" data-zoho-fix-link>→ {whyMap.get(r.id)!.hrefLabel ?? "Open"}</Link></> : null}
                      </p>
                    ) : (
                      <p className="text-sm text-muted" data-zoho-why>{waitingTurnWords(mode)}</p>
                    )
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {r.zoho_id && org ? (
                      <a className="text-sm font-bold underline" href={zohoOpenUrl(org, r.kind, r.zoho_id)} target="_blank" rel="noreferrer" data-zoho-open>
                        Open in Zoho
                      </a>
                    ) : null}
                    {r.status === "failed" && !staff.viewingAs && !retryRefusal(r.zoho_result) ? (
                      <form action={retryZohoRow.bind(null, r.id)}>
                        <Button type="submit" tone="secondary" size="md" data-zoho-retry>Retry</Button>
                      </form>
                    ) : null}
                    {r.status === "failed" && retryRefusal(r.zoho_result) ? (
                      <span className="text-sm font-semibold" data-zoho-retry-refused>{retryRefusal(r.zoho_result)}</span>
                    ) : null}
                  </div>
                  {r.status === "failed" && !staff.viewingAs ? (
                    <details className="text-sm" data-zoho-by-hand>
                      <summary className="cursor-pointer font-bold min-h-11 inline-flex items-center">Done by hand in Zoho…</summary>
                      <form action={markZohoDoneByHand.bind(null, r.id)} className="flex flex-wrap items-end gap-2 pt-1">
                        <span className="flex-1 min-w-60">
                          <Input name="note" placeholder="What was done in Zoho (e.g. entered by hand as INV-123)" aria-label="What was done in Zoho" data-zoho-by-hand-note />
                        </span>
                        <Button type="submit" size="md" data-zoho-by-hand-save>Close the row</Button>
                      </form>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
