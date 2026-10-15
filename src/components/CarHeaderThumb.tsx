import { CarThumb } from "./CarThumb";
import { signCarPictures } from "@/lib/car-pictures";
import { createAdminClient } from "@/lib/supabase/admin";

/** The car's picture for a page header, fetched by the car's id so every car page can show it with one line. */
export async function CarHeaderThumb({ vehicleId, alt = "Car" }: { vehicleId: string | null | undefined; alt?: string }) {
  if (!vehicleId) return null;
  const { data } = await createAdminClient().from("vehicles").select("photo_path, kind").eq("id", vehicleId).maybeSingle();
  if (!data || data.kind === "loose") return null;
  const url = data.photo_path ? ((await signCarPictures([data.photo_path])).get(data.photo_path) ?? null) : null;
  return <CarThumb url={url} alt={alt} />;
}
