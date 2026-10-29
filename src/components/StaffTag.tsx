import { staffTagWords } from "@/lib/customer-view";

/** THE staff tag on a car (29 October 2026): "Tech · Moayad +1" next to the advisor's tag; the names in its title. */
export function StaffTag({ names }: { names: string[] }) {
  const words = staffTagWords(names);
  if (!words) return null;
  return (
    <span className="inline-flex max-w-full items-center rounded-full border border-line-strong bg-white px-2.5 py-1 text-[11px] font-bold" title={names.join(", ")} data-staff-tag>
      {words}
    </span>
  );
}
