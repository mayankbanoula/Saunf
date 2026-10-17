import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/primitives";
import { getUserId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

import { SetPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Welcome to Saunf" };

async function Content() {
  const userId = await getUserId();
  if (!userId) redirect("/login?error=link");
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return <SetPasswordForm mode="invite" defaultName={profile?.full_name ?? ""} />;
}

export default function SetPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Welcome to Saunf</h1>
      <p className="mb-5 text-sm text-muted-foreground">Set a password to finish creating your account.</p>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
