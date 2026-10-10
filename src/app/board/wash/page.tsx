import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { signCarPictures } from "@/lib/car-pictures";
import { getCurrentDevice } from "@/lib/devices";
import { formatPromised } from "@/lib/jobs";
import { GATE_IN_BUCKET } from "@/lib/media";
import { getSettings } from "@/lib/settings";
import { departmentBreak } from "@/lib/breaks";
import { breakNow } from "@/lib/working-time";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { Reload } from "../Reload";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Wash board", robots: { index: false, follow: false } };

type Row = { id: string; job_number: string; wash_sent_at: string | null; promised_at: string | null; vehicle: { id: string; photo_path: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; colour: string | null; make: { name: string } | null; model: { name: string } | null } | null };

/**
 * The wash board: a screen at the wash bay with no login. One tile per car sent to the wash, with the
 * car's picture, plate, make and colour. It refreshes itself. Only a device the owner registered shows it.
 */
export default async function WashBoardPage() {
  const device = await getCurrentDevice();
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-ink text-white flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/15">
        <Logo onDark className="h-10" alt="OFJ Automotive" />
        <span className="text-xl font-extrabold tracking-[0.12em] uppercase">Wash board</span>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
  if (!device) {
    return shell(<p className="text-lg text-white/80">This screen is not registered. The owner signs in on this device and opens <span className="font-mono">/tablet/register</span>, then comes back to this page.</p>);
  }
  const settings = await getSettings();
  const admin = createAdminClient();
  const { data } = await admin.from("jobs").select("id, job_number, wash_sent_at, promised_at, vehicle:vehicles(kind, id, photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, colour, make:vehicle_makes(name), model:vehicle_models(name))").eq("is_open", true).eq("status", "pending_wash").not("wash_sent_at", "is", null).order("wash_sent_at");
  const rows = (data ?? []) as unknown as Row[];
  const pictures = await signCarPictures(rows.map((r) => r.vehicle?.photo_path));
  // Cars without a picture of their own: the first gate-in photo.
  const missing = rows.filter((r) => !r.vehicle?.photo_path);
  const fallback = new Map<string, string>();
  if (missing.length) {
    const { data: media } = await admin.from("gate_in_media").select("job_id, storage_path, kind, taken_at").in("job_id", missing.map((r) => r.id)).in("kind", ["dashboard_photo", "damage_photo", "keys_photo"]).order("taken_at");
    const first = new Map<string, string>();
    for (const m of media ?? []) if (!first.has(m.job_id)) first.set(m.job_id, m.storage_path);
    if (first.size) {
      const { data: signed } = await admin.storage.from(GATE_IN_BUCKET).createSignedUrls(Array.from(first.values()), 3600);
      const byPath = new Map((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl]));
      for (const [jobId, path] of first) if (byPath.get(path)) fallback.set(jobId, byPath.get(path)!);
    }
  }
  const showTimes = settings.wash_board_show_times === true;
  const bodyshopBreak = breakNow(departmentBreak(settings, "bodyshop"));
  return shell(
    <>
      <Reload seconds={30} />
      {bodyshopBreak?.inBreak ? <p className="mb-4 rounded-card bg-white/10 px-5 py-3 text-2xl font-extrabold text-center">On break until {departmentBreak(settings, "bodyshop")?.end}</p> : null}
      {rows.length === 0 ? (
        <p className="text-3xl font-extrabold text-white/70 text-center mt-24">No cars waiting for wash</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
          {rows.map((r) => {
            const url = (r.vehicle?.photo_path ? pictures.get(r.vehicle.photo_path) : null) ?? fallback.get(r.id) ?? null;
            return (
              <div key={r.id} className="rounded-card bg-white text-ink overflow-hidden flex flex-col">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" className="w-full aspect-[8/5] object-cover bg-chip" />
                ) : (
                  <div className="w-full aspect-[8/5] bg-chip flex items-center justify-center text-muted text-sm">No picture</div>
                )}
                <div className="p-4 flex flex-col gap-1">
                  <span className="text-3xl font-extrabold tracking-[0.04em]">{r.vehicle ? formatPlate(r.vehicle) : r.job_number}</span>
                  <span className="text-lg font-bold">{[r.vehicle?.make?.name, r.vehicle?.model?.name].filter(Boolean).join(" ")}</span>
                  <span className="text-base text-muted">{r.vehicle?.colour ?? ""}</span>
                  {showTimes && r.promised_at ? <span className="text-sm font-semibold">Needed by {formatPromised(r.promised_at)}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>,
  );
}
