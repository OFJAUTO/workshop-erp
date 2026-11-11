/**
 * THE department of a shared tablet and of a person (11 November 2026, Section 8). Pure.
 * A person's department (staff.department_id) falls on one side: Workshop (mechanical, office) or Bodyshop (bodyshop,
 * paint, PPF and tint, detailing). A tablet is Workshop, Bodyshop or Both; empty = not set (everyone, as before).
 */
export const DEVICE_DEPARTMENTS = [
  { key: "workshop", label: "Workshop" },
  { key: "bodyshop", label: "Bodyshop" },
  { key: "both", label: "Both" },
] as const;
export type DeviceDepartment = (typeof DEVICE_DEPARTMENTS)[number]["key"];

export const isDeviceDepartment = (v: unknown): v is DeviceDepartment => DEVICE_DEPARTMENTS.some((d) => d.key === v);

export const deviceDepartmentWords = (d: string | null | undefined) => (isDeviceDepartment(d) ? DEVICE_DEPARTMENTS.find((x) => x.key === d)!.label : "Not set");

/** The side of a person's department: workshop or bodyshop (null = no department). */
export function sideOfPerson(departmentId: string | null | undefined): "workshop" | "bodyshop" | null {
  if (!departmentId) return null;
  return ["bodyshop", "paint", "ppf_tint", "detailing"].includes(departmentId) ? "bodyshop" : "workshop";
}

/** Is this person one of the tablet's own department (shown first; the rest behind "Someone else?")? */
export function onTabletDepartment(tablet: string | null | undefined, personDepartment: string | null | undefined): boolean {
  if (!isDeviceDepartment(tablet) || tablet === "both") return true;
  return sideOfPerson(personDepartment) === tablet;
}

/** The job list's department filter a tablet opens on (null = all cars). */
export function jobDeptOfTablet(tablet: string | null | undefined): "mechanical" | "bodyshop" | null {
  return tablet === "workshop" ? "mechanical" : tablet === "bodyshop" ? "bodyshop" : null;
}
