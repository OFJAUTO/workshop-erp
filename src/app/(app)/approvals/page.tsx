import { notFound } from "next/navigation";
import { PageHeader, Card, Empty } from "@/components/ui";
import { ApprovalBox } from "@/components/ApprovalBox";
import { requireStaff } from "@/lib/auth";
import { dubaiToday, loadStandIn, loadStandInLog, standInFor, standInItems } from "@/lib/standin";
import { standInActive, standInNotice } from "@/lib/standin-rules";
import { KIND_WORDS, loadApprovals, type ApprovalKind } from "@/lib/approvals";
import { autoApprovedList, autoNow } from "@/lib/auto-approve";
import { activeWords, aed } from "@/lib/auto-approve-rules";
import { formatDateTime } from "@/lib/format";
import { LinkButton } from "@/components/ui";

/**
 * APPROVALS (11 November 2026, Section 4): everything in the ERP waiting for the owner, oldest first, grouped by kind,
 * each in THE yellow box with Approve and Refuse (a reason) right here, and Open to its own page.
 */
export default async function ApprovalsPage() {
  const staff = await requireStaff();
  // 13 November 2026 (Section 15): the owner's stand-in sees the requests sent to them (their types, within their
  // limits, never their own); the owner sees everything, the stand-in's decisions and who it is.
  const standIn = staff.role_id === "owner" ? null : await standInFor(staff);
  if (staff.role_id !== "owner" && !standIn) notFound();
  const all = await loadApprovals();
  const items = standIn ? await standInItems(standIn, staff, all) : all;
  const sCfg = standIn ?? (await loadStandIn());
  const sActive = standInActive(sCfg, dubaiToday());
  const sLog = staff.role_id === "owner" ? (await loadStandInLog()).slice(-30).reverse() : [];
  const kinds = Array.from(new Set(items.map((i) => i.kind))) as ApprovalKind[];
  const [auto, now] = await Promise.all([autoApprovedList({ limit: 100 }), autoNow()]);
  return (
    <div className="flex flex-col gap-4" data-approvals-page={items.length}>
      <PageHeader title="Approvals" subtitle={standIn ? `You decide these on behalf of the owner, until ${standIn.until}. Anything above your limits, and your own requests, still wait for him.` : "Everything waiting for your yes or no. Approve here, or refuse with a reason; Open shows the whole page."} actions={standIn ? null : <LinkButton href="/settings/approvals" tone="secondary" data-auto-settings-link>Approvals while I&apos;m away</LinkButton>} />
      {sActive && sCfg.staffName && sCfg.until ? (
        <div className="rounded-control border-2 border-amber-bar bg-amber-soft px-3 py-2 text-sm font-bold" data-standin-banner>
          {standIn ? "You are the owner's stand-in" : standInNotice(sCfg.staffName, sCfg.until)}
        </div>
      ) : null}
      {now.active ? (
        <div className="rounded-control border-2 border-amber-bar bg-amber-soft px-3 py-2 text-sm font-bold" data-auto-on-banner>
          {activeWords(now.cfg)}
        </div>
      ) : null}
      {items.length === 0 ? <Empty title="Nothing waiting for you" /> : null}
      {kinds.map((k) => (
        <Card key={k} className="flex flex-col gap-2" data-approvals-group={k}>
          <span className="text-xs font-extrabold uppercase tracking-[0.08em] text-muted">{KIND_WORDS[k]} · {items.filter((i) => i.kind === k).length}</span>
          {items.filter((i) => i.kind === k).map((i) => <ApprovalBox key={i.key} item={i} link />)}
        </Card>
      ))}
      {staff.role_id === "owner" && sLog.length ? (
        <Card id="stand-in" className="flex flex-col gap-1" data-standin-log={sLog.length}>
          <span className="text-xs font-extrabold uppercase tracking-[0.08em] text-muted">Decided by the stand-in · {sLog.length}</span>
          {sLog.map((r, i) => (
            <span key={`${r.at}-${i}`} className="text-sm" data-standin-row>
              <b>{r.decision === "approved" ? "Approved" : "Refused"}</b> · {r.title}{r.money ? ` · ${r.money}` : ""} · {r.by} · {formatDateTime(r.at)}
            </span>
          ))}
        </Card>
      ) : null}
      {standIn ? null : <Card id="auto-approved" className="flex flex-col gap-2" data-auto-list={auto.length}>
        <span className="text-xs font-extrabold uppercase tracking-[0.08em] text-muted">Auto-approved · {auto.length}{auto.length ? ` · total cost ${aed(auto.reduce((a, r) => a + r.cost, 0))}` : ""}</span>
        {auto.length === 0 ? <span className="text-sm text-muted">Nothing auto-approved yet.</span> : null}
        {auto.map((r, i) => (
          <a key={`${r.at}-${i}`} href={r.href} className="flex flex-col gap-0.5 rounded-control border border-line bg-white px-3 py-2 text-sm hover:border-ink" data-auto-row>
            <span className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{r.jobNumber ?? "Estimate"}</span>
              <span className="text-xs text-muted">{formatDateTime(r.at)} · cost {aed(r.cost)}</span>
            </span>
            <span className="text-xs">{r.note}</span>
          </a>
        ))}
      </Card>}
    </div>
  );
}
