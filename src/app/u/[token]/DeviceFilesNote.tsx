"use client";

import { deviceWord, useDeviceFiles } from "@/components/MediaCapture";

/**
 * On the phone page whose link has run out: photos and videos this phone took for the car are still on it and keep
 * sending (their sending permit outlives the 30-minute link), so the person is told not to close the page yet.
 */
export function DeviceFilesNote({ jobId }: { jobId: string }) {
  const files = useDeviceFiles(jobId);
  if (!files.length) return null;
  const stopped = files.filter((f) => f.state === "stopped").length;
  const where = deviceWord();
  const n = files.length;
  return (
    <p className={`rounded-control px-4 py-3 text-sm font-semibold ${stopped ? "bg-red-soft text-red" : "bg-amber-soft text-amber"}`} data-device-note={n}>
      {stopped
        ? `${stopped === 1 ? "1 file" : `${stopped} files`} from this ${where} could not be sent. Tap "could not be sent" at the bottom of the screen to try again or remove ${stopped === 1 ? "it" : "them"}.`
        : `${n === 1 ? "1 photo or video" : `${n} photos and videos`} from this ${where} ${n === 1 ? "is" : "are"} still sending to the car. Leave this page open until ${n === 1 ? "it has" : "they have"} gone.`}
    </p>
  );
}
