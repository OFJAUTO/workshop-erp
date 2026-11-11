import { CarCard } from "@/components/CarCard";
import { boardSearchHit, makeChips } from "@/lib/car-board";
import { thumbsFor } from "@/lib/media-urls";
import Link from "next/link";
import { HomeHeader } from "@/components/HomeHeader";
import {Card, Empty, SectionLabel} from "@/components/ui";
import { WaitingPanel } from "@/components/WaitingPanel";
import { partsWaitingExtra } from "@/lib/parts-waiting";
import { PartsSteps } from "@/components/PartsSteps";
import type { CurrentStaff } from "@/lib/auth";
import { partAdvisorCols } from "@/lib/parts-data";
import { PAST_QUOTE, partsSteps, stepPartOf, type PartsStepKey } from "@/lib/parts-steps";
import { approvedPartIds } from "@/lib/parts-changes-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { pricingTodoOf } from "@/lib/pricing-done";

/** The one thing to do next on a car's parts, per current step. */
const STEP_ACTIONS: Record<PartsStepKey, { label: string; href: (jobId: string) => string }> = {
  pricing: { label: "Price the parts", href: (id) => `/parts/${id}#pricing` },
  approval: { label: "Send the LPO for approval", href: (id) => `/parts/${id}#lpo` },
  lpo: { label: "Order from the supplier", href: (id) => `/parts/${id}#lpos` },
  received: { label: "Receive the parts", href: (id) => `/parts/${id}#received` },
  handover: { label: "Hand over", href: (id) => `/parts/handover/${id}` },
};

/**
 * The Parts role's dashboard: no workshop chips, only parts. Tiles with counts (to price, LPOs waiting, to order,
 * arriving today, overdue, received not handed over, supplier invoices missing), then the cars with parts activity,
 * each with the five step dots and the one button for its current step. "Waiting on you" stays at the top.
 */
