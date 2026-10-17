import type { Metadata } from "next";

import { ForgotPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Reset your password</h1>
      <p className="mb-5 text-sm text-muted-foreground">We&apos;ll email you a link to choose a new password.</p>
      <ForgotPasswordForm />
    </>
  );
}
