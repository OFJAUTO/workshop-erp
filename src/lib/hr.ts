import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireStaff, type CurrentStaff } from "./auth";
import { HR_DOC_KINDS, daysLeft, expiresWithin, hrStatusOf, isSupportRole, kindOf, mayOpenHr, reminderDue, reminderStage, type HrDocBrief, type HrStatus } from "./hr-rules";
import { ROLE_LABELS, type RoleId } from "./roles";
import { placeWords, roleTitleOf } from "./teams";
import { notifyStaff } from "./notifications";
import { passkeyCount } from "./passkey-server";
import { schemaReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";

/**
 * HR (11 November 2026, Section 15). Server side: who may open it (the owner and the head accountant, with a phone
 * sign-in set up on their account, never while viewing or acting as someone else), the people (everyone on the Team
 * page plus people with no ERP login), their documents, the log of every view and download, and the reminders.
 * Every table is server-only: the pages read through the admin client after these checks.
 */
export const HR_BUCKET = "hr-files";
export const hrReady = () => schemaReady("hr_people", "id, staff_id, status");

export type HrGate = { staff: CurrentStaff; ok: true } | { staff: CurrentStaff; ok: false; why: "passkey" | "viewing" | "not_ready" };

/** THE gate: not the owner or head accountant = no page at all; the rest say what is missing. */
export async function hrGate(): Promise<HrGate> {
  const staff = await requireStaff();
  if (!mayOpenHr(staff)) notFound();
  if (staff.viewingAs || staff.actingAs) return { staff, ok: false, why: "viewing" };
  if (!(await hrReady())) return { staff, ok: false, why: "not_ready" };
  if ((await passkeyCount(staff.id).catch(() => 0)) === 0) return { staff, ok: false, why: "passkey" };
  return { staff, ok: true };
}

/** The same check for a route or an action: the person, or null. */
export async function hrActor(): Promise<CurrentStaff | null> {
  const g = await hrGate();
  return g.ok ? g.staff : null;
}

export async function logHr(by: string, action: string, ref: { personId?: string | null; documentId?: string | null; detail?: string | null }) {
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await createAdminClient().from("hr_access_log").insert({ person_id: ref.personId ?? null, document_id: ref.documentId ?? null, action, detail: ref.detail ?? null, by_staff_id: by, user_agent: ua });
}

export type HrPersonRow = {
  id: string;
  staff_id: string | null;
  passport_name: string;
  role_title: string | null;
  department: string | null;
  joining_date: string | null;
  phone: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  contract_end: string | null;
  probation_end: string | null;
  status: "active" | "left";
  left_at: string | null;
  left_reason: string | null;
};
export const PERSON_COLS = "id, staff_id, passport_name, role_title, department, joining_date, phone, emergency_name, emergency_phone, contract_end, probation_end, status, left_at, left_reason";
export type HrDocRow = { id: string; person_id: string; kind: string; doc_number: string | null; expires_on: string | null; storage_path: string; file_name: string | null; content_type: string | null; created_at: string; replaced_at: string | null; archived_at: string | null; reminded_stage: number | null };
export const DOC_COLS = "id, person_id, kind, doc_number, expires_on, storage_path, file_name, content_type, created_at, replaced_at, archived_at, reminded_stage";

/** Everyone: each staff member (with their HR row when one exists) and the people with no login. */
export async function loadHrList(): Promise<{ key: string; personId: string | null; staffId: string | null; name: string; role: string; department: string | null; login: boolean; status: "active" | "left"; staffActive: boolean; expiring: number; expired: number }[]> {
  const admin = createAdminClient();
  const today = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
  const [{ data: staff }, { data: people }, { data: docs }, { data: depts }] = await Promise.all([
    admin.from("staff").select("id, full_name, display_name, role_id, department_id, is_active").order("full_name"),
    admin.from("hr_people").select(PERSON_COLS).eq("is_active", true),
    admin.from("hr_documents").select("person_id, kind, expires_on").eq("is_active", true).is("replaced_at", null).is("archived_at", null),
    admin.from("departments").select("id, label"),
  ]);
  const deptName = new Map(((depts ?? []) as { id: string; label: string }[]).map((d) => [d.id, d.label]));
  const byStaff = new Map(((people ?? []) as HrPersonRow[]).filter((p) => p.staff_id).map((p) => [p.staff_id as string, p]));
  const counts = new Map<string, { expiring: number; expired: number }>();
  for (const d of (docs ?? []) as { person_id: string; kind: string; expires_on: string | null }[]) {
    const st = reminderStage(d.kind, d.expires_on, today);
    if (st === null) continue;
    const c = counts.get(d.person_id) ?? { expiring: 0, expired: 0 };
    if (st === 0) c.expired++;
    else c.expiring++;
    counts.set(d.person_id, c);
  }
  const rows: { key: string; personId: string | null; staffId: string | null; name: string; role: string; department: string | null; login: boolean; status: "active" | "left"; staffActive: boolean; expiring: number; expired: number }[] = ((staff ?? []) as { id: string; full_name: string; display_name: string; role_id: string; department_id: string | null; is_active: boolean }[]).map((s) => {
    const p = byStaff.get(s.id) ?? null;
    const c = p ? counts.get(p.id) : null;
    return { key: `s:${s.id}`, personId: p?.id ?? null, staffId: s.id, name: p?.passport_name ?? s.full_name, role: p?.role_title ?? s.role_id.replace(/_/g, " "), department: p?.department ?? (s.department_id ? deptName.get(s.department_id) ?? null : null), login: true, status: (p?.status ?? "active") as "active" | "left", staffActive: s.is_active, expiring: c?.expiring ?? 0, expired: c?.expired ?? 0 };
  });
  for (const p of ((people ?? []) as HrPersonRow[]).filter((x) => !x.staff_id)) {
    const c = counts.get(p.id);
    rows.push({ key: `p:${p.id}`, personId: p.id, staffId: null, name: p.passport_name, role: p.role_title ?? "", department: p.department, login: false, status: p.status, staffActive: false, expiring: c?.expiring ?? 0, expired: c?.expired ?? 0 });
  }
  return rows.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "active" ? -1 : 1));
}

