"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";
import { reloadIfStale } from "@/lib/app-version";
import { refreshWhenIdle } from "@/lib/refresh-idle";
import { aed, confirmLabel, confirmQuestion, itemsWord, kindWord, mergeItems, runWords, tallyItems, type PreviewRow, type RunItem } from "@/lib/zoho-sync-rules";
import type { SyncPreview } from "@/lib/zoho-manual";
import { zohoSyncChunkAction, zohoSyncFinishAction, zohoSyncPreviewAction, zohoSyncRetryAction, zohoSyncStartAction } from "./actions";

type Phase = "closed" | "loading" | "preview" | "sending" | "results";

/** "Sync this" on a row and "Sync N selected" in the bar open the same window with just those rows. */
export const ZOHO_SYNC_EVENT = "erp:zoho-sync";
export function openZohoSync(ids: string[] | null) {
  window.dispatchEvent(new CustomEvent(ZOHO_SYNC_EVENT, { detail: { ids } }));
}

const timeOf = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "");

/**
 * THE "Sync to Zoho" button and its centre window (3 November 2026, section 11): 1. the preview from the server (how
 * many tax invoices, payments, bills, settlements… and their ERP totals, where it goes, what is held back and why),
 * 2. "Yes, send N items to OFJ TEST", 3. the progress ("Sending 12 of 47"), part by part, with Stop, 4. the results in
 * the same window: failed with the reason and Retry, still waiting with the reason, posted with Zoho's figures.
 * Nothing is sent before the Yes, and only the rows the person saw. The totals count only what reaches Zoho for the
 * first time; what is taken back out of Zoho, looked at again, or closed with nothing sent has its own lines.
 *
 * The daily reminder and Waiting on you link to /zoho?sync=1: EVERY arrival of that address opens the window — also a
 * tap on the bell while this page is already open (the page stays mounted then, so the address is watched, not read
 * once at mount; review of 3 November 2026).
 */
