import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { arrivedMessageFor, backOrderChoices } from "@/lib/back-orders";
import { mayDecideBackOrder, mayRequestBackOrder } from "@/lib/back-order-rules";
import { backOrderAction } from "@/app/(app)/jobs/back-order-actions";
import { BackOrderBox } from "./BackOrderBox";
import { Card, SectionLabel } from "./ui";

/** The server side of THE back-order box: the parts not handed over, the approved labour, the back orders of this job. */
export async function BackOrderSection({ jobId, role, viewingAs, isOpen, withCandidates = true, card = false }: { jobId: string; role: string; viewingAs: boolean; isOpen: boolean; withCandidates?: boolean; /** On the job card: its own card with a heading. */ card?: boolean }) {
  const choices = await backOrderChoices(jobId);
  if (!choices.ready) return null;
  if (!choices.existing.length && !(withCandidates && choices.candidates.length)) return null;
  const admin = createAdminClient();
  const [{ data: tax }, { data: jobs }] = await Promise.all([
    admin.from("invoices").select("id").eq("job_id", jobId).eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true).is("deposit_for_quotation_id", null).limit(1),
    choices.existing.length ? admin.from("jobs").select("id, job_number").in("id", choices.existing.map((e) => e.job_id)) : Promise.resolve({ data: [] as { id: string; job_number: string }[] }),
  ]);
  const numOf = new Map(((jobs ?? []) as { id: string; job_number: string }[]).map((j) => [j.id, j.job_number]));
  // The follow-up job whose part arrived: the customer's draft message to book the visit (owner and advisors).
  const arrived = choices.existing.find((e) => e.follow_job_id === jobId && e.status === "arrived");
  const seesCustomer = ["owner", "service_advisor", "accounts"].includes(role);
  const message = arrived && seesCustomer ? await arrivedMessageFor(jobId, arrived.partName) : null;
  const { data: cust } = message ? await admin.from("jobs").select("customer:customers(phone)").eq("id", jobId).maybeSingle() : { data: null };
  const phoneDigits = ((cust as unknown as { customer: { phone: string | null } | null } | null)?.customer?.phone ?? "").replace(/[^\d]/g, "") || null;
  const blocked = !isOpen ? "The job is closed." : (tax ?? []).length ? "A tax invoice is already out for this visit: a back order now needs a credit note (ask the owner)." : viewingAs ? "View as is read-only." : null;
  const box = (
    <BackOrderBox
      candidates={withCandidates ? choices.candidates : []}
      labour={choices.labour}
      existing={choices.existing.map((e) => ({ id: e.id, partName: e.partName, status: e.status, words: e.words, followJobId: e.follow_job_id, followNumber: e.followNumber, isFollowUp: e.follow_job_id === jobId, continuesNumber: numOf.get(e.job_id) ?? null, continuesJobId: e.job_id, movedTotal: e.moved_total_aed, hours: e.labour_hours_moved, payMode: e.pay_mode, expected: e.expected_date, message: arrived && e.id === arrived.id ? message : null, phoneDigits }))}
      action={backOrderAction.bind(null, jobId)}
      mayDecide={mayDecideBackOrder(role)}
      mayRequest={mayRequestBackOrder(role)}
      blocked={blocked}
    />
  );
  if (!card) return box;
  return (
    <Card className="flex flex-col gap-3" data-back-orders-card>
      <SectionLabel>Back orders · parts fitted on a later visit</SectionLabel>
      {box}
    </Card>
  );
}
