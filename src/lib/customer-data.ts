import "server-only";
import { createAdminClient } from "./supabase/admin";
import { can, type RoleId } from "./roles";
import { arrivedWords, contactWords, customerName } from "./customer-view";

/**
 * THE source for a job's customer on screen (29 October 2026, batch 2 section 1): the customer on the gate-in, who
 * approves the job card. Read with the admin client and handed out ONLY to the owner, advisors and accounts
 * (`seesCustomers`); everyone else gets an empty map, so no customer word ever leaves the server for their screens.
 */
import type { JobCustomer } from "./customer-view";
export type { JobCustomer };

/** The ONE rule: may this person see customers at all? Owner, advisors, accounts. */
export function seesCustomers(role: string | null | undefined): boolean {
  return !!role && can(role as RoleId, "viewCustomers");
}

export async function jobCustomersFor(role: string | null | undefined, jobIds: (string | null | undefined)[]): Promise<Map<string, JobCustomer>> {
  const out = new Map<string, JobCustomer>();
  const ids = [...new Set(jobIds.filter((x): x is string => !!x))];
  if (!seesCustomers(role) || !ids.length) return out;
  const admin = createAdminClient();
  const [{ data: jobs }, { data: gateIns }] = await Promise.all([
    admin.from("jobs").select("id, customer_id").in("id", ids),
    admin.from("gate_ins").select("job_id, arrived_by").in("job_id", ids),
  ]);
  const customerIds = [...new Set((jobs ?? []).map((j) => j.customer_id as string | null).filter((x): x is string => !!x))];
  if (!customerIds.length) return out;
  const [{ data: customers }, { data: contacts }] = await Promise.all([
    admin.from("customers").select("id, customer_number, full_name, company_name").in("id", customerIds),
    admin.from("customer_contacts").select("customer_id, name, can_approve, created_at").in("customer_id", customerIds).eq("is_active", true).order("can_approve", { ascending: false }).order("created_at"),
  ]);
  const byId = new Map((customers ?? []).map((c) => [c.id as string, c]));
  const firstContact = new Map<string, string>();
  for (const c of contacts ?? []) if (!firstContact.has(c.customer_id as string) && c.name) firstContact.set(c.customer_id as string, c.name as string);
  const arrivedOf = new Map((gateIns ?? []).map((g) => [g.job_id as string, g.arrived_by as string | null]));
  for (const j of jobs ?? []) {
    const c = j.customer_id ? byId.get(j.customer_id as string) : null;
    if (!c) continue;
    const company = (c.company_name as string | null)?.trim() || null;
    out.set(j.id as string, {
      customerId: c.id as string,
      number: (c.customer_number as string | null) ?? null,
      name: customerName({ full_name: c.full_name as string | null, company_name: company }),
      isCompany: !!company,
      contact: contactWords(company, firstContact.get(c.id as string) ?? null),
      arrived: arrivedWords(arrivedOf.get(j.id as string)),
    });
  }
  return out;
}

/**
 * The people on each car (technicians on the job, the assigned technician, the bodyshop team): their first names for
 * the staff tag. Not customer data, so every role gets it.
 */
export async function jobPeopleFor(jobIds: (string | null | undefined)[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(jobIds.filter((x): x is string => !!x))];
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const admin = createAdminClient();
  const [{ data: jobs }, { data: techs }, { data: body }] = await Promise.all([
    admin.from("jobs").select("id, assigned_to").in("id", ids),
    admin.from("job_technicians").select("job_id, staff_id, added_at").in("job_id", ids).eq("is_active", true).is("left_at", null).order("added_at"),
    admin.from("bodyshop_assignments").select("job_id, staff_id, assigned_at").in("job_id", ids).eq("is_active", true).is("removed_at", null).order("assigned_at"),
  ]);
  const order = new Map<string, string[]>();
  const add = (jobId: string, staffId: string | null) => {
    if (!staffId) return;
    const list = order.get(jobId) ?? [];
    if (!list.includes(staffId)) list.push(staffId);
    order.set(jobId, list);
  };
  for (const j of jobs ?? []) add(j.id as string, j.assigned_to as string | null);
  for (const t of techs ?? []) add(t.job_id as string, t.staff_id as string);
  for (const b of body ?? []) add(b.job_id as string, b.staff_id as string);
  const staffIds = [...new Set([...order.values()].flat())];
  if (!staffIds.length) return out;
  const { data: staff } = await admin.from("staff").select("id, display_name").in("id", staffIds);
  const nameOf = new Map((staff ?? []).map((s) => [s.id as string, String(s.display_name ?? "").split(" ")[0]]));
  for (const [jobId, list] of order) out.set(jobId, list.map((id) => nameOf.get(id) ?? "").filter(Boolean));
  return out;
}
