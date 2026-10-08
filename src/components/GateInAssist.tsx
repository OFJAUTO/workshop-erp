"use client";

import { useEffect, useRef, useState } from "react";
import { JumpButton, ProblemsBar, formProblems, jumpTo, type Problem } from "./FormAssist";

/**
 * Drops into any plain form: watches the fields, lists what is still missing in the bar at the
 * bottom, jumps to the field on tap, and adds the round arrow button. Every choice group counts
 * as required.
 */
export function GateInAssist({ submitLabel }: { submitLabel: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [problems, setProblems] = useState<Problem[]>([]);

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const compute = () => {
      for (const el of Array.from(form.elements) as HTMLInputElement[]) if (el.type === "radio") el.dataset.required = "true";
      setProblems(formProblems(form));
    };
    const t = setTimeout(compute, 0);
    form.addEventListener("input", compute);
    form.addEventListener("change", compute);
    return () => {
      clearTimeout(t);
      form.removeEventListener("input", compute);
      form.removeEventListener("change", compute);
    };
  }, []);

  return (
    <>
      <span ref={anchor} className="hidden" />
      <ProblemsBar
        problems={problems}
        onJump={(key) => {
          const form = anchor.current?.closest("form");
          const el = form?.querySelector<HTMLElement>(`[name="${key}"]`);
          const box = el?.closest<HTMLElement>("[data-field]") ?? el;
          if (box) {
            if (!box.id) box.id = `item-${key}`;
            jumpTo(box.id.replace(/^item-/, ""));
          }
        }}
        submitLabel={submitLabel}
        onSubmit={() => {
          const form = anchor.current?.closest("form");
          if (!form) return;
          const p = formProblems(form);
          if (p.length) {
            setProblems(p);
            const el = form.querySelector<HTMLElement>(`[name="${p[0].key}"]`);
            const box = el?.closest<HTMLElement>("[data-field]") ?? el;
            if (box) {
              if (!box.id) box.id = `item-${p[0].key}`;
              jumpTo(box.id.replace(/^item-/, ""));
            }
            return;
          }
          form.requestSubmit();
        }}
      />
      <JumpButton />
    </>
  );
}
