import { e2eRefused } from "@/lib/e2e-guard";
import { NextResponse, type NextRequest } from "next/server";
import { Client } from "pg";

export const dynamic = "force-dynamic";

/** Runs one read or write statement for the local tests, on the direct database connection. Never in production. */
export async function POST(request: NextRequest) {
  if (e2eRefused(request)) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { sql?: string; params?: unknown[] };
  if (!body.sql) return NextResponse.json({ error: "No sql." }, { status: 400 });
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname.split(".")[0];
  const client = new Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const r = await client.query(body.sql, body.params ?? []);
    return NextResponse.json({ rows: r.rows, count: r.rowCount });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    await client.end();
  }
}
