import { Card, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const STEP_WORDS: Record<string, string> = { camera: "Opening the camera", decode: "Reading the photo", prepare: "Asking for an upload address", upload: "Sending the file", register: "Recording the file" };

/**
 * Settings > Failed uploads: every photo or video that did not arrive, with the device, the person, the step it
 * failed at, the error and the browser, newest first. For finding the cause of a picture that "never saved".
 */
export default async function UploadFailuresPage() {
  await requirePermission("manageSettings");
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("upload_failures")
    .select("id, created_at, job_id, inspection_id, kind, step, error, staff_id, via, device_name, user_agent, size_bytes, content_type, extra, job:jobs(job_number), staff:staff(display_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  type Row = { id: string; created_at: string; job_id: string | null; kind: string; step: string; error: string; via: string | null; device_name: string | null; user_agent: string | null; size_bytes: number | null; content_type: string | null; extra: Record<string, unknown> | null; job: { job_number: string } | null; staff: { display_name: string } | null };
  const list = (rows ?? []) as unknown as Row[];
  const browser = (ua: string | null) => {
    if (!ua) return "";
    const os = /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua)) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "Mac" : "";
    const b = /CriOS|Chrome\//.test(ua) && !/Edg\//.test(ua) ? "Chrome" : /Edg\//.test(ua) ? "Edge" : /Safari\//.test(ua) ? "Safari" : /Firefox/.test(ua) ? "Firefox" : "";
    return [os, b].filter(Boolean).join(" · ");
  };
  return (
    <>
      <PageHeader title="Failed uploads" subtitle="Photos and videos that did not arrive, newest first. The step tells where it stopped." actions={<LinkButton href="/settings" tone="secondary" size="lg">Settings</LinkButton>} />
      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${list.length}`}>Last 200</SectionLabel>
        {list.length === 0 ? <p className="text-sm text-muted">No failed uploads recorded.</p> : (
          <div className="flex flex-col divide-y divide-line">
            {list.map((r) => (
              <div key={r.id} className="py-2 grid grid-cols-1 md:grid-cols-[10rem_minmax(0,1fr)] gap-1 text-sm" data-failure-row>
                <div className="flex flex-col text-xs text-muted">
                  <span className="font-semibold text-ink">{formatDateTime(r.created_at)}</span>
                  <span>{r.staff?.display_name ?? (r.via === "link" ? "Phone link" : "Unknown person")}</span>
                  <span>{r.device_name ?? browser(r.user_agent) ?? ""}</span>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-semibold">
                    {r.kind.replace(/_/g, " ")} · {STEP_WORDS[r.step] ?? r.step}
                    {r.job?.job_number ? <a href={`/jobs/${r.job_id}`} className="ml-2 text-xs font-bold underline underline-offset-4">{r.job.job_number}</a> : null}
                  </span>
                  <span className="text-red font-semibold break-words">{r.error}</span>
                  <span className="text-xs text-muted truncate" title={r.user_agent ?? ""}>{[r.content_type, r.size_bytes ? `${Math.round(r.size_bytes / 1024)} KB` : "", r.extra && typeof r.extra.online === "boolean" ? (r.extra.online ? "online" : "offline") : "", r.extra && r.extra.visible ? String(r.extra.visible) : "", r.device_name ? browser(r.user_agent) : ""].filter(Boolean).join(" · ")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
