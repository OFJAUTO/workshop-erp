import type { CurrentStaff } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { loadWaitingOnYou, type WaitingItem } from "@/lib/waiting";
import { Card, LinkButton, SectionLabel } from "./ui";

function Row({ i, owner }: { i: WaitingItem; owner: boolean }) {
  return (
    <li className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-bold">{i.plate}</span>
      {i.car ? <span className="text-muted">{i.car}</span> : null}
      <span className="flex-1 min-w-[12rem]">{i.what}</span>
      <span className="text-xs text-muted whitespace-nowrap">{owner ? `${i.role.replace(/_/g, " ")} · ` : ""}waiting {i.wait}</span>
      <LinkButton href={i.href} size="md">{i.actionLabel}</LinkButton>
    </li>
  );
}

/** The top of every person's dashboard: the cars whose next step is theirs, oldest first, one button each. */
export async function WaitingPanel({ staff, max = 8 }: { staff: CurrentStaff; max?: number }) {
  const settings = await getSettings();
  const items = await loadWaitingOnYou(staff, settings);
  const owner = staff.role_id === "owner";
  const shown = items.slice(0, max);
  const rest = items.slice(max);
  return (
    <Card className={`flex flex-col gap-2 ${items.length ? "border-ink" : ""}`}>
      <SectionLabel right={items.length ? `${items.length} · oldest first` : undefined}>Waiting on you</SectionLabel>
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing is waiting on you.</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((i) => <Row key={i.jobId} i={i} owner={owner} />)}
          {rest.length ? (
            <li className="pt-2">
              <details>
                <summary className="cursor-pointer min-h-10 flex items-center text-sm font-semibold text-muted">{rest.length} more</summary>
                <ul className="divide-y divide-line">{rest.map((i) => <Row key={i.jobId} i={i} owner={owner} />)}</ul>
              </details>
            </li>
          ) : null}
        </ul>
      )}
    </Card>
  );
}
