"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

const KEY = "erp-scroll";
const LOCK_MS = 5000;

/**
 * Two standing rules for every form in the app, applied once from the layout:
 *
 * 1. A tap never lands twice. The first submit of a form locks it for five seconds (the button
 *    goes pale); a second tap in that window is swallowed, so one tap makes one row, one receipt,
 *    one request. Forms that are meant to be submitted again quickly can opt out with
 *    data-allow-resubmit.
 *
 * 2. A long form keeps its place. The scroll position is remembered on submit and put back when the
 *    same page renders again after the action (a redirect back to the page normally jumps to the
 *    top). A link with a #target keeps its target.
 */
export function FormGuard() {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || form.tagName !== "FORM") return;
      if (form.dataset.allowResubmit !== undefined) return;
      const until = Number(form.dataset.busyUntil ?? 0);
      if (until > Date.now()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      form.dataset.busyUntil = String(Date.now() + LOCK_MS);
      const submitter = (e as SubmitEvent).submitter as HTMLElement | null;
      if (submitter) {
        submitter.style.opacity = "0.5";
        submitter.style.pointerEvents = "none";
        // An immediate reaction on every button: it pulses and shows "…" until the page moves on (buttons that already say "Saving…" keep their own word).
        const busy = setTimeout(() => {
          if (!/…$/.test(submitter.textContent ?? "")) submitter.dataset.busy = "1";
        }, 150);
        setTimeout(() => {
          clearTimeout(busy);
          delete submitter.dataset.busy;
          submitter.style.opacity = "";
          submitter.style.pointerEvents = "";
        }, LOCK_MS);
      }
      try {
        sessionStorage.setItem(KEY, JSON.stringify({ path: location.pathname, y: window.scrollY, t: Date.now() }));
      } catch {}
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as { path: string; y: number; t: number };
      if (s.path !== pathname || Date.now() - s.t > 20000) return;
      sessionStorage.removeItem(KEY);
      if (location.hash) return;
      const go = () => window.scrollTo({ top: s.y });
      go();
      requestAnimationFrame(go);
      setTimeout(go, 150);
      setTimeout(go, 500);
    } catch {}
  }, [pathname, search]);

  // 3. The browser's own "Please fill out this field" bubble never shows. The box that was refused gets a red
  //    outline and the system's message under it, in plain words; the first one gets the cursor.
  useEffect(() => {
    let lastAt = 0;
    type Box = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const messageFor = (el: Box) => {
      const v = el.validity;
      const type = (el as HTMLInputElement).type;
      if (v.valueMissing) return el.tagName === "SELECT" ? "Please choose one" : type === "checkbox" || type === "radio" ? "Please tick this" : type === "file" ? "Please add a file" : "Please fill this in";
      if (v.typeMismatch) return type === "email" ? "Please enter a proper email address" : type === "url" ? "Please enter a proper web address" : "Please check this entry";
      if (v.patternMismatch) return el.title || "Please check the format";
      if (v.tooShort) return `Please write at least ${(el as HTMLInputElement).minLength} characters`;
      if (v.tooLong) return `Please keep this under ${(el as HTMLInputElement).maxLength} characters`;
      if (v.rangeUnderflow || v.rangeOverflow) return `Please enter a number between ${(el as HTMLInputElement).min || "0"} and ${(el as HTMLInputElement).max}`;
      if (v.stepMismatch || v.badInput) return "Please enter a number";
      return "Please check this entry";
    };
    const hostOf = (el: Box) => (el.closest("label") ?? el.parentElement) as HTMLElement | null;
    const show = (el: Box, text: string) => {
      el.classList.add("erp-invalid");
      const host = hostOf(el);
      if (!host) return;
      let msg = host.querySelector<HTMLElement>(":scope > .erp-field-msg");
      if (!msg) {
        msg = document.createElement("span");
        msg.className = "erp-field-msg text-xs font-semibold text-red";
        host.appendChild(msg);
      }
      msg.textContent = text;
    };
    const clear = (el: Box) => {
      el.classList.remove("erp-invalid");
      hostOf(el)?.querySelector(":scope > .erp-field-msg")?.remove();
    };
    const onInvalid = (e: Event) => {
      const el = e.target as Box | null;
      if (!el || !("validity" in el)) return;
      e.preventDefault();
      show(el, messageFor(el));
      const now = Date.now();
      // The first refused box of this attempt gets the cursor and comes into view.
      if (now - lastAt > 100) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      lastAt = now;
      const onFix = () => {
        if (!el.validity.valid) return;
        clear(el);
        el.removeEventListener("input", onFix);
        el.removeEventListener("change", onFix);
      };
      el.addEventListener("input", onFix);
      el.addEventListener("change", onFix);
    };
    document.addEventListener("invalid", onInvalid, true);
    return () => document.removeEventListener("invalid", onInvalid, true);
  }, []);

  return null;
}

/**
 * For client components that refresh the page after a save: remembers where the page is and puts
 * it back if the refresh moved it to the top.
 */
export function keepScrollThrough(action: () => void) {
  const y = window.scrollY;
  action();
  if (y < 50) return;
  let tries = 0;
  const check = () => {
    tries++;
    if (Math.abs(window.scrollY - y) > 200 && window.scrollY < 50) window.scrollTo({ top: y });
    if (tries < 12) setTimeout(check, 100);
  };
  setTimeout(check, 50);
}
