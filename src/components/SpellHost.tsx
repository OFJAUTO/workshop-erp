"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { flaggedRanges, matchCase, rangeAt, tokens } from "@/lib/spell-rules";

type Flag = { word: string; kind: "misspelled" | "mash"; suggestions: string[] };
type Box = HTMLInputElement | HTMLTextAreaElement;
type Range = { start: number; end: number; word: string };
type Place = { left: number; top: number; width: number; height: number; bottom: number; scrollTop: number; scrollLeft: number };

/* What this page has learnt (per tab): words that are fine, words to underline with their suggestions, and words the
   person chose to ignore. A text whose words are all known needs no question to the server. */
const bad = new Map<string, Flag>();
const good = new Set<string>();
const ignored = new Set<string>();
let canAdd = false;

const lower = (w: string) => w.toLowerCase();
const isBox = (el: EventTarget | null): el is Box => (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.hasAttribute("data-spell") && !el.readOnly && !el.disabled;
const signedIn = () => !!document.querySelector('meta[name="erp-staff-id"]')?.getAttribute("content");

function rangesOf(text: string): Range[] {
  const flagged = new Set<string>();
  for (const [w] of bad) if (!ignored.has(w)) flagged.add(w);
  return flaggedRanges(text, flagged);
}

function unknownWords(text: string): boolean {
  return tokens(text).some((t) => t.word.length >= 3 && !good.has(lower(t.word)) && !bad.has(lower(t.word)));
}

function setValue(el: Box, next: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function placeOf(el: Box): Place {
  const r = el.getBoundingClientRect();
  return { left: r.left + el.clientLeft, top: r.top + el.clientTop, width: el.clientWidth, height: el.clientHeight, bottom: r.bottom, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft };
}
const samePlace = (a: Place | null, b: Place) => !!a && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height && a.scrollTop === b.scrollTop && a.scrollLeft === b.scrollLeft;

/**
 * THE spell check while typing (1 November 2026), mounted once on every staff page. Every word box that carries
 * data-spell (Input and Textarea do it by themselves; names, phones, plates, VINs, part numbers, addresses, amounts
 * and codes do not) gets a dotted underline under a word the dictionary does not know, a moment after typing stops.
 * The dictionary is the shared one (src/lib/spell.ts): names and car words are never underlined. A tap on an
 * underlined word shows the suggestions, Ignore, and - for the owner and the advisors - "Add to dictionary", which
 * adds it for everyone. A reminder only: nothing is ever blocked, and sending never asks about spelling.
 */
export function SpellHost() {
  const [box, setBox] = useState<Box | null>(null);
  const [text, setText] = useState("");
  const [, setLearnt] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const [menu, setMenu] = useState<{ range: Range; flag: Flag } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asked = useRef<AbortController | null>(null);
  const boxRef = useRef<Box | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Ask the server about a text with words this page has not seen yet (a moment after typing stops).
  const check = (el: Box, wait: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const value = el.value;
      if (!value.trim() || !unknownWords(value) || !signedIn()) return;
      asked.current?.abort();
      const ctl = new AbortController();
      asked.current = ctl;
      fetch("/api/spell", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: value.slice(0, 5000) }), signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { flagged?: Flag[]; canAdd?: boolean } | null) => {
          if (!j) return;
          canAdd = !!j.canAdd;
          const flagged = new Map((j.flagged ?? []).map((f) => [lower(f.word), f]));
          for (const t of tokens(value)) {
            const w = lower(t.word);
            const f = flagged.get(w);
            if (f) bad.set(w, f);
            else if (!bad.has(w)) good.add(w);
          }
          setLearnt((n) => n + 1);
        })
        .catch(() => {});
    }, wait);
  };

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target;
      if (menuRef.current?.contains(el as Node)) return;
      if (!isBox(el)) return;
      boxRef.current = el;
      setBox(el);
      setText(el.value);
      setMenu(null);
      check(el, 300);
    };
    const onInput = (e: Event) => {
      if (e.target !== boxRef.current || !boxRef.current) return;
      setText(boxRef.current.value);
      setMenu(null);
      check(boxRef.current, 700);
    };
    const onCaret = (e: Event) => {
      const el = boxRef.current;
      if (e.target !== el || !el) return;
      if (e instanceof KeyboardEvent && !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
      const caret = el.selectionStart ?? -1;
      if (el.selectionEnd !== el.selectionStart) return;
      const r = rangeAt(rangesOf(el.value), caret);
      const flag = r ? bad.get(lower(r.word)) : null;
      setNote(null);
      setMenu(r && flag ? { range: r, flag } : null);
    };
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("click", onCaret, true);
    document.addEventListener("keyup", onCaret, true);
    return () => {
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("click", onCaret, true);
      document.removeEventListener("keyup", onCaret, true);
    };
  }, []);

  const ranges = box ? rangesOf(text) : [];
  const showing = !!box && ranges.length > 0;

  // Follow the box while underlines show: scrolling the page or the box, the box growing.
  useEffect(() => {
    if (!showing || !box) return;
    let frame = 0;
    let last: Place | null = null;
    const tick = () => {
      if (!box.isConnected) {
        setBox(null);
        return;
      }
      const p = placeOf(box);
      if (!samePlace(last, p)) {
        last = p;
        setPlace(p);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [showing, box]);

  if (!box || typeof document === "undefined") return null;

  const replaceWith = (word: string) => {
    if (!menu) return;
    const el = box;
    const v = el.value;
    const { start, end } = menu.range;
    if (v.slice(start, end) !== menu.range.word) return setMenu(null);
    let next = v.slice(0, start) + word + v.slice(end);
    let caret = start + word.length;
    if (!word) {
      next = (v.slice(0, start).replace(/[ \t]+$/, "") + " " + v.slice(end).replace(/^[ \t]+/, "")).replace(/^ /, "");
      caret = Math.min(next.length, start);
    }
    setValue(el, next);
    el.focus();
    el.setSelectionRange(caret, caret);
    setText(el.value);
    setMenu(null);
  };
  const ignore = () => {
    if (!menu) return;
    ignored.add(lower(menu.range.word));
    setMenu(null);
    setLearnt((n) => n + 1);
  };
  const add = () => {
    if (!menu) return;
    const word = menu.range.word;
    setNote(null);
    fetch("/api/spell/fix", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ addWord: word }) })
      .then((r) => r.json())
      .then((j: { ok?: boolean; error?: string }) => {
        if (!j.ok) return setNote(j.error ?? "Couldn't add it – try again.");
        bad.delete(lower(word));
        good.add(lower(word));
        setMenu(null);
        setLearnt((n) => n + 1);
      })
      .catch(() => setNote("No connection – try again."));
  };

  const style = place && showing ? getComputedStyle(box) : null;
  const isArea = box instanceof HTMLTextAreaElement;
  const pieces: React.ReactNode[] = [];
  if (showing) {
    let at = 0;
    for (const r of ranges) {
      if (r.start > at) pieces.push(text.slice(at, r.start));
      pieces.push(
        <span key={r.start} data-spell-word={r.word} style={{ textDecorationLine: "underline", textDecorationStyle: "dotted", textDecorationColor: "#d92d20", textDecorationThickness: "2px", textUnderlineOffset: "3px" }}>
          {text.slice(r.start, r.end)}
        </span>,
      );
      at = r.end;
    }
    pieces.push(text.slice(at) + (isArea ? "​" : ""));
  }
  const visible = !!place && place.bottom > 0 && place.top < window.innerHeight;
  const below = !!place && place.top + place.height + 160 < window.innerHeight;

  return createPortal(
    <>
      {showing && place && style && visible ? (
        <div
          aria-hidden
          data-spell-overlay
          data-overlap-ok
          style={{
            position: "fixed",
            left: place.left,
            top: place.top,
            width: place.width,
            height: place.height,
            overflow: "hidden",
            pointerEvents: "none",
            zIndex: 60,
            color: "transparent",
            boxSizing: "border-box",
            paddingTop: style.paddingTop,
            paddingRight: style.paddingRight,
            paddingBottom: style.paddingBottom,
            paddingLeft: style.paddingLeft,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            fontStyle: style.fontStyle,
            letterSpacing: style.letterSpacing,
            wordSpacing: style.wordSpacing,
            textTransform: style.textTransform as React.CSSProperties["textTransform"],
            textIndent: style.textIndent,
            textAlign: style.textAlign as React.CSSProperties["textAlign"],
            lineHeight: isArea ? style.lineHeight : `${place.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)}px`,
            whiteSpace: isArea ? "pre-wrap" : "pre",
            overflowWrap: isArea ? "break-word" : "normal",
            wordBreak: style.wordBreak as React.CSSProperties["wordBreak"],
          }}
        >
          <div style={{ transform: `translate(${-place.scrollLeft}px, ${-place.scrollTop}px)` }}>{pieces}</div>
        </div>
      ) : null}
      {menu && place && visible ? (
        <div
          ref={menuRef}
          role="dialog"
          aria-label={`Spelling of ${menu.range.word}`}
          data-spell-menu={menu.range.word}
          className="fixed z-[61] flex max-w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 rounded-card border border-line-strong bg-white p-3 shadow-xl"
          style={below ? { left: Math.max(8, Math.min(place.left, window.innerWidth - 392)), top: place.top + place.height + 6 } : { left: Math.max(8, Math.min(place.left, window.innerWidth - 392)), bottom: window.innerHeight - place.top + 6 }}
          onPointerDown={(e) => e.preventDefault()}
        >
          <span className="text-xs text-muted">
            <span className="font-bold text-red">{menu.range.word}</span> {menu.flag.kind === "mash" ? "looks like random typing" : "is not in the dictionary"}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {menu.flag.suggestions.map((s) => {
              const shown = matchCase(menu.range.word, s);
              return (
                <button key={s} type="button" onClick={() => replaceWith(shown)} className="min-h-11 rounded-control border border-green bg-green-soft px-3 text-sm font-bold text-green" data-spell-suggest={shown}>
                  {shown}
                </button>
              );
            })}
            {menu.flag.kind === "mash" ? <button type="button" onClick={() => replaceWith("")} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-sm font-bold" data-spell-remove>Remove it</button> : null}
            <button type="button" onClick={ignore} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-sm font-bold" data-spell-ignore>Ignore</button>
            {canAdd && menu.flag.kind !== "mash" ? <button type="button" onClick={add} className="min-h-11 rounded-control px-2 text-sm font-bold underline underline-offset-4" data-spell-add>Add to dictionary</button> : null}
          </span>
          {note ? <span className="text-xs font-semibold text-red">{note}</span> : null}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
