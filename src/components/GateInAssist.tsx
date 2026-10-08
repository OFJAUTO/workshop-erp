"use client";

import { useEffect, useRef, useState } from "react";
import { JumpButton, ProblemsBar, formFields, jumpTo, type Problem } from "./FormAssist";

/**
 * Drops into any plain form: watches the fields, shows neutral progress in the bar at the
 * bottom, and after a Submit with something missing lists the problems in red, jumping to the
 * field on tap. Every choice group counts as required.
 */
export function GateInAssist({ submitLabel }: { submitLabel: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const compute = () => {
      for (const el of Array.from(form.elements) as HTMLInputElement[]) if (el.type === "radio") el.dataset.required = "true";
      const fields = formFields(form);
      setProblems(fields.filter((f) => !f.valid).map((f) => ({ key: f.key, label: `${f.label}: missing` })));
      setProgress({ done: fields.filter((f) => f.valid).length, total: fields.length });
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

  const jump = (key: string) => {
    const form = anchor.current?.closest("form");
    const el = form?.querySelector<HTMLElement>(`[name="${key}"]`);
    const box = el?.closest<HTMLElement>("[data-field]") ?? el;
    if (box) {
      if (!box.id) box.id = `item-${key}`;
      jumpTo(box.id.replace(/^item-/, ""));
    }
  };

  return (
    <>
      <span ref={anchor} className="hidden" />
      <ProblemsBar
        problems={problems}
        attempted={attempted}
        progress={progress}
        onJump={jump}
        submitLabel={submitLabel}
        onSubmit={() => {
          const form = anchor.current?.closest("form");
          if (!form) return;
          const fields = formFields(form);
          const p = fields.filter((f) => !f.valid).map((f) => ({ key: f.key, label: `${f.label}: missing` }));
          if (p.length) {
            setAttempted(true);
            setProblems(p);
            jump(p[0].key);
            return;
          }
          form.requestSubmit();
        }}
      />
      <JumpButton />
    </>
  );
}
