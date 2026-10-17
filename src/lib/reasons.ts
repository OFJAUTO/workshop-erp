/**
 * One-tap reasons wherever the system asks "why" (evening list of 12 October 2026, item 7). Each place has its own
 * list, editable in Settings (`reason_presets`); tapping a chip writes it into the box, several allowed, typing
 * always possible. The manager's hours change has two lists: one for raising, one for lowering.
 */
export const REASON_CONTEXTS = [
  { key: "hours_raise", label: "Manager raises the estimated hours" },
  { key: "hours_lower", label: "Manager lowers the estimated hours" },
  { key: "pause", label: "Technician pauses a job" },
  { key: "leave_job", label: "Technician leaves a job" },
  { key: "send_back", label: "Report sent back to the technician" },
  { key: "override_keys", label: "Keys override at gate-out" },
  { key: "release", label: "Car released before payment or QC" },
  { key: "deposit_override", label: "LPO approved without the deposit" },
  { key: "revise_after_approval", label: "Revising a quotation the customer approved" },
  { key: "part_discount", label: "Owner's discount on a part" },
  { key: "parts_delay", label: "A part's expected date moved" },
  { key: "void_payment", label: "Receipt voided" },
  { key: "remove_part", label: "Part removed: not needed" },
  { key: "special_move", label: "Special move past a gate" },
  { key: "credit_note", label: "Credit note" },
] as const;
export type ReasonContext = (typeof REASON_CONTEXTS)[number]["key"];

export const DEFAULT_REASONS: Record<ReasonContext, string[]> = {
  hours_raise: ["Technician underestimated", "Seized or rusted parts likely", "Engine or transmission removal needed", "Difficult access on this model", "Special tool or procedure needed", "Coding or programming needed", "Extra diagnosis time needed", "Road test and adjustment after repair"],
  hours_lower: ["Technician overestimated", "Jobs overlap (shared labour)", "Done often on this model", "Parts already removed for another job"],
  pause: ["Waiting for parts", "Waiting for the manager", "Another job", "Break", "Tools or lift busy"],
  leave_job: ["Moved to another car by the manager", "End of shift", "Waiting for parts for days", "Another technician takes over", "Not my department"],
  send_back: ["Photos missing", "Remark unclear", "Measurement missing or wrong", "Wrong item marked", "Parts list incomplete", "Dangerous item needs a reason"],
  override_keys: ["Customer kept the spare key", "Key found later and returned", "Key handed to the customer at gate-in", "Owner approved by phone"],
  release: ["Owner approved by phone", "Regular customer, pays later", "Company account, invoice to follow", "Car needed back for an emergency"],
  deposit_override: ["Regular customer", "Deposit paid in cash, not recorded yet", "Owner's decision", "Small order, deposit not worth it"],
  revise_after_approval: ["Customer asked for more work", "Part price changed", "Part not available, alternative needed", "Wrong quantity on the quotation", "Labour hours wrong", "Customer wants an item removed"],
  part_discount: ["Loyal customer", "Price match", "Goodwill", "Comeback repair", "Owner's decision"],
  parts_delay: ["Supplier delayed", "Back order at the supplier", "Wrong part came, reordered", "Customs or shipping", "Supplier closed"],
  void_payment: ["Duplicate entry", "Wrong amount", "Wrong method", "Wrong invoice", "Customer paid twice, refunded"],
  remove_part: ["Duplicate", "Already covered by another part", "Technician mistake", "Not required for this job", "Other"],
  special_move: ["Customer collects today", "Owner's decision", "Work done outside the system", "Waiting is pointless for this car"],
  credit_note: ["Wrong amount invoiced", "Work not done", "Goodwill", "Customer complaint", "Duplicate invoice"],
};

/** The reasons of one place from Settings, the defaults when nothing was saved. */
export function reasonsFor(settings: { reason_presets?: unknown }, context: ReasonContext): string[] {
  const raw = (settings.reason_presets ?? {}) as Partial<Record<ReasonContext, unknown>>;
  const list = raw[context];
  if (Array.isArray(list) && list.length) return list.map((s) => String(s).trim()).filter(Boolean);
  return DEFAULT_REASONS[context];
}
