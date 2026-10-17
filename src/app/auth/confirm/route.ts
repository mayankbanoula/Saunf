import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["invite", "recovery", "email", "signup", "magiclink", "email_change"];

/**
 * Landing point for links in auth emails. Verifies the one-time token (token_hash
 * links) or exchanges a PKCE code server-side, sets the session cookie, then
 * redirects to `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const fallback = type === "invite" ? "/set-password" : type === "recovery" ? "/reset-password" : "/dashboard";
  const next = safeNextPath(searchParams.get("next"), fallback);

  const supabase = await createClient();
  let failed = true;

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    failed = Boolean(error);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
  }

  return NextResponse.redirect(new URL(failed ? "/login?error=link" : next, origin));
}
