"use client";

import { useEffect, useState } from "react";
import type { SpellSource } from "@/lib/spell-docs";

type Issue = { key: string; label: string; word: string; kind: "misspelled" | "mash"; suggestions: string[]; context: string };

/**
 * The quick spelling check before anything goes to a customer: the message and the document behind the link are
 * read for misspelt words and keyboard mash ("afqghjk"). Each word: tap a suggestion to fix it where it is stored
 * (or in the message), "Keep as is", or (the owner) "Add to dictionary". A reminder, never a block.
 */
export function SpellCheckPanel({ message, source, onMessage }: { message: string; source?: SpellSource | null; onMessage: (text: string) => void }) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [canAdd, setCanAdd] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The check runs once when the window opens; fixes in the message update it locally.
  const [checkedFor] = useState(message);
  // The parent builds the source object on every render: the check keys on its text so it runs once.
  const sourceKey = JSON.stringify(source ?? null);
  useEffect(() => {
    let alive = true;
    fetch("/api/spell", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: checkedFor, source: JSON.parse(sourceKey) }) })
      .then((r) => r.json())
      .then((j: { issues?: Issue[]; canAddWords?: boolean }) => { if (alive) { setIssues(j.issues ?? []); setCanAdd(!!j.canAddWords); } })
      .catch(() => { if (alive) setIssues([]); });
    return () => { alive = false; };
  }, [checkedFor, sourceKey]);

  const drop = (i: Issue) => setIssues((list) => (list ?? []).filter((x) => !(x.key === i.key && x.word === i.word)));
  async function fix(i: Issue, replacement: string) {
    setNote(null);
    if (i.key === "message") {
      const re = new RegExp(`(^|[^A-Za-zÀ-ÿ])${i.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^A-Za-zÀ-ÿ])`);
      const next = message.replace(re, (_m, pre: string) => `${pre}${replacement}`);
      onMessage(replacement ? next : next.replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1"));
      drop(i);
      return;
    }
    setBusy(`${i.key}|${i.word}`);
    const r = await fetch("/api/spell/fix", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: i.key, word: i.word, replacement }) }).then((x) => x.json()).catch(() => ({ error: "No connection." }));
    setBusy(null);
    if (r.error) setNote(r.error);
    else drop(i);
  }
  async function addWord(i: Issue) {
    setBusy(`${i.key}|${i.word}`);
    const r = await fetch("/api/spell/fix", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ addWord: i.word }) }).then((x) => x.json()).catch(() => ({ error: "No connection." }));
    setBusy(null);
    if (r.error) setNote(r.error);
    else setIssues((list) => (list ?? []).filter((x) => x.word.toLowerCase() !== i.word.toLowerCase()));
  }

  if (issues === null) return <p className="text-xs text-muted" data-spell-state="checking">Checking the spelling…</p>;
  if (!issues.length) return <p className="text-xs font-semibold text-green" data-spell-state="ok">✓ Spelling checked</p>;
  return (
    <div className="flex flex-col gap-2 rounded-control border border-amber-bar bg-amber-soft p-3" data-spell-state="issues" data-spell-panel>
      <span className="text-sm font-bold">Check the spelling before sending ({issues.length} word{issues.length === 1 ? "" : "s"})</span>
      {issues.map((i) => (
        <div key={`${i.key}|${i.word}`} className="flex flex-col gap-1 rounded-control bg-white p-2" data-spell-issue={i.word}>
          <span className="text-xs text-muted">{i.label}: {i.context}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold text-red line-through decoration-1">{i.word}</span>
            {i.kind === "mash" ? <span className="text-xs font-semibold text-amber">looks like random typing</span> : null}
            {i.suggestions.map((s) => (
              <button key={s} type="button" disabled={!!busy} onClick={() => void fix(i, s)} className="min-h-9 rounded-control border border-green bg-green-soft px-2 text-xs font-bold text-green" data-spell-fix={s}>{s}</button>
            ))}
            {i.kind === "mash" ? <button type="button" disabled={!!busy} onClick={() => void fix(i, "")} className="min-h-9 rounded-control border border-line-strong bg-white px-2 text-xs font-bold" data-spell-remove>Remove it</button> : null}
            <button type="button" onClick={() => drop(i)} className="min-h-9 rounded-control border border-line-strong bg-white px-2 text-xs font-bold" data-spell-keep>Keep as is</button>
            {canAdd && i.kind !== "mash" ? <button type="button" disabled={!!busy} onClick={() => void addWord(i)} className="min-h-9 rounded-control px-2 text-xs font-bold underline underline-offset-4" data-spell-add>Add to dictionary</button> : null}
          </span>
        </div>
      ))}
      {note ? <span className="text-xs font-semibold text-red">{note}</span> : null}
      <span className="text-[11px] text-muted">A reminder only: you can still send as it is.</span>
    </div>
  );
}
