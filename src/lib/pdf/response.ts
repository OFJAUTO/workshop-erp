import { NextResponse } from "next/server";

/** A PDF shown in the browser, with a sensible file name when saved. */
export function pdfResponse(pdf: Buffer, filename: string) {
  const safe = filename.replace(/["\\\r\n]/g, "");
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${safe}"`, "Cache-Control": "private, no-store" },
  });
}
