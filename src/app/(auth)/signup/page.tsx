import type { Metadata } from "next";

import { SignUpForm } from "../auth-forms";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Create your Saunf account</h1>
      <p className="mb-5 text-sm text-muted-foreground">Sign up with your work email to join your team.</p>
      <SignUpForm />
    </>
  );
}
