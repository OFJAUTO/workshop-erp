// The bell only counts what is still open (9 November 2026), pure.
//
// Two kinds of notice:
//   - an ACTION: someone has to do something (approve an LPO, assign a car, record a reported payment ...). It counts
//     on the badge until it is read OR its task is done - and when the task is done it clears itself for EVERYONE who
//     got it (src/lib/bell-clear.ts, run by the bell itself and the hourly clean-up);
//   - INFORMATION (FYI): something happened (a scan arrived, a quotation was opened, parts were priced on a car
//     someone else handles ...). It never counts on the badge and is marked read once the bell panel has shown it.
// Cleared and read notices are archived after 30 days (they leave the panel; nothing is deleted).

export const ARCHIVE_DAYS = 30;

/** Each action type, with what makes its task done. Every other type is information. */
export const ACTION_RULES: Record<string, ActionRule> = {
  // Assignment and inspection
  job_awaiting_assignment: { open: "unassigned" },
  assignment_overdue: { open: "unassigned" },
  assignment_reminder: { open: "unassigned" },
  inspection_submitted: { open: "statuses", statuses: ["pending_inspection", "pending_road_test", "in_inspection"] },
  inspection_overdue: { open: "statuses", statuses: ["pending_inspection", "pending_road_test", "in_inspection"] },
  inspection_open: { open: "statuses", statuses: ["pending_inspection", "pending_road_test", "in_inspection"] },
  inspection_returned: { open: "statuses", statuses: ["pending_inspection", "pending_road_test", "in_inspection"] },
  inspection_change_requested: { open: "statuses", statuses: ["pending_inspection", "pending_road_test", "in_inspection", "pending_quote"] },
  scan_approval: { open: "statuses", statuses: ["pending_inspection", "pending_road_test", "in_inspection"] },
  approval_reminder: { open: "statuses", statuses: ["gate_in_pending", "pending_approval"] },
  inspection_fee_request: { open: "fee_request" },
  // Quotations
  parts_priced: { open: "statuses", statuses: ["pending_quote"] },
  quote_handed_back: { open: "quote_draft" },
  quote_owner_approval: { open: "quote_pending_owner" },
  revision_request: { open: "revision_waiting" },
  commission_approval: { open: "commission_pending" },
  // Planning, work, QC, wash, ready
  planning: { open: "planning" },
  promised_missing: { open: "promise_missing" },
  work_done: { open: "statuses", statuses: ["in_work"] },
  work_complete: { open: "statuses", statuses: ["in_work"] },
  work_sendback: { open: "statuses", statuses: ["in_work"] },
  wash: { open: "statuses", statuses: ["pending_wash"] },
  car_ready: { open: "ready_unsent" },
  handover: { open: "statuses", statuses: ["approved", "waiting_parts", "in_work"] },
  // Money
  payment_reported: { open: "report_waiting" },
  deposit_to_collect: { open: "deposit_short" },
  deposit_overdue: { open: "deposit_short" },
  lpo_waiting_deposit: { open: "deposit_short" },
  task_overdue: { open: "deposit_short" },
  // Parts and suppliers
  po_approval: { open: "po_pending" },
  supplier_invoice_missing: { open: "po_invoice_missing" },
  supplier_invoice_mismatch: { open: "po_invoice_mismatch" },
  parts_changed_after_approval: { open: "job_open" },
  lpo_check: { open: "job_open" },
  // The car itself
  plate_missing: { open: "plate_missing" },
  gate_out_followup: { open: "followup_due" },
  estimate_followup: { open: "manual" },
  // Read-only to the system: they count until the person reads them.
  owner_approval_needed: { open: "manual" },
  move_requested: { open: "manual" },
  hours_missing: { open: "manual" },
  estimate_carry_mismatch: { open: "manual" },
  scan_unmatched: { open: "manual" },
  doc_not_sent: { open: "job_open" },
  zoho_waiting: { open: "manual" },
  zoho_reconciliation: { open: "manual" },
  background_job_late: { open: "manual" },
  catalog_review: { open: "manual" },
  parts_no_home: { open: "manual" },
  sticker_prompt: { open: "manual" },
  clock_overnight: { open: "manual" },
  quote_revised_by_parts: { open: "manual" },
  appointment_missed: { open: "manual" },
  bodyshop_assessment: { open: "manual" },
  bodyshop_problem: { open: "manual" },
  advisor_question: { open: "manual" },
  purchase_return: { open: "manual" },
  estimate_price_changed: { open: "manual" },
  quote_below_cost: { open: "manual" },
  high_markup: { open: "manual" },
  low_profit: { open: "manual" },
  qty_reduced: { open: "manual" },
  batch_missing: { open: "manual" },
  lathe_unmatched: { open: "manual" },
  qty_keep_price: { open: "manual" },
  qty_after_invoice: { open: "manual" },
};

