"use client";

import { Loader2Icon } from "lucide-react";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

const DESTINATION: Record<string, string> = { invite: "/set-password", recovery: "/reset-password" };

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : null;
}

/**
 * Finishes sign-in for auth email links that carry the session in the URL #fragment
 * (Supabase's default templates). Stores the session as cookies, then continues.
 */
export default function AuthCallbackPage() {
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (!accessToken || !refreshToken) {
      window.location.replace("/login?error=link");
      return;
    }
    createClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        const type = hash.get("type") ?? "";
        window.location.replace(error ? "/login?error=link" : (next ?? DESTINATION[type] ?? "/dashboard"));
      });
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" /> Signing you in…
    </main>
  );
}
