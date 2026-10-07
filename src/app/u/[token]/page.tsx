import { PublicShell } from "@/components/Shell";
import { MediaCapture } from "@/components/MediaCapture";
import { VideoRecorder } from "@/components/VideoRecorder";
import { Card, Notice } from "@/components/ui";
import { loadMedia, mediaChecklist } from "@/lib/media";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

function isExpired(iso: string) {
  return new Date(iso).getTime() < Date.now();
}

type JobInfo = {
  job_number: string;
  vehicle: {
    plate_country: string;
    plate_emirate: string | null;
    plate_code: string | null;
    plate_number: string;
    make: { name: string } | null;
    model: { name: string } | null;
  } | null;
};

/** Opened on a phone by scanning the QR code shown at gate-in. No login needed; the link expires. */
export default async function PhoneUploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("upload_links")
    .select("job_id, expires_at, job:jobs(job_number, vehicle:vehicles(plate_country, plate_emirate, plate_code, plate_number, make:vehicle_makes(name), model:vehicle_models(name)))")
    .eq("token", token)
    .maybeSingle();

  if (!link || isExpired(link.expires_at)) {
    return (
      <PublicShell note="Phone upload">
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="max-w-md w-full">
            <Notice tone="error">This link has expired. Show the QR code again on the PC or tablet to get a new one.</Notice>
          </Card>
        </div>
      </PublicShell>
    );
  }

  const job = link.job as unknown as JobInfo | null;
  const media = await loadMedia(link.job_id);
  const check = mediaChecklist(media);
  const damageCount = media.filter((m) => m.kind === "damage_photo").length;

  return (
    <PublicShell note="Phone upload">
      <div className="flex-1 flex flex-col gap-4 px-4 py-5 max-w-lg w-full mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-extrabold">{job?.vehicle ? formatPlate(job.vehicle) : "Job"}</h1>
          <p className="text-sm text-muted">
            {[job?.vehicle?.make?.name, job?.vehicle?.model?.name].filter(Boolean).join(" ")} · {job?.job_number}
          </p>
        </div>
        {check.complete ? <Notice tone="success">Everything required is uploaded. You can add more damage photos.</Notice> : null}
        <VideoRecorder jobId={link.job_id} token={token} done={check.video} />
        <MediaCapture jobId={link.job_id} kind="dashboard_photo" label="Dashboard photo (mileage)" done={check.dashboard} token={token} />
        <MediaCapture jobId={link.job_id} kind="keys_photo" label="Keys photo" done={check.keys} token={token} />
        <MediaCapture
          jobId={link.job_id}
          kind="damage_photo"
          label={`Damage close-ups (optional)${damageCount ? ` · ${damageCount}` : ""}`}
          multiple
          token={token}
        />
        <p className="text-xs text-muted">This link works for 30 minutes. Uploads are recorded under the person who opened it.</p>
      </div>
    </PublicShell>
  );
}