export type ActionRule = {
  /** How the task is known to be still open (see taskStillOpen). "manual" = until read. */
  open:
    | "manual" | "job_open" | "statuses" | "unassigned" | "fee_request" | "quote_draft" | "quote_pending_owner" | "revision_waiting"
    | "commission_pending" | "planning" | "promise_missing" | "ready_unsent" | "report_waiting" | "deposit_short" | "po_pending"
    | "po_invoice_missing" | "po_invoice_mismatch" | "plate_missing" | "followup_due";
  statuses?: string[];
};

export const isActionType = (type: string): boolean => Object.prototype.hasOwnProperty.call(ACTION_RULES, type);

/** The facts a task check reads (each loaded only for the notices that need it). */
export type TaskFacts = {
  job?: { status: string; is_open: boolean; assigned_to: string | null; promised_at: string | null; plan_date_confirmed_at: string | null; ready_sent_at: string | null; inspection_fee_request_aed: number | null; followup_due_at: string | null; followup_done_at: string | null } | null;
  quote?: { status: string; revision_requested_at: string | null; revision_allowed_at: string | null; revision_declined_at: string | null; commission_status: string | null } | null;
  po?: { status: string; supplier_invoice_status: string | null; invoice_check: string | null } | null;
  report?: { status: string } | null;
  depositShort?: boolean;
  plateMissing?: boolean;
  promiseMissingForStaff?: boolean;
};

/** True while the task behind an action notice still needs doing; false once it is done (the notice clears). */
export function taskStillOpen(type: string, f: TaskFacts): boolean {
  const rule = ACTION_RULES[type];
  if (!rule) return false;
  const j = f.job;
  // Any car task is done once the car has left.
  if (j && (!j.is_open || j.status === "closed")) return false;
  switch (rule.open) {
    case "manual":
      return true;
    case "job_open":
      return !j || j.is_open;
    case "statuses":
      return !j || (rule.statuses ?? []).includes(j.status);
    case "unassigned":
      return !j || (!j.assigned_to && ["pending_inspection", "pending_road_test"].includes(j.status));
    case "fee_request":
      return !j || j.inspection_fee_request_aed != null;
    case "quote_draft":
      return !f.quote || ["draft", "pending_owner"].includes(f.quote.status);
    case "quote_pending_owner":
      return !f.quote || f.quote.status === "pending_owner";
    case "revision_waiting":
      return !f.quote || (!!f.quote.revision_requested_at && !f.quote.revision_allowed_at && !f.quote.revision_declined_at);
    case "commission_pending":
      return !f.quote || f.quote.commission_status === "pending";
    case "planning":
      return !j || (["approved", "waiting_parts", "in_work"].includes(j.status) && !j.plan_date_confirmed_at);
    case "promise_missing":
      return f.promiseMissingForStaff !== false;
    case "ready_unsent":
      return !j || (j.status === "ready" && !j.ready_sent_at);
    case "report_waiting":
      return !f.report || f.report.status === "waiting" || f.report.status === "queried";
    case "deposit_short":
      return f.depositShort !== false;
    case "po_pending":
      return !f.po || f.po.status === "pending_approval";
    case "po_invoice_missing":
      return !f.po || f.po.supplier_invoice_status === "to_follow";
    case "po_invoice_mismatch":
      return !f.po || f.po.invoice_check === "mismatch";
    case "plate_missing":
      return f.plateMissing !== false;
    case "followup_due":
      return !j || (!!j.followup_due_at && !j.followup_done_at);
  }
}

/** The id of a record named in a notice's address: /parts/orders/<id>, pay-report=<id>, /quote/<id>, /estimates/<id>. */
export function hrefId(href: string | null | undefined, kind: "po" | "report" | "quote"): string | null {
  if (!href) return null;
  const re = kind === "po" ? /\/parts\/orders\/([0-9a-f-]{36})/ : kind === "report" ? /pay-report=([0-9a-f-]{36})/ : /\/(?:quote|estimates)\/([0-9a-f-]{36})/;
  return href.match(re)?.[1] ?? null;
}
