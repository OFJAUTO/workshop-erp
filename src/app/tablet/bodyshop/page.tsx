import Link from "next/link";
import { PublicShell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { DEPARTMENT_OF_SECTION, SECTION_LABELS, SECTIONS, type Section } from "@/lib/bodyshop-kinds";
import { bodyshopPeople, loadBoard, openClockingOf, sectionCars } from "@/lib/bodyshop";
import { getCurrentDevice } from "@/lib/devices";
import { formatDate } from "@/lib/format";
import { formatPlate } from "@/lib/types";
import { SectionTablet, type TabletCar, type TabletPerson } from "./SectionTablet";

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
