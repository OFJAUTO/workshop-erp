export type RoleId =
  | "owner"
  | "workshop_manager"
  | "service_advisor"
  | "gate_in"
  | "technician"
  | "parts"
  | "qc_inspector"
  | "accounts";

export const ROLE_LABELS: Record<RoleId, string> = {
  owner: "Owner",
  workshop_manager: "Workshop manager",
  service_advisor: "Service advisor",
  gate_in: "Gate-in",
  technician: "Technician",
  parts: "Parts",
  qc_inspector: "QC inspector",
  accounts: "Accounts",
};

export const ALL_ROLES = Object.keys(ROLE_LABELS) as RoleId[];

/** Everyone except the gate-in role, which sees the gate-in screen only. */
export const OFFICE_AND_WORKSHOP: RoleId[] = ALL_ROLES.filter((r) => r !== "gate_in");

/** Roles whose logins are kept short because they see money. */
export const SENSITIVE_ROLES: RoleId[] = ["owner", "accounts"];

export type DepartmentId = "mechanical" | "bodyshop" | "paint" | "ppf_tint" | "office";

export const DEPARTMENT_LABELS: Record<DepartmentId, string> = {
  mechanical: "Mechanical",
  bodyshop: "Bodyshop",
  paint: "Paint",
  ppf_tint: "PPF and tint",
  office: "Office",
};

/**
 * What each role may do. These mirror the database rules; the database is
 * the final word, this list only decides what the screens show.
 */
export const PERMISSIONS = {
  manageTeam: ["owner"],
  viewTablets: ["owner", "workshop_manager"],
  manageTablets: ["owner"],
  manageSettings: ["owner"],
  viewAudit: ["owner"],
  viewCustomers: ["owner", "workshop_manager", "service_advisor", "parts", "qc_inspector", "accounts"],
  editCustomers: ["owner", "workshop_manager", "service_advisor"],
  viewVehicles: OFFICE_AND_WORKSHOP,
  editVehicles: ["owner", "workshop_manager", "service_advisor"],
  gateIn: ["owner", "workshop_manager", "service_advisor", "gate_in"],
  viewPartCosts: ["owner", "accounts", "service_advisor", "parts"],
  viewTechnicianCostRate: ["owner", "accounts"],
  viewProfitPanel: ["owner", "accounts", "service_advisor"],
  viewJobs: OFFICE_AND_WORKSHOP,
  editGateIn: ["owner", "workshop_manager", "service_advisor", "gate_in"],
  sendApproval: ["owner", "workshop_manager", "service_advisor"],
  assignJobs: ["owner", "workshop_manager"],
  moveJobs: ["owner", "workshop_manager"],
  setPriority: ["owner", "workshop_manager", "service_advisor", "gate_in"],
  gateOut: ["owner", "workshop_manager", "service_advisor", "accounts"],
  overrideKeys: ["owner", "workshop_manager"],
  approveRelease: ["owner", "accounts"],
  viewDashboard: ["owner", "workshop_manager", "service_advisor", "accounts", "parts", "qc_inspector"],
  viewCalendar: OFFICE_AND_WORKSHOP,
  approveInspections: ["owner", "workshop_manager"],
  decideInspectionChanges: ["owner"],
  bookAppointments: ["owner", "service_advisor"],
} as const satisfies Record<string, readonly RoleId[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: RoleId, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly RoleId[]).includes(role);
}

/** One line per role describing what the role can do in this phase. */
export const ROLE_PHASE1_SUMMARY: Record<RoleId, string[]> = {
  owner: [
    "Add, edit and disable staff, reset PINs, upload profile photos",
    "Register and remove shared tablets",
    "Add and edit customers, contacts and cars",
    "Change settings and read the change log",
  ],
  workshop_manager: ["Add and edit customers, contacts and cars", "See registered tablets"],
  service_advisor: ["Add and edit customers, contacts and cars"],
  gate_in: ["Gate cars in with photos and video; nothing else"],
  technician: ["See cars (plate, model, photos) and VIP handling notes"],
  parts: ["See customers and cars"],
  qc_inspector: ["See customers and cars"],
  accounts: ["See customers and cars"],
};
