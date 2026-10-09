import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { qrDataUrl } from "@/lib/pdf/qr";
import { getSiteUrl } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

/** A one-minute, single-use code that signs the same person in on their phone, straight to the car's screen. */
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  let body: { jobId?: string; target?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "");
  const target = String(body.target ?? "inspection").slice(0, 80);
  if (!/^[0-9a-f-]{36}$/.test(jobId)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id").eq("id", jobId).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const code = randomBytes(12).toString("base64url");
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  // The acting owner signs the phone in as the owner; the real person's id is what the code carries.
  const { error } = await admin.from("quick_codes").insert({ code, job_id: jobId, target, created_by: staff.actingAs?.realId ?? staff.id, expires_at: expiresAt });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const url = `${await getSiteUrl()}/q/${code}`;
  return NextResponse.json({ url, qr: await qrDataUrl(url, 300), expiresAt });
}
