"use client";

/**
 * A page never redraws itself under someone's fingers. Every live refresh (a saved change, a row changed
 * by someone else, the poll) waits until nobody is typing: no editable box has had a keystroke in the last
 * moment, or the box has been left. Then the refresh runs once. Shared by the quotation editor, the Parts
 * table and the live-refresh component, so the three never fight over the same screen.
 */
let lastKey = 0;
let listening = false;
let pending: { fn: () => void; timer: ReturnType<typeof setTimeout> | null } | null = null;

const QUIET_MS = 1500;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const mark = () => {
    lastKey = Date.now();
  };
  window.addEventListener("keydown", mark, true);
  window.addEventListener("input", mark, true);
}

/** True while someone is in a text box and typed within the last moment, or a menu is open. */
export function isTyping(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement as HTMLElement | null;
  const editable = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) && !(el as HTMLInputElement).readOnly;
  if (!editable) return false;
  const type = (el as HTMLInputElement).type;
  if (type === "checkbox" || type === "radio" || type === "file" || type === "submit" || type === "button") return false;
  return Date.now() - lastKey < QUIET_MS;
}

/** Runs the refresh once the typing has stopped; several requests in a row become one. */
export function refreshWhenIdle(fn: () => void) {
  listen();
  if (pending) {
    pending.fn = fn;
    return;
  }
  const attempt = () => {
    if (!pending) return;
    if (isTyping()) {
      pending.timer = setTimeout(attempt, 500);
      return;
    }
    const run = pending.fn;
    pending = null;
    run();
  };
  pending = { fn, timer: null };
  pending.timer = setTimeout(attempt, 0);
}
