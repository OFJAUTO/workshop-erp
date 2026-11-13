"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startAnywayAction, tickJobLine } from "@/app/(app)/jobs/todo-actions";
import { SIDE_WORDS, handoverWords, readinessOf, type JobsToDo as Data, type TodoJob, type TodoPart } from "@/lib/jobs-to-do";

/**
 * JOBS TO DO (11 November 2026, Section 9): THE list of what to do on a car - the workshop tablet, the bodyshop page and
 * the printed job card. Customer requests and the manager's note at the top; "YOUR JOBS – WORKSHOP" numbered in
 * capitals with each job's parts (Here / Arriving / Not ordered) and a tick; the other department folded; parts with no
 * job under "Other parts"; "CUSTOMER SAID NO – DON'T DO" folded. No prices, costs or customer details.
 */
const PART_WORDS: Record<TodoPart["state"], string> = { here: "Here", arriving: "Arriving", not_ordered: "Not ordered" };
const PART_TONE: Record<TodoPart["state"], string> = { here: "border-green bg-green-soft text-green-text", arriving: "border-amber-bar bg-amber-soft text-amber-text", not_ordered: "border-red-bar bg-white text-red" };

export function JobsToDo({ jobId, data, canTick = false, print = false, showCheck = false, canStartAnyway = false }: { jobId: string; data: Data & { requests: string[]; managerNote: string | null; ready: boolean }; canTick?: boolean; print?: boolean; /** Advisors and managers: a department only guessed reads "check". */ showCheck?: boolean; /** The workshop or bodyshop manager: "Start anyway" on a line waiting for a part. */ canStartAnyway?: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const other = data.viewerSide === "workshop" ? "bodyshop" : "workshop";
  const doneOf = (j: TodoJob) => local[j.lineId] ?? j.done;
  const tick = (j: TodoJob) =>
    start(async () => {
      const next = !doneOf(j);
      setLocal((s) => ({ ...s, [j.lineId]: next }));
      const r = await tickJobLine(jobId, j.lineId, next);
      if (r.error) {
        setError(r.error);
        setLocal((s) => ({ ...s, [j.lineId]: !next }));
      } else router.refresh();
    });
  const handover = handoverWords({ ...data, mine: data.mine.map((j) => ({ ...j, done: doneOf(j) })) });
  const jobRow = (j: TodoJob, mine: boolean) => (
    <li key={j.lineId} className="flex flex-col gap-1 py-2" data-todo-job={j.lineId} data-todo-side={j.side} data-todo-done={doneOf(j) ? "1" : "0"}>
      <div className="flex items-start gap-3">
        {mine && canTick && data.ready && !print ? (
          <button type="button" onClick={() => tick(j)} disabled={busy} aria-pressed={doneOf(j)} aria-label={`${j.title} done`} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control border-2 text-lg font-extrabold ${doneOf(j) ? "border-green bg-green-soft text-green-text" : "border-line-strong bg-white"}`} data-todo-tick={j.lineId}>{doneOf(j) ? "✓" : ""}</button>
        ) : print ? <span className="flex h-6 w-6 shrink-0 items-center justify-center border-2 border-ink">{doneOf(j) ? "✓" : ""}</span> : null}
        <span className="w-6 shrink-0 font-semibold text-muted">{j.n}.</span>
        <span className="min-w-0 flex-1">
          <span className={`text-[16px] font-extrabold leading-snug ${doneOf(j) ? "line-through text-muted" : ""}`}>{j.title}</span>
          {j.positions?.length ? <span className="block text-xs font-semibold text-muted">{j.positions.join(", ").toUpperCase()}</span> : null}
        </span>
        {j.isNew ? <span className="shrink-0 rounded-full bg-ink px-2 py-0.5 text-xs font-bold text-on-dark" data-todo-new>NEW</span> : null}
        {showCheck && j.guessed ? <span className="shrink-0 rounded-full border border-amber-bar bg-amber-soft px-2 py-0.5 text-xs font-bold text-amber-text" data-todo-check title="The department was guessed from the work type: check it on the job card">check</span> : null}
      </div>
      {(() => {
        const r = readinessOf({ ...j, done: doneOf(j) });
        if (r.kind === "done") return null;
        const tone = r.kind === "ready" ? "border-green bg-green-soft text-green-text" : r.kind === "anyway" ? "border-ink bg-white text-ink" : "border-amber-bar bg-amber-soft text-amber-text";
        return (
          <div className="ml-14 flex flex-wrap items-center gap-2">
            <span className={`rounded-control border px-2 py-0.5 text-xs font-extrabold ${tone}`} data-todo-ready={r.kind}>{r.words}</span>
            {canStartAnyway && r.kind === "waiting" && !print ? <button type="button" disabled={busy} onClick={() => start(async () => { const x = await startAnywayAction(jobId, j.lineId); if (x.error) setError(x.error); else router.refresh(); })} className="min-h-11 rounded-control border border-ink bg-white px-3 text-xs font-bold" data-todo-start-anyway={j.lineId}>Start anyway (dismantle and prepare)</button> : null}
          </div>
        );
      })()}
      {j.parts.length ? (
        <ul className="ml-14 flex flex-wrap gap-1.5">
          {j.parts.map((p) => <li key={p.id} className={`rounded-full border px-2 py-0.5 text-xs font-bold ${PART_TONE[p.state]}`} data-todo-part={p.state}>{p.name.toUpperCase()}{p.positions?.length ? ` (${p.positions.join(", ")})` : ""} · {PART_WORDS[p.state]}{p.when ? ` ${p.when}` : ""}</li>)}
        </ul>
      ) : null}
    </li>
  );
  return (
    <section className={`flex flex-col gap-3 ${print ? "" : "rounded-card border-2 border-ink bg-white p-4"}`} data-jobs-to-do data-todo-words={data.words}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-extrabold uppercase tracking-[0.04em]">Jobs to do</h2>
        {data.words ? <span className="text-sm font-bold text-muted" data-todo-progress>{data.words}</span> : null}
      </div>
      {data.requests.length || data.managerNote ? (
        <div className="flex flex-col gap-1 rounded-control border border-line bg-canvas px-3 py-2 text-sm" data-todo-top>
          {data.requests.length ? <p><span className="font-bold">Customer asked: </span>{data.requests.join(" · ")}</p> : null}
          {data.managerNote ? <p><span className="font-bold">Manager&apos;s note: </span>{data.managerNote}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-col">
        <span className="text-xs font-extrabold uppercase tracking-[0.08em]" data-todo-mine-head>Your jobs – {SIDE_WORDS[data.viewerSide]} ({data.mine.length})</span>
        {data.mine.length ? <ol className="divide-y divide-line">{data.mine.map((j) => jobRow(j, true))}</ol> : <p className="py-2 text-sm text-muted">No {SIDE_WORDS[data.viewerSide].toLowerCase()} jobs on this car.</p>}
      </div>
      {handover && !print ? <p className="rounded-control border-2 border-amber-bar bg-amber-soft px-3 py-2 text-sm font-bold text-amber-text" data-todo-handover>Hand the car over: {handover}.</p> : null}
      {data.others.length ? (
        <details className="rounded-control border border-line px-3" open={print} data-todo-others>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold">{SIDE_WORDS[other]} works on this car ({data.others.length}) – not yours</summary>
          <ol className="divide-y divide-line">{data.others.map((j) => jobRow(j, false))}</ol>
        </details>
      ) : null}
      {data.otherParts.length ? (
        <div className="flex flex-col gap-1" data-todo-other-parts>
          <span className="text-xs font-extrabold uppercase tracking-[0.08em]">Other parts</span>
          <ul className="flex flex-wrap gap-1.5">{data.otherParts.map((p) => <li key={p.id} className={`rounded-full border px-2 py-0.5 text-xs font-bold ${PART_TONE[p.state]}`}>{p.name.toUpperCase()} · {PART_WORDS[p.state]}</li>)}</ul>
        </div>
      ) : null}
      {data.declined.length ? (
        <details className="rounded-control border border-red-bar px-3" data-todo-declined>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-extrabold text-red">CUSTOMER SAID NO – DON&apos;T DO ({data.declined.length})</summary>
          <ul className="pb-2 text-sm">{data.declined.map((d) => <li key={d}>{d}</li>)}</ul>
        </details>
      ) : null}
      {error ? <p className="text-sm font-bold text-red">{error}</p> : null}
    </section>
  );
}
