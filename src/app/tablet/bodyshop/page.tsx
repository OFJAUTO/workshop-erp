import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { PublicShell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { DEPARTMENT_OF_SECTION, SECTION_LABELS, SECTIONS, type Section } from "@/lib/bodyshop-kinds";
import { bodyshopPeople, loadBoard, openClockingOf, sectionCars } from "@/lib/bodyshop";
import { getCurrentDevice } from "@/lib/devices";
import { formatDate } from "@/lib/format";
import { formatPlate } from "@/lib/types";
import { SectionTablet, type TabletCar, type TabletPerson } from "./SectionTablet";
import { cutMethodsForJobs } from "@/lib/ppf-cut-data";
import { getSettings } from "@/lib/settings";
import { tintSummary } from "@/lib/tint";
import { tintLimitOf, tintSpecsForJobs } from "@/lib/tint-data";

export const dynamic = "force-dynamic";

/** The shared tablet of one bodyshop section (set at registration): its cars in due order and clocking with a PIN. */
export default async function BodyshopTabletPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const device = await getCurrentDevice();
  const { section: fromQuery } = await searchParams;
  const section = ((device?.section ?? fromQuery) as Section | undefined) ?? null;
  if (!device || !section || !SECTIONS.includes(section)) {
    return (
      <PublicShell note="Section tablet">
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="max-w-md w-full flex flex-col gap-3">
            <h1 className="text-xl font-extrabold">{device ? "This tablet has no section" : "This tablet is not registered"}</h1>
            <p className="text-sm text-muted">{device ? "The owner registers a section tablet with its section (PPF, Paint, Detailing or Strip and refit) at the registration page." : "The owner signs in here and opens the registration page."}</p>
            <Link href="/login?next=/tablet/register" className="font-semibold underline underline-offset-4">Owner: register this tablet</Link>
          </Card>
        </div>
      </PublicShell>
    );
  }
  const [board, people] = await Promise.all([loadBoard(), bodyshopPeople()]);
  const { now, coming } = sectionCars(board.cars, section);
  const sectionStaff = people.staff.filter((p) => p.section === section);
  const open = await Promise.all(sectionStaff.map(async (p) => [p.id, (await openClockingOf(p.id))?.job_id ?? null] as const));
  const openOf = new Map(open);
  const cars: TabletCar[] = [...now.map((c) => ({ c, coming: false })), ...coming.map((c) => ({ c, coming: true }))].map(({ c, coming: isComing }) => {
    const v = c.job.vehicle;
    const stage = isComing ? c.stages.find((s) => s.section === section && s.status !== "done" && s.status !== "skipped") ?? c.current : c.current;
    return {
      jobId: c.job.id,
      plate: v ? formatPlate(v) : c.job.job_number,
      title: [v?.make?.name, v?.model?.name].filter(Boolean).join(" "),
      colour: v?.colour ?? null,
      stage: stage?.label ?? "Waiting",
      due: stage?.due_date ? formatDate(stage.due_date) : null,
      tone: stage?.due_date && stage.due_date < board.today ? "red" : stage?.due_date === board.today ? "amber" : "normal",
      pictureUrl: c.pictureUrl,
      onCar: c.people.map((p) => ({ id: p.id, name: p.name, clocked: openOf.get(p.id) === c.job.id })),
      coming: isComing,
    };
  });
  const tabletPeople: TabletPerson[] = sectionStaff.map((p) => ({ id: p.id, name: p.name, photoUrl: p.photoUrl, clockedOn: openOf.get(p.id) ?? null }));
  // Parts marked ready at the desk for the section's cars: the technician receives them here with his PIN.
  const jobIds = cars.map((c) => c.jobId);
  const { data: readyRows } = jobIds.length ? await createAdminClient().from("part_items").select("id, job_id, description, received_qty, confirmed_quantity, quantity").in("job_id", jobIds).eq("is_active", true).not("ready_for_handover_at", "is", null).neq("issue_status", "confirmed") : { data: [] as { id: string; job_id: string; description: string; received_qty: number | null; confirmed_quantity: number | null; quantity: number | null }[] };
  const readyList = (readyRows ?? []) as { id: string; job_id: string; description: string; received_qty: number | null; confirmed_quantity: number | null; quantity: number | null }[];
  for (const car of cars) car.readyParts = readyList.filter((r) => r.job_id === car.jobId).map((r) => ({ id: r.id, description: r.description, quantity: Number(r.received_qty) || Number(r.confirmed_quantity ?? r.quantity) || 1 }));
  // Section 10: the PPF team sees HOW to cut, big, on every car.
  const cuts = await cutMethodsForJobs(jobIds);
  for (const car of cars) { const c = cuts.get(car.jobId); car.cut = c ? { badge: c.badge, note: c.note } : null; }
  // Section 11: the tint choice per window on every car, and the photo after fitting with the installer's PIN.
  if (section === "ppf") {
    const [specs, settings] = await Promise.all([tintSpecsForJobs(jobIds), getSettings()]);
    for (const car of cars) car.tint = tintSummary(specs.get(car.jobId) ?? null, tintLimitOf(settings));
  }
  return (
    <PublicShell note={`${SECTION_LABELS[section]} tablet`}>
      <div className="flex-1 flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-extrabold">{SECTION_LABELS[section]}</h1>
          <span className="text-sm text-muted">{cars.length} car{cars.length === 1 ? "" : "s"} · {sectionStaff.length} people ({DEPARTMENT_OF_SECTION[section]})</span>
        </div>
        <SectionTablet section={section} cars={cars} people={tabletPeople} />
      </div>
    </PublicShell>
  );
}
