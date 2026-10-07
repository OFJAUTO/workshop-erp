"use client";

import { useState } from "react";
import { Button, Input } from "./ui";

/**
 * One short line per customer request. Enter adds a line; lines can be
 * reordered and removed. Submits as repeated `requests` fields in order.
 */
export function RequestsList({ initial = [], locked = false }: { initial?: string[]; locked?: boolean }) {
  const [lines, setLines] = useState<string[]>(initial.length ? initial : [""]);

  function update(i: number, v: string) {
    setLines((l) => l.map((x, idx) => (idx === i ? v : x)));
  }
  function add(after?: number) {
    setLines((l) => {
      const copy = [...l];
      copy.splice((after ?? l.length - 1) + 1, 0, "");
      return copy;
    });
    setTimeout(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('input[name="requests"]');
      inputs[(after ?? lines.length - 1) + 1]?.focus();
    }, 0);
  }
  function remove(i: number) {
    setLines((l) => (l.length === 1 ? [""] : l.filter((_, idx) => idx !== i)));
  }
  function move(i: number, dir: -1 | 1) {
    setLines((l) => {
      const j = i + dir;
      if (j < 0 || j >= l.length) return l;
      const copy = [...l];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  if (locked) {
    return (
      <ol className="list-decimal pl-5 flex flex-col gap-1 text-sm">
        {initial.map((t, i) => (
          <li key={i}>
            {t}
            <input type="hidden" name="requests" value={t} />
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {lines.map((text, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-6 text-right text-sm font-bold text-muted">{i + 1}.</span>
          <Input
            name="requests"
            value={text}
            onChange={(e) => update(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(i);
              }
            }}
            placeholder="One request, in the customer's words"
            required={i === 0}
            className="flex-1"
          />
          <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="h-11 w-9 rounded-control border border-line-strong bg-white text-sm disabled:opacity-30">
            ↑
          </button>
          <button type="button" onClick={() => move(i, 1)} disabled={i === lines.length - 1} aria-label="Move down" className="h-11 w-9 rounded-control border border-line-strong bg-white text-sm disabled:opacity-30">
            ↓
          </button>
          <button type="button" onClick={() => remove(i)} aria-label="Remove" className="h-11 w-9 rounded-control border border-line-strong bg-white text-sm text-red">
            ✕
          </button>
        </div>
      ))}
      <div>
        <Button type="button" tone="secondary" size="md" onClick={() => add()}>
          Add another request
        </Button>
      </div>
    </div>
  );
}