/** A staff member's HR row, made the first time it is opened (their name from the Team page). */
export async function ensureHrPerson(staffId: string, by: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: have } = await admin.from("hr_people").select("id").eq("staff_id", staffId).maybeSingle();
  if (have?.id) return have.id as string;
  const { data: s } = await admin.from("staff").select("full_name, role_id").eq("id", staffId).maybeSingle();
  if (!s) return null;
  const { data: made, error } = await admin.from("hr_people").insert({ staff_id: staffId, passport_name: s.full_name, role_title: String(s.role_id).replace(/_/g, " "), created_by: by, updated_by: by }).select("id").single();
  if (error) {
    const { data: again } = await admin.from("hr_people").select("id").eq("staff_id", staffId).maybeSingle();
    return (again?.id as string | undefined) ?? null;
  }
  return made.id as string;
}

export async function loadHrPerson(id: string): Promise<{ person: HrPersonRow; docs: HrDocRow[]; log: { action: string; detail: string | null; by: string | null; at: string }[]; staff: { id: string; is_active: boolean; display_name: string } | null } | null> {
  const admin = createAdminClient();
  const { data: person } = await admin.from("hr_people").select(PERSON_COLS).eq("id", id).eq("is_active", true).maybeSingle();
  if (!person) return null;
  const p = person as HrPersonRow;
  const [{ data: docs }, { data: log }, { data: staff }] = await Promise.all([
    admin.from("hr_documents").select(DOC_COLS + ((await hrOtherReady()) ? ", other_label" : "")).eq("person_id", id).eq("is_active", true).order("created_at", { ascending: false }),
    admin.from("hr_access_log").select("action, detail, by_staff_id, at").eq("person_id", id).order("at", { ascending: false }).limit(40),
    p.staff_id ? admin.from("staff").select("id, is_active, display_name").eq("id", p.staff_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const byIds = Array.from(new Set(((log ?? []) as { by_staff_id: string | null }[]).map((l) => l.by_staff_id).filter((x): x is string => !!x)));
  const { data: who } = byIds.length ? await admin.from("staff").select("id, display_name").in("id", byIds) : { data: [] };
  const nameOf = new Map(((who ?? []) as { id: string; display_name: string }[]).map((w) => [w.id, w.display_name]));
  return {
    person: p,
    docs: (docs ?? []) as unknown as HrDocRow[],
    log: ((log ?? []) as { action: string; detail: string | null; by_staff_id: string | null; at: string }[]).map((l) => ({ action: l.action, detail: l.detail, by: l.by_staff_id ? (nameOf.get(l.by_staff_id) ?? null) : null, at: l.at })),
    staff: (staff as { id: string; is_active: boolean; display_name: string } | null) ?? null,
  };
}

/** The people who hear about HR: the owner and the head accountants. */
export async function hrRecipients(): Promise<string[]> {
  const { data } = await createAdminClient().from("staff").select("id, role_id, is_head_accountant").eq("is_active", true).in("role_id", ["owner", "accounts"]);
  return ((data ?? []) as { id: string; role_id: string; is_head_accountant: boolean | null }[]).filter((s) => mayOpenHr(s)).map((s) => s.id);
}

/** Documents of active people that need a look now (expiring within their warning, or expired). */
export async function hrExpiring(): Promise<{ id: string; personId: string; name: string; kind: string; expiresOn: string; stage: number; remindedStage: number | null }[]> {
  if (!(await hrReady())) return [];
  const admin = createAdminClient();
  const today = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + 61 * 86_400_000).toISOString().slice(0, 10);
  const { data: docs } = await admin.from("hr_documents").select("id, person_id, kind, expires_on, reminded_stage").eq("is_active", true).is("replaced_at", null).is("archived_at", null).not("expires_on", "is", null).lte("expires_on", horizon);
  const list = (docs ?? []) as { id: string; person_id: string; kind: string; expires_on: string; reminded_stage: number | null }[];
  if (!list.length) return [];
  const { data: people } = await admin.from("hr_people").select("id, passport_name, status").in("id", Array.from(new Set(list.map((d) => d.person_id))));
  const pOf = new Map(((people ?? []) as { id: string; passport_name: string; status: string }[]).map((p) => [p.id, p]));
  const out = [];
  for (const d of list) {
    const p = pOf.get(d.person_id);
    if (!p || p.status !== "active") continue;
    const st = reminderStage(d.kind, d.expires_on, today);
    if (st === null) continue;
    out.push({ id: d.id, personId: d.person_id, name: p.passport_name, kind: d.kind, expiresOn: d.expires_on, stage: st, remindedStage: d.reminded_stage });
  }
  return out.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}

/** The hourly reminders: one bell per document per stage (first warning, 14, 7, expired), to the owner and the head accountants only. */
export async function hrRemindersHourly(): Promise<number> {
  const due = (await hrExpiring()).filter((d) => reminderDue(d.stage, d.remindedStage));
  if (!due.length) return 0;
  const to = await hrRecipients();
  const admin = createAdminClient();
  for (const d of due) {
    const label = kindOf(d.kind)?.label ?? d.kind;
    const left = daysLeft(d.expiresOn, new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10));
    const title = d.stage === 0 ? `${label} EXPIRED: ${d.name}` : `${label} expires in ${left} day${left === 1 ? "" : "s"}: ${d.name}`;
    await notifyStaff(to, { type: "hr_document_expiring", title, body: `Expiry ${d.expiresOn}. Upload the new one on HR.`, href: `/team/hr/${d.personId}` });
    await admin.from("hr_documents").update({ reminded_stage: d.stage }).eq("id", d.id);
  }
  return due.length;
}

export const HR_DOC_LABELS = Object.fromEntries(HR_DOC_KINDS.map((k) => [k.kind, k.label])) as Record<string, string>;

/* ---------------- The HR list (13 November 2026, Section 13) ---------------- */
export type HrBoardRow = {
  key: string;
  personId: string | null;
  staffId: string | null;
  name: string;
  role: string;
  phone: string | null;
  group: string;
  photoUrl: string | null;
  login: boolean;
  status: "active" | "left";
  docs: HrDocBrief[];
  line: HrStatus;
  probation: boolean;
  expiring60: boolean;
};

/**
 * Everyone on the HR list, with what the page filters, groups and sorts by: role and department/team read from the
 * Team record for staff (never typed again), the status line from the documents, probation, a photo (the staff photo,
 * else the HR photo). Groups: "Mechanical · Technicians", "Bodyshop · Painting", "Office · Accounts", "Support staff".
 */
export async function loadHrBoard(): Promise<HrBoardRow[]> {
  const admin = createAdminClient();
  const today = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
  const [{ data: staff }, { data: people }, { data: docs }] = await Promise.all([
    admin.from("staff").select("id, full_name, role_id, department_id, team, photo_path, is_active").order("full_name"),
    admin.from("hr_people").select(PERSON_COLS).eq("is_active", true),
    admin.from("hr_documents").select("person_id, kind, expires_on, storage_path, content_type, created_at").eq("is_active", true).is("replaced_at", null).is("archived_at", null).order("created_at", { ascending: false }),
  ]);
  const docRows = (docs ?? []) as { person_id: string; kind: string; expires_on: string | null; storage_path: string; content_type: string | null }[];
  const docsOf = new Map<string, HrDocBrief[]>();
  const hrPhoto = new Map<string, string>();
  for (const d of docRows) {
    docsOf.set(d.person_id, [...(docsOf.get(d.person_id) ?? []), { kind: d.kind, expires_on: d.expires_on }]);
    if (d.kind === "photo" && (d.content_type ?? "").startsWith("image/") && !hrPhoto.has(d.person_id)) hrPhoto.set(d.person_id, d.storage_path);
  }
  const staffRows = (staff ?? []) as { id: string; full_name: string; role_id: string; department_id: string | null; team: string | null; photo_path: string | null; is_active: boolean }[];
  const staffPhotos = staffRows.map((s) => s.photo_path).filter((p): p is string => !!p);
  const [sp, hp] = await Promise.all([
    staffPhotos.length ? admin.storage.from("staff-photos").createSignedUrls(staffPhotos, 3600) : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
    hrPhoto.size ? admin.storage.from(HR_BUCKET).createSignedUrls(Array.from(hrPhoto.values()), 600) : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
  ]);
  const urlOf = new Map([...(sp.data ?? []), ...(hp.data ?? [])].map((x) => [x.path ?? "", x.signedUrl]));
  const persons = (people ?? []) as HrPersonRow[];
  const byStaff = new Map(persons.filter((p) => p.staff_id).map((p) => [p.staff_id as string, p]));
  const row = (base: Omit<HrBoardRow, "line" | "probation" | "expiring60" | "docs">, p: HrPersonRow | null): HrBoardRow => {
    const d = p ? (docsOf.get(p.id) ?? []) : [];
    return { ...base, docs: d, line: hrStatusOf(d, today), probation: !!p?.probation_end && p.probation_end >= today, expiring60: expiresWithin(d, today) };
  };
  const rows: HrBoardRow[] = staffRows.map((s) => {
    const p = byStaff.get(s.id) ?? null;
    const role = roleTitleOf(s, ROLE_LABELS[s.role_id as RoleId] ?? s.role_id);
    const photo = s.photo_path ? urlOf.get(s.photo_path) : p && hrPhoto.get(p.id) ? urlOf.get(hrPhoto.get(p.id) as string) : null;
    return row({ key: `s:${s.id}`, personId: p?.id ?? null, staffId: s.id, name: p?.passport_name ?? s.full_name, role, phone: p?.phone ?? null, group: placeWords(s) || "No department", photoUrl: photo ?? null, login: true, status: (p?.status ?? "active") as "active" | "left" }, p);
  });
  for (const p of persons.filter((x) => !x.staff_id)) {
    const photo = hrPhoto.get(p.id);
    rows.push(row({ key: `p:${p.id}`, personId: p.id, staffId: null, name: p.passport_name, role: p.role_title ?? "", phone: p.phone, group: isSupportRole(p.role_title) ? "Support staff" : p.department || "No department", photoUrl: photo ? (urlOf.get(photo) ?? null) : null, login: false, status: p.status }, p));
  }
  return rows;
}

/** "Other document" (13 November 2026, Section 13) waits for its migration: the kind and its own name. */
export const hrOtherReady = () => schemaReady("hr_documents", "other_label");
