import { e2eRefused } from "@/lib/e2e-guard";
import { NextResponse, type NextRequest } from "next/server";
import { clearTestData } from "@/lib/clear-test-data";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Runs the same clear-out as the Settings button, from the local server with the test secret. Never in production. */
export async function POST(request: NextRequest) {
  if (e2eRefused(request)) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const { data: owner } = await createAdminClient().from("staff").select("id, display_name").eq("role_id", "owner").eq("is_active", true).limit(1).maybeSingle();
  if (!owner) return NextResponse.json({ error: "No owner." }, { status: 400 });
  try {
    const result = await clearTestData(owner);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
