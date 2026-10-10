import { notFound, redirect } from "next/navigation";
import { Button, Card, DescriptionList, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { STATUS_LABELS } from "@/lib/jobs";
import { can, type RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { jobBalance } from "@/lib/invoice-data";
import { askReleaseApproval, collectItems, gateOutJob, markDelivered } from "../../gate-out-actions";
import { loadJobItems } from "@/lib/loose-items";
import { CollectItemsForm } from "./CollectItemsForm";
import { DeliveredForm, GateOutForm } from "./GateOutForm";

export const dynamic = "force-dynamic";

/** Money on screen: two decimals and thousands separators. */
const m = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function GateOutPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("gateOut");
  const { id } = await params;
  const { message, error } = await searchParams;
  const supabase = await createClient();
  const [card, bal] = await Promise.all([loadJobCard(supabase, id), jobBalance(id)]);
  if (!card) notFound();
  if (!card.job.is_open) redirect(`/jobs/${id}`);
  const loose = card.job.job_kind === "loose";
  if (!loose && !card.gateIn) notFound();
  const g = card.gateIn;
  const items = loose ? await loadJobItems(id) : [];
  const role = staff.role_id as RoleId;
  const keysPhotos = card.media.filter((m) => m.kind === "keys_photo_front" || m.kind === "keys_photo_back" || m.kind === "keys_photo");
  const job = card.job;
  const blocked = bal.state === "no_invoice" || bal.balance > 0;

  return (
    <>
      <PageHeader title={`Gate out · ${formatPlate(card.vehicle)}`} subtitle={`${vehicleTitle(card.vehicle)} · ${job.job_number} · ${STATUS_LABELS[job.status]}`} actions={<LinkButton href={`/jobs/${id}`} tone="secondary" size="lg">Job card</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {job.status !== "ready" && job.status !== "pending_payment" && job.status !== "in_delivery" ? <Notice tone="info">{loose ? "The items are" : "This car is"} not marked ready yet ({STATUS_LABELS[job.status]}). Gate-out is still allowed and will be logged.</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          {job.status === "in_delivery" ? (
            <Card className="flex flex-col gap-3 border-ink">
              <SectionLabel>Out for delivery</SectionLabel>
              {card.gateOut ? <p className="text-sm">Left the workshop {formatDateTime(card.gateOut.created_at)} for {(card.gateOut as unknown as { delivery_address: string | null }).delivery_address ?? "the customer"}.</p> : null}
              <DeliveredForm jobId={id} action={markDelivered.bind(null, id)} />
            </Card>
          ) : loose ? (
            <Card>
              <CollectItemsForm action={collectItems.bind(null, id)} items={items.map((it) => ({ id: it.id, label: `${it.quantity > 1 ? `${it.quantity} × ` : ""}${it.item_type}${it.description ? ` · ${it.description}` : ""}`, collected: !!it.collected_at }))} canApproveRelease={can(role, "approveRelease")} balance={{ state: bal.state, balance: bal.balance, invoiceNumber: bal.invoice?.number ?? null }} />
            </Card>
          ) : (
            <Card>
              <GateOutForm jobId={id} action={gateOutJob.bind(null, id)} keysCount={g!.keys_count} keychain={g!.keys_keychain} dashCam={g!.dash_cam} oldParts={g!.old_parts_return} canOverride={can(role, "overrideKeys")} canApproveRelease={can(role, "approveRelease")} balance={{ state: bal.state, balance: bal.balance, invoiceNumber: bal.invoice?.number ?? null }} />
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-2">
            <SectionLabel>Balance</SectionLabel>
            {bal.state === "nothing" ? <p className="text-sm text-muted">Nothing to invoice on this job.</p> : bal.state === "no_invoice" ? <p className="text-sm font-semibold text-red">No invoice issued yet.</p> : (
              <DescriptionList items={[{ label: "Invoice", value: bal.invoice?.number ?? null }, { label: "Paid", value: `AED ${m(bal.paid)}` }, { label: "Balance due", value: <span className={bal.balance > 0 ? "font-bold text-red" : "font-bold text-green"}>AED {m(bal.balance)}</span> }, { label: "Cheques pending", value: bal.pending ? `AED ${m(bal.pending)}` : null }]} />
            )}
            {bal.invoice ? <LinkButton href={`/invoices/${bal.invoice.id}`} tone="secondary" size="md">Open the invoice</LinkButton> : can(role, "issueInvoices") && bal.state === "no_invoice" ? <LinkButton href={`/jobs/${id}/invoice`} size="md">Issue the invoice</LinkButton> : null}
            {blocked && !can(role, "approveRelease") && job.status !== "in_delivery" ? (
              <form action={askReleaseApproval.bind(null, id)}>
                <Button type="submit" tone="secondary" size="md">Ask the owner to approve the release</Button>
              </form>
            ) : null}
          </Card>
          {!loose && g ? (
          <Card className="flex flex-col gap-3">
            <SectionLabel>Keys at gate-in</SectionLabel>
            {keysPhotos.length ? (
              <div className="grid grid-cols-2 gap-2">
                {keysPhotos.map((p) => {
                  const url = card.mediaUrls.get(p.storage_path);
                  return url ? (
                    <a key={p.id} href={url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="Keys at gate-in" className="w-full rounded-card object-cover aspect-[4/3] bg-chip" />
                    </a>
                  ) : null;
                })}
              </div>
            ) : (
              <p className="text-sm text-muted">No keys photos on record.</p>
            )}
            <DescriptionList items={[{ label: "Keys received", value: `${g.keys_count}` }, { label: "Keychain", value: g.keys_keychain ? "Yes" : "No" }, { label: "Dash cam", value: g.dash_cam ? "Fitted, was disconnected" : "Not fitted" }, { label: "Old parts", value: g.old_parts_return ? "Customer wants them back" : "Not requested" }]} />
          </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