export async function PartsDashboard({ staff, sp = {} }: { staff: CurrentStaff; sp?: { q?: string; make?: string; tile?: string; done?: string } }) {
  const admin = createAdminClient();
  // eslint-disable-next-line react-hooks/purity -- a server page: today is read once per request
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const [{ data: reqRows }, { data: partRows }, { data: poRows }] = await Promise.all([
    admin.from("part_requests").select("id, job_id, status").eq("is_active", true).eq("status", "open"),
    admin.from("part_items").select("id, job_id, is_active, order_status, received_qty, quantity, confirmed_quantity, issue_status, availability, supplier, po_id, return_status, cost_aed, confirm_status, expected_date, priced_at, removed_at" + (await partAdvisorCols())).eq("is_active", true),
    admin.from("purchase_orders").select("id, kind, status, supplier_invoice_status, job_id").eq("is_active", true),
  ]);
  const requests = (reqRows ?? []) as { id: string; job_id: string; status: string }[];
  // The select string is built (the advisor-price columns are ready-gated), so the result loses its type: cast it.
  const parts = (partRows ?? []) as unknown as { id: string; job_id: string; is_active: boolean; order_status: string | null; received_qty: number | string; quantity: number | string; confirmed_quantity: number | string | null; issue_status: string | null; availability: string | null; supplier: string | null; po_id: string | null; return_status: string | null; cost_aed: number | string | null; confirm_status: string | null; expected_date: string | null; priced_at: string | null; removed_at: string | null; priced_by_advisor?: boolean | null }[];
  const pos = (poRows ?? []) as { id: string; kind: string; status: string; supplier_invoice_status: string | null; job_id: string | null }[];
  // A car whose only changes wait for the send (not available, removed) is counted through its own mark.
  const { data: heldRows } = await admin.from("jobs").select("id").eq("is_open", true).not("parts_pricing_reopened_at", "is", null).limit(300);
  const jobIds = Array.from(new Set([...requests.map((r) => r.job_id), ...parts.map((p) => p.job_id), ...(heldRows ?? []).map((j) => j.id as string)].filter(Boolean)));
  const { data: jobRows } = jobIds.length ? await admin.from("jobs").select("id, job_number, status, is_open, gated_in_at, parts_pricing_done_at, parts_pricing_reopened_at, advisor_id, assigned_to, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, photo_path, make:vehicle_makes(name), model:vehicle_models(name))").in("id", jobIds).eq("is_open", true).order("gated_in_at", { ascending: false }) : { data: [] };
  type JobRow = { id: string; job_number: string; status: string; gated_in_at: string; parts_pricing_done_at: string | null; parts_pricing_reopened_at: string | null; advisor_id: string | null; assigned_to: string | null; vehicle: (Parameters<typeof formatPlate>[0] & { vin: string | null; photo_path: string | null; make: { name: string } | null; model: { name: string } | null }) | null };
  const jobs = ((jobRows ?? []) as unknown as JobRow[]);
  const open = new Set(jobs.map((j) => j.id));
  const openParts = parts.filter((p) => open.has(p.job_id));
  // Parts added after the customer's approval keep a car's steps open (5 November 2026, J-00985).
  const approvedMap = await approvedPartIds(jobs.map((j) => j.id));
  // Section 10 (3 November 2026): the same to-do rule as the parts desk - a car is on it until Pricing done – send to advisor.
  const todoOf = new Map(jobs.map((j) => [j.id, pricingTodoOf(j, requests.filter((r) => r.job_id === j.id), parts.filter((p) => p.job_id === j.id))] as const));
  const unreceived = (p: (typeof parts)[number]) => Number(p.received_qty) < Number(p.confirmed_quantity ?? p.quantity);

  const tiles: { key: string; label: string; count: number; href: string }[] = [
    { key: "to-price", label: "Cars to price or send", count: Array.from(todoOf.values()).filter(Boolean).length, href: "/parts" },
    { key: "lpo-approval", label: "LPOs waiting for approval", count: pos.filter((p) => p.status === "pending_approval").length, href: "/parts/orders" },
    { key: "to-order", label: "To order (send to supplier)", count: pos.filter((p) => (p.kind === "supplier" || p.kind === "stock") && p.status === "approved").length, href: "/parts/orders" },
    { key: "arriving", label: "Arriving today", count: openParts.filter((p) => p.expected_date === today && unreceived(p)).length, href: "/parts/arrivals" },
    { key: "overdue", label: "Overdue deliveries", count: openParts.filter((p) => !!p.expected_date && p.expected_date < today && unreceived(p) && ["ordered", "partly_received"].includes(p.order_status ?? "")).length, href: "/parts/arrivals" },
    { key: "to-handover", label: "Received, not handed over", count: openParts.filter((p) => p.order_status === "received" && p.issue_status !== "confirmed" && (p.return_status ?? "none") === "none").length, href: "/parts" },
    { key: "invoices-missing", label: "Supplier invoices missing", count: pos.filter((p) => p.supplier_invoice_status === "to_follow").length, href: "/parts/orders?tab=invoices" },
  ];

  // 11 November 2026 (Section 11): car cards, the tiles as filters, most urgent first, done cars folded, search and makes.
  const q = (sp.q ?? "").trim();
  const make = (sp.make ?? "").trim();
  const tile = tiles.some((t) => t.key === sp.tile) ? (sp.tile as string) : null;
  const showDone = sp.done === "1";
  const URGENCY = ["overdue", "arriving", "to-price", "to-order", "lpo-approval", "to-handover", "invoices-missing"];
  const carsAll = jobs.map((j) => {
    const steps = partsSteps({ jobStatus: j.status, pricingDoneAt: j.parts_pricing_done_at, pricingReopenedAt: j.parts_pricing_reopened_at, parts: parts.filter((p) => p.job_id === j.id).map((p) => stepPartOf(p, { pastQuote: PAST_QUOTE.includes(j.status), approvedIds: approvedMap.get(j.id) ?? new Set<string>() })) });
    const current = steps.find((st) => st.state === "current");
    const todo = todoOf.get(j.id) ?? null;
    const action = current ? (current.key === "pricing" && todo === "to_send" ? { label: "Send to advisor", href: (id: string) => `/parts/${id}#pricing` } : STEP_ACTIONS[current.key]) : null;
    const allDone = steps.every((st) => st.state === "done");
    const mine = openParts.filter((p) => p.job_id === j.id);
    const myPos = pos.filter((p) => p.job_id === j.id);
    const flags = new Set<string>();
    if (todo) flags.add("to-price");
    if (myPos.some((p) => p.status === "pending_approval")) flags.add("lpo-approval");
    if (myPos.some((p) => (p.kind === "supplier" || p.kind === "stock") && p.status === "approved")) flags.add("to-order");
    if (mine.some((p) => p.expected_date === today && unreceived(p))) flags.add("arriving");
    if (mine.some((p) => !!p.expected_date && p.expected_date < today && unreceived(p) && ["ordered", "partly_received"].includes(p.order_status ?? ""))) flags.add("overdue");
    if (mine.some((p) => p.order_status === "received" && p.issue_status !== "confirmed" && (p.return_status ?? "none") === "none")) flags.add("to-handover");
    if (myPos.some((p) => p.supplier_invoice_status === "to_follow")) flags.add("invoices-missing");
    const rank = Math.min(...Array.from(flags).map((x) => URGENCY.indexOf(x)), 99);
    const status = allDone ? "All parts done" : current ? `${current.label}${current.detail ? ` – ${current.detail}` : ""}` : "Waiting";
    return { j, steps, current, action, allDone, flags, rank, status };
  });
  const searchCar = (c: (typeof carsAll)[number]) => ({ plate: c.j.vehicle ? formatPlate(c.j.vehicle) : "", vin: c.j.vehicle?.vin ?? null, make: c.j.vehicle?.make?.name ?? null, model: c.j.vehicle?.model?.name ?? null, jobNumber: c.j.job_number });
  const filtered = carsAll.filter((c) => (!tile || c.flags.has(tile)) && boardSearchHit(searchCar(c), q) && (!make || c.j.vehicle?.make?.name === make)).sort((a, b) => a.rank - b.rank);
  const doneCars = filtered.filter((c) => c.allDone);
  const shown = showDone ? filtered : filtered.filter((c) => !c.allDone);
  const chips = makeChips(carsAll.filter((c) => !tile || c.flags.has(tile)).map(searchCar));
  const hrefOf = (o: { tile?: string | null; make?: string | null; done?: string }) => {
    const p = new URLSearchParams();
    const t = o.tile === undefined ? tile : o.tile;
    const m = o.make === undefined ? make : o.make;
    if (t) p.set("tile", t);
    if (m) p.set("make", m);
    if (q) p.set("q", q);
    if (o.done) p.set("done", o.done);
    const qs = p.toString();
    return `/dashboard${qs ? `?${qs}` : ""}`;
  };
  const staffIds = Array.from(new Set(jobs.flatMap((j) => [j.advisor_id, j.assigned_to]).filter((x): x is string => !!x)));
  const { data: staffRows } = staffIds.length ? await admin.from("staff").select("id, display_name").in("id", staffIds) : { data: [] };
  const nameOf = new Map(((staffRows ?? []) as { id: string; display_name: string }[]).map((x) => [x.id, x.display_name]));
  const thumbs = await thumbsFor("vehicle-photos", jobs.map((j) => j.vehicle?.photo_path ?? null), 480);
  return (
    <>
      <HomeHeader staff={staff} />
      <WaitingPanel staff={staff} extra={await partsWaitingExtra()} />
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-3" data-parts-tiles>
        {tiles.map((t) => (
          <Link key={t.key} href={tile === t.key ? hrefOf({ tile: null }) : hrefOf({ tile: t.key })} className={`flex min-h-20 flex-col justify-center rounded-card border-2 px-4 py-3 ${tile === t.key ? "border-ink bg-chip" : t.count ? "border-ink bg-white" : "border-line bg-white"}`} data-parts-tile={t.key} aria-current={tile === t.key ? "page" : undefined}>
            <span className="text-2xl font-extrabold">{t.count}</span>
            <span className="text-xs font-semibold text-muted">{t.label}</span>
          </Link>
        ))}
      </div>
      <form method="get" action="/dashboard" className="flex gap-2" data-parts-search>
        {tile ? <input type="hidden" name="tile" value={tile} /> : null}
        <input name="q" defaultValue={q} placeholder="Plate, VIN, make, model or job" className="min-h-12 flex-1 rounded-control border border-line-strong bg-white px-3 text-base" data-parts-search-input data-spell="" autoComplete="off" />
        <button type="submit" className="min-h-12 rounded-control bg-ink px-5 font-bold text-on-dark">Find</button>
      </form>
      {chips.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" data-make-chips>
          <Link href={hrefOf({ make: null })} className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-bold ${!make ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`}>All</Link>
          {chips.map((c) => <Link key={c.make} href={hrefOf({ make: c.make })} className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-bold uppercase ${make === c.make ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`} data-make-chip={c.make}>{c.make} · {c.count}</Link>)}
        </div>
      ) : null}
      <Card className="flex flex-col gap-3" data-parts-cars>
        <SectionLabel right={`${shown.length}`}>{tile ? tiles.find((t) => t.key === tile)?.label ?? "Cars with parts" : "Cars with parts"}{tile ? <Link href={hrefOf({ tile: null })} className="ml-3 text-xs font-bold underline underline-offset-4">Show all</Link> : null}</SectionLabel>
        {shown.length === 0 ? <Empty title={tile || q || make ? "No car for this filter" : "No open car has parts"} /> : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {shown.map((c) => (
              <CarCard
                key={c.j.id}
                data-parts-car={c.j.id}
                href={`/parts/${c.j.id}`}
                pictureUrl={c.j.vehicle?.photo_path ? thumbs.get(c.j.vehicle.photo_path) ?? null : null}
                plate={c.j.vehicle ? formatPlate(c.j.vehicle) : c.j.job_number}
                title={[c.j.vehicle?.make?.name, c.j.vehicle?.model?.name].filter(Boolean).join(" ")}
                sub={[c.j.job_number, c.j.advisor_id ? `Advisor ${nameOf.get(c.j.advisor_id) ?? ""}` : null, c.j.assigned_to ? `Tech ${nameOf.get(c.j.assigned_to) ?? ""}` : null]}
                status={{ line: c.status }}
                extra={<div data-parts-progress><PartsSteps steps={c.steps} size="bar" /></div>}
                actions={c.allDone ? <span className="text-xs font-bold text-green-text" data-parts-done>All done</span> : c.action ? <Link href={c.action.href(c.j.id)} className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-on-dark" data-parts-action={c.current?.key}>{c.action.label}</Link> : null}
              />
            ))}
          </div>
        )}
        {doneCars.length && !showDone ? <Link href={hrefOf({ done: "1" })} className="inline-flex min-h-11 items-center self-start text-sm font-bold underline underline-offset-4" data-parts-show-done>Show done ({doneCars.length})</Link> : null}
      </Card>
    </>
  );
}
