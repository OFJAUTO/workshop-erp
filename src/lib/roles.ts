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
/** Office roles: everyone except gate-in and technicians (technicians see My jobs and the Workshop list only). */
export const OFFICE: RoleId[] = ALL_ROLES.filter((r) => r !== "gate_in" && r !== "technician");
/** Office roles minus the QC inspector, who sees road tests, approved reports and the workshop list only. */
export const OFFICE_NO_QC: RoleId[] = OFFICE.filter((r) => r !== "qc_inspector");

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
 * The owner can do everything, always (see `can`).
 */
export const PERMISSIONS = {
  manageTeam: ["owner"],
  viewTablets: ["owner", "workshop_manager"],
  manageTablets: ["owner"],
  manageSettings: ["owner"],
  viewAudit: ["owner"],
  viewCustomers: ["owner", "service_advisor", "parts", "accounts"],
  editCustomers: ["owner", "service_advisor"],
  viewVehicles: OFFICE_NO_QC,
  editVehicles: ["owner", "service_advisor"],
  gateIn: ["owner", "service_advisor", "gate_in"],
  viewPartCosts: ["owner", "accounts", "service_advisor", "parts"],
  viewTechnicianCostRate: ["owner", "accounts"],
  viewProfitPanel: ["owner", "accounts", "service_advisor"],
  viewJobs: OFFICE_NO_QC,
  viewOwnJobs: ["owner", "technician"],
  viewWorkshopList: ["owner", "technician", "workshop_manager", "qc_inspector", "service_advisor", "parts", "accounts"],
  editGateIn: ["owner", "service_advisor", "gate_in"],
  sendApproval: ["owner", "service_advisor"],
  assignJobs: ["owner", "workshop_manager"],
  moveJobs: ["owner"],
  requestMove: ["owner", "workshop_manager", "service_advisor"],
  noteToManager: ["owner", "service_advisor"],
  setPriority: ["owner", "workshop_manager", "service_advisor", "gate_in"],
  gateOut: ["owner", "service_advisor", "accounts"],
  overrideKeys: ["owner", "workshop_manager"],
  approveRelease: ["owner", "accounts"],
  viewDashboard: ["owner", "workshop_manager", "service_advisor", "accounts", "parts"],
  viewCalendar: OFFICE_NO_QC,
  bookAppointments: ["owner", "service_advisor"],
  approveInspections: ["owner", "workshop_manager"],
  decideInspectionChanges: ["owner"],
  roadTest: ["owner", "qc_inspector"],
  sendReport: ["owner", "service_advisor"],
  viewOverrides: ["owner"],
  viewAs: ["owner"],
} as const satisfies Record<string, readonly RoleId[]>;

export type Permission = keyof typeof PERMISSIONS;

/** The owner sees everything and has every action; other roles only what their list says. */
export function can(role: RoleId, permission: Permission): boolean {
  if (role === "owner") return true;
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
  workshop_manager: ["Assign technicians, review inspection reports, see cars in the workshop"],
  service_advisor: ["Add and edit customers, contacts and cars"],
  gate_in: ["Gate cars in with photos and video; nothing else"],
  technician: ["See the cars assigned to you and the workshop list"],
  parts: ["See customers and cars"],
  qc_inspector: ["Road tests, approved inspection reports (view only) and the workshop list"],
  accounts: ["See customers and cars"],
};
