import type { CurrentStaff } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { loadWaitingOnYou, type WaitingItem } from "@/lib/waiting";
import { Card, LinkButton } from "./ui";

export type ExtraWaiting = { jobId: string; plate: string; car: string | null; what: string; amount: string | null; actionLabel: string; href: string };

function Row({ i, owner }: { i: WaitingItem & { amount?: string | null }; owner: boolean }) {
  return (
    <li className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-bold">{i.plate}</span>
      {i.car ? <span className="text-muted">{i.car}</span> : null}
      <span className="flex-1 min-w-[12rem]">{i.what}{i.amount ? <span className="font-bold"> · {i.amount}</span> : null}</span>
      <span className="text-xs text-muted whitespace-nowrap">{owner ? `${i.role.replace(/_/g, " ")} · ` : ""}{i.wait ? `waiting ${i.wait}` : ""}</span>
      <LinkButton href={i.href} size="md">{i.actionLabel}</LinkButton>
    </li>
  );
}

/**
 * "WAITING ON YOU (N)": the one box at the top of every person's first page, holding everything whose next
 * step is theirs - proformas to send and payments awaited included. Tapping it opens the list right here;
 * when there is nothing, it shrinks to one line: "Nothing waiting ✓".
 */
export async function WaitingPanel({ staff, extra = [] }: { staff: CurrentStaff; extra?: ExtraWaiting[] }) {
  const settings = await getSettings();
  const items = await loadWaitingOnYou(staff, settings);
  const owner = staff.role_id === "owner";
  const have = new Set(items.map((i) => i.jobId));
  const all: (WaitingItem & { amount?: string | null })[] = [
    ...items,
    ...extra.filter((e) => !have.has(e.jobId)).map((e) => ({ jobId: e.jobId, plate: e.plate, car: e.car, what: e.what, amount: e.amount, role: staff.role_id, wait: "", href: e.href, actionLabel: e.actionLabel }) as WaitingItem & { amount?: string | null }),
  ];
  if (all.length === 0) {
    return (
      <Card className="py-3" data-waiting-panel>
        <p className="text-sm font-bold text-green" data-waiting-empty>Nothing waiting ✓</p>
      </Card>
    );
  }
  return (
    <Card className="border-ink py-3" data-waiting-panel>
      <details>
        <summary className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-extrabold uppercase tracking-[0.08em]" data-waiting-summary>
          Waiting on you ({all.length})
          <span className="ml-auto text-xs font-semibold normal-case tracking-normal text-muted">tap to open · oldest first</span>
        </summary>
        <ul className="mt-1 divide-y divide-line">
          {all.map((i, idx) => <Row key={`${i.jobId}-${idx}`} i={i} owner={owner} />)}
        </ul>
      </details>
    </Card>
  );
}
