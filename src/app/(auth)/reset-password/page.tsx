import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/primitives";
import { getUserId } from "@/lib/auth/session";

import { SetPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Choose a new password" };

async function Content() {
  if (!(await getUserId())) redirect("/login?error=link");
  return <SetPasswordForm mode="reset" />;
}

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Choose a new password</h1>
      <p className="mb-5 text-sm text-muted-foreground">You&apos;ll stay signed in after updating it.</p>
      <Suspense fallback={<Skeleton className="h-48" />}>
        <Content />
      </Suspense>
    </>
  );
}
