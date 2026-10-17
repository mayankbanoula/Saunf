import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/primitives";

import { LoginForm } from "../auth-forms";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  link: "That link is invalid or has expired. If you just confirmed your email, sign in below; otherwise request a new link.",
  inactive: "Your account has been deactivated. Contact your administrator.",
};

async function LoginContent({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const error = typeof sp.error === "string" ? NOTICES[sp.error] : undefined;
  return <LoginForm next={next} notice={error} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Sign in to Saunf</h1>
      <p className="mb-5 text-sm text-muted-foreground">Use your work email and password.</p>
      <Suspense fallback={<Skeleton className="h-56" />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
