import { MediaCapture } from "./MediaCapture";
import { VideoRecorder } from "./VideoRecorder";
import { Notice } from "./ui";
import type { Checklist } from "@/lib/media";

/** The full set of gate-in capture controls, used on the PC/tablet media step and on the phone page. */
export function MediaChecklist({ jobId, check, token }: { jobId: string; check: Checklist; token?: string }) {
  return (
    <div className="flex flex-col gap-4">
      {check.complete ? (
        <Notice tone="success">Everything required is uploaded. You can still add damage photos.</Notice>
      ) : (
        <Notice tone="info">
          Required: both videos, the dashboard photo and both keys photos
          {check.majorDamage ? ", plus at least one damage photo" : ""}. The gate-in stays &quot;incomplete, video pending&quot; until then.
        </Notice>
      )}

      <VideoRecorder jobId={jobId} kind="video_exterior" label="1. Exterior video" hint="Walk around the outside of the car." token={token} done={check.videoExterior} />
      <VideoRecorder jobId={jobId} kind="video_interior" label="2. Interior video" hint="Seats, dashboard, boot and controls." token={token} done={check.videoInterior} />
      <MediaCapture jobId={jobId} kind="dashboard_photo" label="3. Dashboard photo (mileage)" done={check.dashboard} token={token} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MediaCapture jobId={jobId} kind="keys_photo_front" label="4. Keys, front" done={check.keysFront} token={token} />
        <MediaCapture jobId={jobId} kind="keys_photo_back" label="5. Keys, back" done={check.keysBack} token={token} />
      </div>
      <MediaCapture
        jobId={jobId}
        kind="damage_photo"
        label={
          check.majorDamage
            ? `6. Major damage photos (at least 1 required)${check.damageCount ? ` · ${check.damageCount} added` : ""}`
            : `6. Damage close-ups (optional)${check.damageCount ? ` · ${check.damageCount} added` : ""}`
        }
        multiple
        done={check.damageCount > 0}
        token={token}
      />
    </div>
  );
}
