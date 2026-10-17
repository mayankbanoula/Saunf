import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS — use ONLY for Supabase Auth admin operations
 * (invite, create, ban users) and trusted cron jobs, and only after the caller's
 * permission has been verified with their own session.
 */
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    throw new Error("SUPABASE_SECRET_KEY is not configured on the server.");
  }
  return createClient<Database>(publicEnv.supabaseUrl, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
