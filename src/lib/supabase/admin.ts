import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Master-key client. Bypasses every access rule, so it is used only on the
 * server for the few jobs that need it: creating logins, checking PINs,
 * registering tablets. Never import this from browser code.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set in .env.local");
  }
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
