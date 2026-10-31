"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, LinkButton } from "./ui";
import { coveredByDevice, deviceWord, useDeviceFiles } from "./MediaCapture";
import type { Checklist } from "@/lib/media";
import { GATE_IN_ATTEMPT_EVENT, itemsLeftLine, missingButtonLabel, missingItems } from "@/lib/media-checklist";
import { onSendEvent, scopeOf } from "@/lib/send-queue";

/**
 * The one button at the top of the photos step. Complete: "Done, next car" or "Open job card". Incomplete: it names
 * what is missing ("Finish later: car picture missing", "2 items missing: car picture, keys back"). Pressing it turns
 * the missing items red, scrolls to the first and shows "Go to next" and "Leave it for now" right under the button.
 * Files still on this device (THE send queue, 31 October 2026) are named too - "2 still sending from this tablet" -
 * so nobody walks away thinking a photo that has not arrived is in.
 */
export function FinishGateInButton({ check: serverCheck, href, completeLabel, jobId }: { check: Checklist; href: string; completeLabel: string; /** The car, to find its files still on this device. */ jobId?: string }) {
  const device = useDeviceFiles(jobId);
  // The server's own checklist that came back with the last file it recorded, until the page's refresh brings it too:
  // a file leaving the device never shows as "missing" for a moment in between.
  const [fresh, setFresh] = useState<Checklist | null>(null);
  const [seen, setSeen] = useState(serverCheck);
  if (seen !== serverCheck) {
    setSeen(serverCheck);
    setFresh(null);
  }
  useEffect(() => {
    if (!jobId) return;
    const scope = scopeOf("gate_in", jobId);
    return onSendEvent((e) => {
      if (e.scope !== scope || e.type !== "sent") return;
      const c = e.result.checklist as Checklist | undefined;
      if (c && Array.isArray(c.wheels)) setFresh(c);
    });
  }, [jobId]);
  const check = fresh ?? serverCheck;
  const missing = missingItems(check);
  const [attempted, setAttempted] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const uncovered = missing.filter((m) => !coveredByDevice(m, check, device));
  const stopped = device.filter((f) => f.state === "stopped").length;
  // Only on the device (never on the server's first render): "this tablet", "this phone" or "this computer".
  const where = device.length ? deviceWord() : "";
  const stillSending = `${device.length} still sending from this ${where}`;
  const deviceNote = device.length ? (stopped ? `${stopped} could not be sent – tap Try again on it below` : `${stillSending} – it carries on by itself`) : null;

  if (missing.length === 0) {
    return (
      <div className="flex flex-col items-end gap-1" data-finish-gate-in data-complete="true" data-device-files={device.length}>
        <LinkButton href={href} tone="primary" size="lg">{completeLabel}</LinkButton>
        {deviceNote ? <span className={`text-xs font-semibold ${stopped ? "text-red" : "text-amber"}`} data-finish-device>{deviceNote}</span> : null}
      </div>
    );
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

  // Everything missing is on its way from this device: say that, not "missing".
  const label = uncovered.length ? `${missingButtonLabel(uncovered)}${device.length ? ` · ${device.length} still sending` : ""}` : stillSending;
  const pressed = uncovered.length ? "border-red-bar text-red" : "border-amber-bar text-amber";

  return (
    <div className="flex flex-col items-end gap-1.5" data-finish-gate-in data-device-files={device.length}>
      <Button type="button" tone="secondary" size="lg" onClick={attempt} data-finish-button className={attempted ? pressed : ""}>
        {label}
      </Button>
      {attempted ? (
        <div className="flex flex-wrap items-center justify-end gap-2" data-finish-result>
          {uncovered.length ? <span className="text-xs font-semibold text-red">{itemsLeftLine(uncovered)}</span> : null}
          {deviceNote ? <span className={`text-xs font-semibold ${stopped ? "text-red" : "text-amber"}`} data-finish-device>{deviceNote}</span> : null}
          <Button type="button" tone="secondary" size="md" onClick={jump}>Go to next</Button>
          <Link href={href} className="min-h-10 inline-flex items-center text-xs font-semibold underline underline-offset-4 text-muted">Leave it for now</Link>
        </div>
      ) : null}
    </div>
  );
}