export function ZohoSyncButton({ waiting }: { waiting: number }) {
  const router = useRouter();
  const wantSync = useSearchParams().get("sync") === "1";
  const [phase, setPhase] = useState<Phase>(wantSync ? "loading" : "closed");
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<RunItem[]>([]);
  const [total, setTotal] = useState(0);
  const [sentIds, setSentIds] = useState<string[]>([]);
  const [stopped, setStopped] = useState<string | null>(null);
  const [recon, setRecon] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [stopAsked, setStopAsked] = useState(false);
  const stopRef = useRef(false);
  // A run is going: a bell tapped meanwhile never reloads the preview over it.
  const sendingRef = useRef(false);
  // Closed while the preview was still loading: the answer must not open the window again.
  const isOpen = useRef(false);

  // ?sync=1 arrived (the first visit, or the bell tapped on this page): the window shows "Checking…" at once
  // (state follows the address during render, the prev-value pattern); the effect below reads the preview.
  const [seenWant, setSeenWant] = useState(wantSync);
  if (wantSync !== seenWant) {
    setSeenWant(wantSync);
    if (wantSync && phase !== "sending") {
      setPhase("loading");
      setError(null);
      setItems([]);
      setStopped(null);
      setRecon(null);
      setStopAsked(false);
    }
  }

  /** The ticked rows this window covers (null = everything waiting). */
  const [onlyIds, setOnlyIds] = useState<string[] | null>(null);
  const onlyRef = useRef<string[] | null>(null);

  /** Reads the preview from the server (the ERP only; nothing is sent). */
  const load = async (ids: string[] | null = onlyRef.current) => {
    onlyRef.current = ids;
    setOnlyIds(ids);
    let p: SyncPreview | null = null;
    let err: string | null = null;
    try {
      const r = await zohoSyncPreviewAction(ids);
      p = r.preview;
      err = r.error;
    } catch (e) {
      if (reloadIfStale(e)) return;
      err = "No connection: the preview could not be read. Close and try again.";
    }
    if (!isOpen.current) return;
    setPreview(p);
    setError(err);
    setPhase("preview");
  };

  const open = (ids: string[] | null = null) => {
    isOpen.current = true;
    setPhase("loading");
    setError(null);
    setItems([]);
    setStopped(null);
    setRecon(null);
    setStopAsked(false);
    stopRef.current = false;
    void load(ids);
  };

  // "Sync this" on a row and "Sync N selected" in the bar: the same window, just those rows.
  useEffect(() => {
    const onAsk = (e: Event) => {
      if (sendingRef.current) return;
      const ids = (e as CustomEvent<{ ids: string[] | null }>).detail?.ids ?? null;
      open(Array.isArray(ids) && ids.length ? ids : null);
    };
    window.addEventListener(ZOHO_SYNC_EVENT, onAsk);
    return () => window.removeEventListener(ZOHO_SYNC_EVENT, onAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The daily reminder and Waiting on you link here with ?sync=1: the address loses it at once (Back or a reload never
  // opens the window again; Next keeps the search params in step, so the next tap of the bell is a new arrival) and the
  // preview is read — unless a run is going in this window.
  useEffect(() => {
    if (!wantSync) return;
    // null, never window.history.state: Next only brings useSearchParams in step for a replaceState that does not carry
    // its own internal state (it copies that itself); with the old state it would keep ?sync=1 and a second tap of the
    // bell would arrive at "the same address" and open nothing. And one tick later, never in this effect itself: Next
    // patches replaceState in its app router's own effect, which on the first load runs AFTER this child's effect, so a
    // replaceState made now bypasses Next, the router keeps ?sync=1 and the bell tapped later on this page opens nothing
    // (found by test-s11 at integration, 3 November 2026).
    const tidy = window.setTimeout(() => {
      const u = new URL(window.location.href);
      if (u.searchParams.get("sync") !== "1") return;
      u.searchParams.delete("sync");
      window.history.replaceState(null, "", u.toString());
    }, 0);
    if (sendingRef.current) return () => window.clearTimeout(tidy);
    isOpen.current = true;
    stopRef.current = false;
    void load(null);
    return () => window.clearTimeout(tidy);
  }, [wantSync]);

  const close = () => {
    if (phase === "sending") return;
    isOpen.current = false;
    setPhase("closed");
    if (items.length) refreshWhenIdle(() => router.refresh());
  };

  useEffect(() => {
    if (phase === "closed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "sending") {
        isOpen.current = false;
        setPhase("closed");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  /** Yes, send: the run, part by part, until the list is done, stopped, or Zoho says stop. */
  const send = async () => {
    if (!preview) return;
    sendingRef.current = true;
    setPhase("sending");
    setError(null);
    stopRef.current = false;
    setStopAsked(false);
    let runId: string | null = null;
    let collected: RunItem[] = [];
    let stop: string | null = null;
    let all: string[] = [];
    try {
      const s = await zohoSyncStartAction(
        preview.ids,
        preview.groups.map((g) => ({ key: g.key, label: g.label, count: g.count, total: g.total })),
        { removals: preview.removals.count, removalsTotal: preview.removals.total, again: preview.again.count, nothing: preview.nothing.count },
      );
      if (s.error) {
        sendingRef.current = false;
        setError(s.error);
        setPhase("preview");
        return;
      }
      runId = s.runId;
      all = s.ids;
      setSentIds(all);
      setTotal(all.length);
      let left = s.ids;
      while (left.length) {
        if (stopRef.current) {
          stop = `Stopped by you after ${collected.length} of ${all.length}: the rest stayed waiting for the next Sync to Zoho.`;
          break;
        }
        const c = await zohoSyncChunkAction(runId, left);
        if (c.error) {
          stop = c.error;
          break;
        }
        collected = mergeItems(collected, c.items);
        setItems(collected);
        if (c.stopped) {
          stop = c.stopped;
          break;
        }
        if (!c.items.length && c.left.length >= left.length) {
          stop = "The sync made no progress: what was sent stays posted. Press Sync to Zoho again.";
          break;
        }
        left = c.left;
      }
    } catch (e) {
      if (reloadIfStale(e)) return;
      stop = "The connection dropped part-way: what was sent stays posted; press Sync to Zoho again for the rest.";
    }
    sendingRef.current = false;
    try {
      const f = await zohoSyncFinishAction(runId, stop);
      setRecon(f.recon);
    } catch {
      // The run's record closes itself after two quiet minutes.
    }
    setStopped(stop);
    setPhase("results");
    refreshWhenIdle(() => router.refresh());
  };

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      const r = await zohoSyncRetryAction(id);
      if (r.item) setItems((prev) => mergeItems(prev, [r.item as RunItem]));
      else if (r.error) setItems((prev) => prev.map((i) => (i.id === id ? { ...i, words: r.error } : i)));
    } catch (e) {
      if (!reloadIfStale(e)) setItems((prev) => prev.map((i) => (i.id === id ? { ...i, words: "No connection: Retry did not reach the server. Try again." } : i)));
    } finally {
      setRetrying(null);
      refreshWhenIdle(() => router.refresh());
    }
  };

  const tally = tallyItems(items);
  const reached = new Set(items.map((i) => i.id));
  const notReached = sentIds.filter((id) => !reached.has(id)).length;
  const failed = items.filter((i) => i.outcome === "failed");
  const stillWaiting = items.filter((i) => i.outcome === "waiting");
  const posted = items.filter((i) => i.outcome === "posted");
  const removed = items.filter((i) => i.outcome === "removed");
  const skipped = items.filter((i) => i.outcome === "skipped");
  const state = preview?.state;
  const canConfirm = !!preview && !state?.block && !preview.runningBy && preview.ids.length > 0;

  return (
    <>
      <Button type="button" size="md" onClick={() => open(null)} data-zoho-sync-open data-zoho-sync-now>
        Sync to Zoho{waiting ? ` · ${waiting}` : ""}
      </Button>
      {phase !== "closed" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label="Sync to Zoho" onClick={close} data-zoho-sync-window={phase}>
          <div className="w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card bg-white p-5 flex flex-col gap-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-extrabold flex-1 min-w-40">{phase === "results" ? "Sync to Zoho: results" : phase === "sending" ? "Sending to Zoho…" : "Sync to Zoho"}</h2>
              {phase !== "sending" ? (
                <Button type="button" tone="ghost" size="md" onClick={close} aria-label="Close" data-zoho-sync-close>
                  ✕
                </Button>
              ) : null}
            </div>

            {phase === "loading" ? <p className="text-sm font-semibold text-muted" data-zoho-sync-loading>Checking what is waiting…</p> : null}

            {error ? (
              <p className="rounded-control bg-red-soft px-4 py-3 text-sm font-semibold text-red" role="alert" data-zoho-sync-error>
                {error}
              </p>
            ) : null}

            {phase === "preview" && preview && state ? (
              <div className="flex flex-col gap-3" data-zoho-preview>
                <p className={`rounded-control px-4 py-3 text-sm font-bold ${state.real ? "border border-red-bar bg-red-soft text-red" : "bg-chip"}`} data-zoho-preview-dest={state.real ? "real" : "test"}>
                  {state.real ? `Sending to the REAL book: O F J AUTOMOTIVE WORKS LLC (${state.org})` : `Sending to OFJ TEST${state.org ? ` (${state.org})` : ""}`}
                  {state.testStub ? <span className="block text-xs font-semibold text-muted">Test server: there is no Zoho here; only rows a test marked are sent, by a stand-in.</span> : null}
                </p>
                {state.block ? (
                  <p className="rounded-control bg-red-soft px-4 py-3 text-sm font-semibold text-red" data-zoho-preview-block>
                    Nothing can be sent now: {state.block}
                  </p>
                ) : null}
                {preview.runningBy ? (
                  <p className="rounded-control bg-amber-soft px-4 py-3 text-sm font-semibold" data-zoho-preview-running>
                    {preview.runningBy.name} is sending to Zoho now (started {timeOf(preview.runningBy.startedAt)}). Wait for it to finish, then press Sync to Zoho again.
                  </p>
                ) : null}

                {preview.selected ? (
                  <p className="text-sm font-semibold" data-zoho-preview-selected={preview.selected.asked}>
                    {preview.selected.asked === 1 ? "The 1 row you picked" : `The ${preview.selected.asked} rows you picked`}
                    {preview.selected.missing ? ` (${preview.selected.missing} of them ${preview.selected.missing === 1 ? "is" : "are"} not waiting any more - sent meanwhile, or being sent now)` : ""}.{" "}
                    <button type="button" className="font-bold underline underline-offset-4" onClick={() => { setPhase("loading"); void load(null); }} data-zoho-preview-everything>Sync everything waiting instead</button>
                  </p>
                ) : null}
                {preview.needs.length ? (
                  <div className="rounded-control border border-amber-bar bg-amber-soft px-3 py-2 text-sm flex flex-col gap-2" data-zoho-preview-needs={preview.needs.length}>
                    <p className="font-bold">Needs another document first:</p>
                    {preview.needs.slice(0, 8).map((n) => (
                      <div key={`${n.rowId}-${n.words.slice(0, 20)}`} className="flex flex-col gap-1" data-zoho-need={n.rowId}>
                        <span>{n.words}</span>
                        <span className="flex flex-wrap items-center gap-2">
                          {n.addId ? (
                            <Button type="button" size="md" tone="secondary" onClick={() => { setPhase("loading"); void load([...(onlyIds ?? []), n.addId!]); }} data-zoho-need-add={n.addId}>
                              Add it to this sync
                            </Button>
                          ) : null}
                          {n.href ? <a className="text-sm font-bold underline min-h-11 inline-flex items-center" href={n.href} data-zoho-need-link>{n.hrefLabel ?? "Open"}</a> : null}
                        </span>
                      </div>
                    ))}
                    {preview.needs.length > 8 ? <p className="text-xs text-muted">and {preview.needs.length - 8} more</p> : null}
                  </div>
                ) : null}
                {preview.ids.length ? (
                  <>
                    <p className="text-sm font-semibold">
                      {itemsWord(preview.ids.length)} will be sent, in this order: customers and suppliers first, then each document before the ones that hang on it.
                    </p>
                    <ul className="flex flex-col divide-y divide-line rounded-control border border-line" data-zoho-preview-groups>
                      {preview.groups.map((g) => (
                        <li key={g.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm" data-zoho-preview-group={g.key} data-count={g.count} data-total={g.total.toFixed(2)}>
                          <span className="font-semibold flex-1 min-w-40">{g.label}</span>
                          <span className="font-bold tabular-nums">{g.count}</span>
                          <span className="tabular-nums w-36 text-right text-muted">{g.countOnly ? "—" : aed(g.total)}</span>
                        </li>
                      ))}
                    </ul>
                    {preview.moneyIn || preview.moneyOut ? (
                      <p className="text-sm text-muted">
                        {preview.moneyIn ? <span data-zoho-preview-money-in>Money in {aed(preview.moneyIn)}</span> : null}
                        {preview.moneyIn && preview.moneyOut ? " · " : ""}
                        {preview.moneyOut ? <span data-zoho-preview-money-out>Money out {aed(preview.moneyOut)}</span> : null}
                      </p>
                    ) : null}
                    {preview.removals.count ? (
                      <div className="rounded-control border border-red-bar bg-red-soft px-3 py-2 text-sm" data-zoho-preview-removals={preview.removals.count} data-total={preview.removals.total.toFixed(2)}>
                        <p className="font-bold text-red">
                          Taken back out of Zoho · {preview.removals.count} · {aed(preview.removals.total)}
                        </p>
                        <p>Voided or reversed in the ERP after {preview.removals.count === 1 ? "it" : "they"} reached Zoho: Yes removes {preview.removals.count === 1 ? "it" : "them"} from Zoho. Not in Money in or Money out above.</p>
                        <PreviewNames rows={preview.removals.rows} hook="data-zoho-preview-removal" />
                      </div>
                    ) : null}
                    {preview.again.count ? (
                      <div className="rounded-control bg-chip px-3 py-2 text-sm" data-zoho-preview-again={preview.again.count}>
                        <p className="font-semibold">Already in Zoho · {preview.again.count}: looked at again (a late file is attached, an advance is applied). No new money.</p>
                        <PreviewNames rows={preview.again.rows} hook="data-zoho-preview-again-row" />
                      </div>
                    ) : null}
                    {preview.nothing.count ? (
                      <div className="rounded-control bg-chip px-3 py-2 text-sm" data-zoho-preview-nothing={preview.nothing.count}>
                        <p className="font-semibold">Nothing goes to Zoho · {preview.nothing.count}: voided, cancelled or internal before {preview.nothing.count === 1 ? "it was" : "they were"} sent. The {preview.nothing.count === 1 ? "row closes" : "rows close"}.</p>
                        <PreviewNames rows={preview.nothing.rows} hook="data-zoho-preview-nothing-row" />
                      </div>
                    ) : null}
                    {preview.rows.some((r) => r.reason) ? (
                      <div className="rounded-control bg-amber-soft px-3 py-2 text-sm" data-zoho-preview-wait>
                        <p className="font-semibold">Tried before and still waiting (they go if they are ready now):</p>
                        <ul className="mt-1 flex flex-col gap-1">
                          {preview.rows
                            .filter((r) => r.reason)
                            .slice(0, 8)
                            .map((r) => (
                              <li key={r.id}>
                                <span className="font-semibold">{kindWord(r.kind)} {r.name ?? ""}</span>: {r.reason}
                              </li>
                            ))}
                        </ul>
                      </div>
                    ) : null}
                    <details className="text-sm" data-zoho-preview-list>
                      <summary className="cursor-pointer font-bold min-h-11 inline-flex items-center">See the {itemsWord(preview.ids.length)}</summary>
                      <ul className="flex flex-col divide-y divide-line">
                        {preview.rows.map((r) => (
                          <li key={r.id} className="py-1.5 flex flex-wrap gap-x-2" data-zoho-preview-row={r.id} data-zoho-preview-effect={r.effect}>
                            <span className="font-semibold">{kindWord(r.kind)}</span>
                            <span className="min-w-0 break-words">{r.name ?? "—"}</span>
                            {r.effect !== "new" ? <span className="text-muted">· {EFFECT_SHORT[r.effect]}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </>
                ) : (
                  <p className="text-sm font-semibold" data-zoho-preview-empty>
                    Nothing to send now.
                  </p>
                )}

                {preview.held.count ? (
                  <p className="text-sm text-muted" data-zoho-preview-held={preview.held.count}>
                    Not in this sync: {preview.held.words}
                    {preview.held.nextAt ? ` (from ${timeOf(preview.held.nextAt)})` : ""}.
                  </p>
                ) : null}
                {preview.beingSent ? <p className="text-sm text-muted" data-zoho-preview-busy={preview.beingSent}>{itemsWord(preview.beingSent)} being sent by another run at this moment: not in this sync.</p> : null}
                {preview.later ? (
                  <p className="text-sm font-semibold" data-zoho-preview-later={preview.later}>
                    OFJ TEST allows 1,000 Zoho calls a day: the first {preview.ids.length} go now; press Sync to Zoho again later for the other {preview.later}.
                  </p>
                ) : null}
                {preview.red ? (
                  <p className="text-sm text-red font-semibold" data-zoho-preview-red={preview.red}>
                    {preview.red} red row{preview.red === 1 ? " is" : "s are"} not part of this: Retry {preview.red === 1 ? "it" : "them"} one by one on this page (Failed).
                  </p>
                ) : null}
                {preview.ids.length ? <p className="text-xs text-muted">About {preview.calls} Zoho calls.</p> : null}

                {preview.ids.length ? (
                  <p className="text-base font-extrabold" data-zoho-confirm-question>
                    {confirmQuestion(preview.ids.length, state.bookLabel)}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="button" tone="secondary" size="lg" onClick={close} data-zoho-sync-cancel>
                    {preview.ids.length ? "Cancel" : "Close"}
                  </Button>
                  {preview.ids.length ? (
                    <Button type="button" size="lg" tone={state.real ? "danger" : "primary"} disabled={!canConfirm} onClick={() => void send()} className="!whitespace-normal text-center" data-zoho-sync-confirm>
                      {confirmLabel(preview.ids.length, state.bookLabel)}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {phase === "sending" ? (
              <div className="flex flex-col gap-3" data-zoho-sync-sending>
                <p className="text-sm font-bold" data-zoho-sync-progress={`${items.length}/${total}`}>
                  Sending {Math.min(items.length + 1, total)} of {total}… {items.length ? `(${runWords(tally)})` : ""}
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-chip">
                  <div className="h-full bg-ink transition-all" style={{ width: `${total ? Math.round((items.length / total) * 100) : 0}%` }} />
                </div>
                <p className="text-xs text-muted">Keep this window open until it finishes. Each part takes up to a minute.</p>
                <div>
                  <Button
                    type="button"
                    tone="secondary"
                    size="md"
                    disabled={stopAsked}
                    onClick={() => {
                      stopRef.current = true;
                      setStopAsked(true);
                    }}
                    data-zoho-sync-stop
                  >
                    {stopAsked ? "Stopping after this part…" : "Stop after this part"}
                  </Button>
                </div>
              </div>
            ) : null}

            {phase === "results" ? (
              <div className="flex flex-col gap-3" data-zoho-sync-results>
                <p className="text-base font-extrabold" data-zoho-sync-summary>
                  {runWords(tally)}
                </p>
                {stopped ? (
                  <p className="rounded-control bg-amber-soft px-4 py-3 text-sm font-semibold" data-zoho-sync-stopped>
                    {stopped}
                  </p>
                ) : null}
                {notReached ? <p className="text-sm text-muted" data-zoho-sync-not-reached={notReached}>{itemsWord(notReached)} not reached this time: still waiting, they go with the next Sync to Zoho.</p> : null}
                {recon ? <p className="text-sm text-muted" data-zoho-sync-recon>{recon}</p> : null}

                {failed.length ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-extrabold tracking-[0.08em] uppercase text-red">Failed · {failed.length}</span>
                    <ul className="flex flex-col divide-y divide-line rounded-control border border-red-bar">
                      {failed.map((i) => (
                        <li key={i.id} className="px-3 py-2.5 flex flex-col gap-1.5" data-zoho-sync-item="failed" data-outbox-id={i.id}>
                          <span className="text-sm">
                            <span className="font-bold">{kindWord(i.kind)}</span> {i.name ?? ""}
                          </span>
                          <span className="text-sm font-semibold text-red break-words" data-zoho-sync-reason>{i.words ?? "Zoho refused it."}</span>
                          <span className="flex flex-wrap items-center gap-2">
                            <Button type="button" tone="secondary" size="md" disabled={retrying === i.id} onClick={() => void retry(i.id)} data-zoho-sync-retry>
                              {retrying === i.id ? "Retrying…" : "Retry"}
                            </Button>
                            <a className="text-sm font-bold underline min-h-11 inline-flex items-center" href={`/zoho?show=failed#z-${i.id}`} data-zoho-sync-by-hand>
                              Done by hand in Zoho…
                            </a>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {stillWaiting.length ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-extrabold tracking-[0.08em] uppercase">Still waiting · {stillWaiting.length}</span>
                    <ul className="flex flex-col divide-y divide-line rounded-control border border-amber-bar">
                      {stillWaiting.map((i) => (
                        <li key={i.id} className="px-3 py-2.5 flex flex-col gap-1" data-zoho-sync-item="waiting" data-outbox-id={i.id}>
                          <span className="text-sm">
                            <span className="font-bold">{kindWord(i.kind)}</span> {i.name ?? ""}
                          </span>
                          <span className="text-sm text-muted break-words">{i.words ?? "Waits for the next sync."}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {removed.length ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-extrabold tracking-[0.08em] uppercase">Removed from Zoho · {removed.length}</span>
                    <ul className="flex flex-col divide-y divide-line rounded-control border border-line-strong">
                      {removed.map((i) => (
                        <li key={i.id} className="px-3 py-2.5 flex flex-col gap-1" data-zoho-sync-item="removed" data-outbox-id={i.id}>
                          <span className="text-sm">
                            <span className="font-bold">{kindWord(i.kind)}</span> {i.name ?? ""}
                          </span>
                          <span className="text-sm font-semibold break-words">{i.words ?? "Taken back out of Zoho."}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {skipped.length ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-extrabold tracking-[0.08em] uppercase text-muted">Nothing sent · {skipped.length}</span>
                    <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
                      {skipped.map((i) => (
                        <li key={i.id} className="px-3 py-2.5 flex flex-col gap-1" data-zoho-sync-item="skipped" data-outbox-id={i.id}>
                          <span className="text-sm">
                            <span className="font-bold">{kindWord(i.kind)}</span> {i.name ?? ""}
                          </span>
                          <span className="text-sm text-muted break-words">{i.words ?? "Nothing went to Zoho."}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {posted.length ? (
                  <details className="rounded-control border border-green px-3 py-1" data-zoho-sync-posted={posted.length}>
                    <summary className="cursor-pointer min-h-11 inline-flex items-center text-sm font-extrabold tracking-[0.08em] uppercase text-green-text">Posted ✓ · {posted.length}</summary>
                    <ul className="flex flex-col divide-y divide-line pb-2">
                      {posted.map((i) => (
                        <li key={i.id} className="py-1.5 flex flex-col" data-zoho-sync-item="posted" data-outbox-id={i.id}>
                          <span className="text-sm">
                            <span className="font-bold">{kindWord(i.kind)}</span> {i.name ?? ""}
                          </span>
                          {i.words ? <span className="text-xs font-semibold text-green-text break-words">{i.words}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="button" size="lg" onClick={close} data-zoho-sync-done>
                    Close
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

const EFFECT_SHORT: Record<PreviewRow["effect"], string> = {
  new: "",
  again: "already in Zoho, no new money",
  removal: "taken back out of Zoho",
  nothing: "nothing goes",
};

/** The names under one of the preview's own lines (first eight, then how many more). */
function PreviewNames({ rows, hook }: { rows: PreviewRow[]; hook: string }) {
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {rows.slice(0, 8).map((r) => (
        <li key={r.id} {...{ [hook]: r.id }}>
          <span className="font-semibold">{kindWord(r.kind)}</span> {r.name ?? ""}
          {r.words ? <span className="block text-xs text-muted">{r.words}</span> : null}
        </li>
      ))}
      {rows.length > 8 ? <li className="text-xs text-muted">and {rows.length - 8} more (see the list below)</li> : null}
    </ul>
  );
}
