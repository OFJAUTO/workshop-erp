import "server-only";
import { logAppError } from "./app-errors";
import { notifyStaff } from "./notifications";
import { SCANS_BUCKET, attachPrescan, prescanCaption } from "./scans";
import { createAdminClient } from "./supabase/admin";

/**
 * Fix 1 of 4 November 2026: a matched scan reaches the technician's Step 1 whatever the order of events.
 * The email matcher copies the PDF onto the inspection only when the mechanical inspection already exists
 * (J-00979's report arrived an hour before the technician was assigned, so the copy silently did nothing
 * and the tablet kept saying "waiting for the scanner's email"). This sweep closes that order: it runs
 * right after every assignment (that one job) and on every five-minute mailbox cron (every open job of
 * the last 30 days), copies whatever is matched but missing, tells the technician, and is idempotent -
 * a report already on the inspection, or one the technician removed with the X, is never copied again.
 * It runs with the server's own key and needs nobody to be logged in. It never throws.
 */
export async function attachMatchedScans(jobId?: string): Promise<number> {
  const admin = createAdminClient();
  let attachedTotal = 0;
  try {
    let q = admin
      .from("inbound_scans")
      .select("id, job_id, file_name, storage_path, job:jobs!inner(id, job_number, is_open)")
      .in("status", ["matched", "attached"])
      .eq("kind", "pre")
      .eq("is_active", true)
      .eq("content_type", "application/pdf")
      .gte("received_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
      .order("received_at");
    q = jobId ? q.eq("job_id", jobId) : q.eq("job.is_open", true);
    const { data: scans, error } = await q;
    if (error) {
      await logAppError("scans.sweep", error, { jobId: jobId ?? null });
      return 0;
    }
    if (!scans?.length) return 0;
    const jobIds = [...new Set(scans.map((s) => s.job_id as string))];
    const { data: insps } = await admin.from("inspections").select("id, job_id, technician_id").eq("path", "mechanical").eq("is_active", true).in("job_id", jobIds);
    const inspOf = new Map((insps ?? []).map((i) => [i.job_id as string, i]));
    const byJob = new Map<string, { files: string[]; technician: string | null; number: string }>();
    for (const s of scans) {
      const insp = inspOf.get(s.job_id as string);
      if (!insp) continue; // Not assigned yet: the assignment itself runs this sweep for the job.
      const name = (s.file_name as string | null) ?? "scan.pdf";
      const { data: already } = await admin.from("inspection_media").select("id").eq("inspection_id", insp.id).eq("is_prescan", true).eq("caption", prescanCaption(name)).limit(1);
      if (already?.length) continue;
      const { data: file, error: dlErr } = await admin.storage.from(SCANS_BUCKET).download(s.storage_path as string);
      if (dlErr || !file) {
        await logAppError("scans.sweep", dlErr ?? new Error("Could not read the stored scan file"), { jobId: s.job_id as string, detail: { path: s.storage_path } });
        continue;
      }
      const out = await attachPrescan(s.job_id as string, Buffer.from(await file.arrayBuffer()), name);
      if (out !== "attached") continue;
      attachedTotal++;
      const job = s.job as unknown as { job_number: string };
      const got = byJob.get(s.job_id as string) ?? { files: [], technician: (insp.technician_id as string | null) ?? null, number: job?.job_number ?? "" };
      got.files.push(name);
      byJob.set(s.job_id as string, got);
    }
    for (const [jid, got] of byJob) {
      await admin.from("job_events").insert({ job_id: jid, event_type: "scan_attached", note: `Scan report${got.files.length === 1 ? "" : "s"} placed on the inspection: ${got.files.map((f) => f.slice(0, 60)).join(", ")}` });
      if (got.technician) {
        await notifyStaff([got.technician], {
          type: "scan_received",
          title: `Scan report is on the job · ${got.number}`,
          body: `Step 1 has the report${got.files.length === 1 ? "" : "s"} now. Open it, read it, and tap that you have read it.`,
          jobId: jid,
          href: `/my-jobs/${jid}`,
        });
      }
    }
  } catch (e) {
    await logAppError("scans.sweep", e, { jobId: jobId ?? null });
  }
  return attachedTotal;
}
