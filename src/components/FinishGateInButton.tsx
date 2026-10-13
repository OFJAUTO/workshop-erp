"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, LinkButton } from "./ui";
import type { Checklist } from "@/lib/media";
import { GATE_IN_ATTEMPT_EVENT, itemsLeftLine, missingButtonLabel, missingItems } from "@/lib/media-checklist";

/**
 * The one button at the top of the photos step. Complete: "Done, next car" or "Open job card". Incomplete: it names
 * what is missing ("Finish later: car picture missing", "2 items missing: car picture, keys back"). Pressing it turns
 * the missing items red, scrolls to the first and shows "Go to next" and "Leave it for now" right under the button.
 */
export function FinishGateInButton({ check, href, completeLabel }: { check: Checklist; href: string; completeLabel: string }) {
  const missing = missingItems(check);
  const [attempted, setAttempted] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  if (missing.length === 0) {
    return <div data-finish-gate-in data-complete="true"><LinkButton href={href} tone="primary" size="lg">{completeLabel}</LinkButton></div>;
  }

  function jump() {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-media-item][data-missing="true"]'));
    if (!els.length) return;
    const i = els.findIndex((el) => el.dataset.mediaItem === last);
    const el = els[(i + 1) % els.length];
    setLast(el.dataset.mediaItem ?? null);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function attempt() {
    setAttempted(true);
    window.dispatchEvent(new Event(GATE_IN_ATTEMPT_EVENT));
    jump();
  }

  return (
    <div className="flex flex-col items-end gap-1.5" data-finish-gate-in>
      <Button type="button" tone="secondary" size="lg" onClick={attempt} data-finish-button className={attempted ? "border-red-bar text-red" : ""}>
        {missingButtonLabel(missing)}
      </Button>
      {attempted ? (
        <div className="flex flex-wrap items-center justify-end gap-2" data-finish-result>
          <span className="text-xs font-semibold text-red">{itemsLeftLine(missing)}</span>
          <Button type="button" tone="secondary" size="md" onClick={jump}>Go to next</Button>
          <Link href={href} className="min-h-10 inline-flex items-center text-xs font-semibold underline underline-offset-4 text-muted">Leave it for now</Link>
        </div>
      ) : null}
    </div>
  );
}
