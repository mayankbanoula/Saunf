"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Field, FormError, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/primitives";

import { requestPasswordReset, signIn, updatePassword, type AuthFormState } from "./actions";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action] = useActionState<AuthFormState, FormData>(signIn, null);
  return (
    <form action={action} className="grid gap-4">
      {notice ? <Alert variant="warning">{notice}</Alert> : null}
      <FormError message={state?.error} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Work email" htmlFor="email">
        <Input name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton pendingText="Signing in…" className="w-full">
        Sign in
      </SubmitButton>
      <Link href="/forgot-password" className="text-center text-sm text-muted-foreground hover:text-foreground">
        Forgot your password?
      </Link>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState<AuthFormState, FormData>(requestPasswordReset, null);
  if (state?.message) {
    return (
      <div className="grid gap-4">
        <Alert variant="success">{state.message}</Alert>
        <Link href="/login" className="text-center text-sm text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-4">
      <FormError message={state?.error} />
      <Field label="Work email" htmlFor="email">
        <Input name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <SubmitButton pendingText="Sending…" className="w-full">
        Send reset link
      </SubmitButton>
      <Link href="/login" className="text-center text-sm text-muted-foreground hover:text-foreground">
        Back to sign in
      </Link>
    </form>
  );
}

export function SetPasswordForm({ mode, defaultName }: { mode: "reset" | "invite"; defaultName?: string }) {
  const [state, action] = useActionState<AuthFormState, FormData>(updatePassword, null);
  return (
    <form action={action} className="grid gap-4">
      <FormError message={state?.error} />
      <input type="hidden" name="mode" value={mode} />
      {mode === "invite" ? (
        <Field label="Your name" htmlFor="full_name">
          <Input name="full_name" autoComplete="name" defaultValue={defaultName} maxLength={120} />
        </Field>
      ) : null}
      <Field label="New password" htmlFor="password" hint="At least 8 characters.">
        <Input name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Field label="Confirm password" htmlFor="confirm">
        <Input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <SubmitButton pendingText="Saving…" className="w-full">
        {mode === "invite" ? "Set password and continue" : "Update password"}
      </SubmitButton>
    </form>
  );
}
