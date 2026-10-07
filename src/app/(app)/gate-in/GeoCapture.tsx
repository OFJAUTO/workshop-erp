"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/** Captures the device's GPS position into hidden fields. */
export function GeoCapture() {
  const [pos, setPos] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  function capture() {
    if (!navigator.geolocation) {
      setState("error");
      return;
    }
    setState("busy");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
        setState("idle");
      },
      () => setState("error"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="location_lat" value={pos?.lat ?? ""} />
      <input type="hidden" name="location_lng" value={pos?.lng ?? ""} />
      <Button type="button" tone="secondary" onClick={capture} disabled={state === "busy"}>
        {state === "busy" ? "Getting position…" : pos ? "Update GPS position" : "Capture GPS position"}
      </Button>
      {pos ? (
        <span className="text-xs font-semibold text-green">
          Position captured ({pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}, ±{Math.round(pos.acc)} m)
        </span>
      ) : state === "error" ? (
        <span className="text-xs font-semibold text-red">Position not available. Allow location access and try again.</span>
      ) : (
        <span className="text-xs text-muted">Use the phone for an accurate position.</span>
      )}
    </div>
  );
}
