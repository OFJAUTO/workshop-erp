// Creates the owner's master account once and writes a one-time setup link to a file.
// Run from the project folder:
//   node --env-file=.env.local scripts/bootstrap-owner.mjs --email owner@example.com --name "Omar Aljaf" --site http://localhost:3000
import { writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const email = (arg("email", "") || "").trim().toLowerCase();
const fullName = arg("name", "Owner");
const displayName = arg("display", fullName.split(" ")[0]);
const site = (arg("site", "http://localhost:3000") || "").replace(/\/$/, "");

if (!email) {
  console.error("Missing --email");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// 1. Find or create the login.
let userId = null;
{
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const existing = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
  if (existing) {
    userId = existing.id;
    console.log("Login already exists; reusing it.");
  } else {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createError) throw createError;
    userId = created.user.id;
    console.log("Login created.");
  }
}

// 2. Find or create the staff record as owner.
{
  const { data: staff } = await admin.from("staff").select("id, role_id").eq("id", userId).maybeSingle();
  if (!staff) {
    const { error } = await admin.from("staff").insert({
      id: userId,
      full_name: fullName,
      display_name: displayName,
      role_id: "owner",
      department_id: "office",
      login_type: "password",
      created_by: userId,
      updated_by: userId,
    });
    if (error) throw error;
    const { error: privError } = await admin.from("staff_private").insert({ staff_id: userId, email });
    if (privError) throw privError;
    console.log("Owner staff record created.");
  } else {
    console.log(`Staff record already exists with role "${staff.role_id}".`);
  }
}

// 3. A 24-hour setup link so the owner chooses a password (used up only when saved).
{
  const token = randomBytes(24).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { error } = await admin.from("setup_links").insert({
    staff_id: userId,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    created_by: userId,
  });
  if (error) throw error;
  const link = `${site}/auth/setup/${token}`;
  writeFileSync("owner-setup-link.txt", link + "\n", "utf8");
  console.log("Setup link written to owner-setup-link.txt (open it in the browser, then delete the file).");
}
