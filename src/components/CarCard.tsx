import Link from "next/link";
import type { ReactNode } from "react";
import type { Stage, Timing } from "@/lib/jobs";
import type { StageBoxState } from "@/lib/stage-style";
import { nameCase } from "@/lib/name-case";
import { CarPicture } from "./CarPicture";
import { StageBar } from "./StageBar";
import { Words } from "./Words";
import { CustomerName } from "./CustomerPanel";
import { StaffTag } from "./StaffTag";

/**
 * THE car card (29 October 2026, batch section 2): the dashboard, Jobs, My jobs, To assign, Car wash and the
 * bodyshop board all draw a car with this one component, so a car looks the same everywhere and never breaks on a
 * tablet. The card measures itself (container queries), not the window:
 *  - narrow (a phone, a tablet held upright, a side column): the photo on the left; on the right the plate on one
 *    line, the car in capitals, "customer · condition · job number" and the chips, which wrap instead of
 *    overlapping; under it, full width: what it waits on, the warning chips, then the slim stage bar;
 *  - wide (a card of 60rem and more): photo and details in a fixed 27rem block, the status column taking the rest.
 * The whole card opens the car; buttons inside it (the quotation picker) sit above the link and work on their own.
 */
export type CarCardProps = {
  /** Where a tap opens the car; or onPick for a page that picks the car instead (To assign). */
  href?: string;
  onPick?: () => void;
  pictureUrl: string | null;
  plate: string;
  /** Make, model, year: shown in capitals. */
  title: string;
  /**
   * The job's customer (29 October 2026, batch 2 section 1): only ever passed for the owner, advisors and accounts.
   * The name opens the owner details panel; a company shows its contact person; a car the customer did not drive in
   * gets its own small line.
   */
  customer?: { name: string; jobId?: string | null; customerId?: string | null; contact?: string | null; arrived?: string | null } | null;
  /** The people on the car: their own "Tech · Moayad +1" tag next to the advisor's, never in the customer line. */
  staffNames?: string[];
  /** "condition · J-00016 · …" after the customer: the empty parts are left out. */
  sub?: (string | null | false | undefined)[];
  /** Small chips by the plate: days in stage, priority, VIP, the advisor. They wrap. */
  chips?: ReactNode;
  /** What the car waits on, and its detail ("Quote sent yesterday"). */
  status?: { line: string; detail?: string | null } | null;
  /** Warning chips under the status ("Quotation not sent · 15 h", "Priced"). */
  alerts?: ReactNode;
  stage?: { stage: Stage; timing: Timing; skip?: Stage[]; states?: Partial<Record<Stage, StageBoxState>> | null } | null;
  /** Anything else full width at the bottom (a page's own line, a timer). */
  extra?: ReactNode;
  /** Buttons and pickers that work on their own (above the card's link). */
  actions?: ReactNode;
  dim?: boolean;
  selected?: boolean;
  /** The card's border: red or amber when the car is late. */
  tone?: "red" | "amber" | "none";
} & Record<`data-${string}`, string | number | boolean | undefined>;

export function CarCard({ href, onPick, pictureUrl, plate, title, customer = null, staffNames = [], sub = [], chips, status, alerts, stage, extra, actions, dim = false, selected = false, tone = "none", ...rest }: CarCardProps) {
  const subLine = sub.filter((x): x is string => !!x && !!String(x).trim()).join(" · ");
  return (
    <div {...rest} className={`@container relative rounded-card border bg-white ${selected ? "border-ink ring-2 ring-ink" : tone === "red" ? "border-red-bar" : tone === "amber" ? "border-amber-bar" : "border-line"} hover:border-ink ${dim ? "opacity-75" : ""}`} data-car-card>
      {/* The card's own link sits under the content: tapping anywhere opens the car, buttons above it keep their own taps. */}
      {onPick ? (
        <button type="button" onClick={onPick} aria-pressed={selected} aria-label={`Pick ${plate}`} className="absolute inset-0 z-0 cursor-pointer rounded-card" data-overlap-ok data-car-card-pick />
      ) : href ? (
        <Link href={href} aria-label={`Open ${plate}`} className="absolute inset-0 z-0 rounded-card" data-overlap-ok data-car-card-link />
      ) : null}
      <div className="pointer-events-none relative z-10 flex flex-col gap-3 p-4 @[60rem]:flex-row @[60rem]:items-center @[60rem]:gap-5 @[60rem]:p-5">
        <div className="flex min-w-0 gap-3 @[60rem]:w-[27rem] @[60rem]:shrink-0 @[60rem]:gap-4">
          <CarPicture url={pictureUrl} alt={plate} className="w-24 shrink-0 self-start @[40rem]:w-36 @[60rem]:w-44" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[17px] font-extrabold uppercase tracking-[0.03em] whitespace-nowrap" data-car-plate>{plate}</span>
            {title ? <Words text={title} className="text-sm font-semibold uppercase" data-car-title /> : null}
            {customer || subLine ? (
              <span className="text-xs text-muted" data-car-sub>
                {customer ? (
                  <span data-car-customer>
                    <CustomerName name={nameCase(customer.name)} jobId={customer.jobId} customerId={customer.customerId} className="font-semibold text-ink" />
                    {customer.contact ? <Words text={` · ${customer.contact}`} /> : null}
                  </span>
                ) : null}
                {customer && subLine ? " · " : null}
                {subLine ? <Words text={subLine} /> : null}
              </span>
            ) : null}
            {customer?.arrived ? <span className="text-xs text-muted" data-car-arrived>{customer.arrived}</span> : null}
            {chips || staffNames.length ? (
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5" data-car-chips>
                {chips}
                <StaffTag names={staffNames} />
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2.5 @[60rem]:flex-1">
          {status || alerts || actions ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              {status ? (
                <span className="text-sm font-bold" data-car-status>
                  <Words text={status.line} />
                  {status.detail ? <span className="font-normal text-muted"> · <Words text={status.detail} /></span> : null}
                </span>
              ) : null}
              {alerts}
              {actions ? <span className="pointer-events-auto inline-flex flex-wrap items-center gap-2" data-car-actions>{actions}</span> : null}
            </div>
          ) : null}
          {stage ? <StageBar stage={stage.stage} timing={stage.timing} skip={stage.skip} states={stage.states} /> : null}
          {extra ? <div className="pointer-events-auto">{extra}</div> : null}
        </div>
      </div>
    </div>
  );
}
