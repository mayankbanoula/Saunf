"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { safeNextPath } from "@/lib/actions";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = { error?: string; message?: string; fieldErrors?: Record<string, string> } | null;

const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));
const passwordSchema = z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters");

type Access = "active" | "pending" | "deactivated" | "none";

const ACCESS_MESSAGE: Record<Exclude<Access, "active">, string> = {
  pending: "Your account is waiting for an administrator to approve it. You'll be able to sign in once it's approved.",
  deactivated: "This account has been deactivated. Contact your administrator.",
  none: "Your account doesn't have access to a workspace. Contact your administrator.",
};

/** The caller's own membership state (users can always read their own membership row). */
async function membershipAccess(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<Access> {
  const { data } = await supabase
    .from("workspace_members")
    .select("is_active, deactivated_at")
    .eq("user_id", userId)
    .order("joined_at");
  if (!data?.length) return "none";
  if (data.some((m) => m.is_active)) return "active";
  return data.some((m) => m.deactivated_at === null) ? "pending" : "deactivated";
}

const signUpSchema = z.object({
  full_name: z.string().trim().min(1, "Enter your name").max(120),
  email: emailSchema,
  password: passwordSchema,
});

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.full_name },
      emailRedirectTo: `${publicEnv.siteUrl}/auth/confirm?next=/dashboard`,
    },
  });
  if (error) {
    // The database rejects addresses that no workspace has opened sign-up to.
    if (error.code === "unexpected_failure" || /database error/i.test(error.message)) {
      return {
        error: "Sign-up isn't open for this email address. Use your work email, or ask an admin to invite you.",
      };
    }
    if (error.code === "user_already_exists")
      return { error: "An account with this email already exists. Sign in instead." };
    if (error.code === "signup_disabled") return { error: "Sign-up is turned off. Ask an admin to invite you." };
    if (error.code === "weak_password") return { error: "That password is too weak. Try a longer one." };
    if (error.status === 429) return { error: "Too many attempts. Please wait a minute and try again." };
    console.error("[auth] signUp failed", error.code, error.message);
    return { error: "Could not create your account. Please try again." };
  }

  // Email confirmation is on: Supabase sends a link and returns no session.
  if (!data.session || !data.user) {
    return {
      message: `We've sent a confirmation link to ${parsed.data.email}. Open it to finish creating your account.`,
    };
  }

  const access = await membershipAccess(supabase, data.user.id);
  if (access !== "active") {
    await supabase.auth.signOut();
    return { message: ACCESS_MESSAGE[access] };
  }
  redirect("/dashboard");
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1, "Enter your password") })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    // Banned (deactivated) users get a distinct but non-revealing message.
    if (error?.code === "user_banned") {
      return { error: "This account has been deactivated. Contact your administrator." };
    }
    if (error?.code === "email_not_confirmed") {
      return { error: "Confirm your email address first — check your inbox for the link." };
    }
    return { error: "Incorrect email or password." };
  }

  const access = await membershipAccess(supabase, data.user.id);
  if (access !== "active") {
    await supabase.auth.signOut();
    return { error: ACCESS_MESSAGE[access] };
  }

  redirect(safeNextPath(formData.get("next")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${publicEnv.siteUrl}/auth/confirm?next=/reset-password`,
  });
  if (error && error.status !== 429) {
    console.error("[auth] resetPasswordForEmail failed", error.message);
  }
  if (error?.status === 429) {
    return { error: "Too many requests. Please wait a minute and try again." };
  }
  // Same response whether or not the account exists (no account enumeration).
  return { message: "If an account exists for that email, a reset link is on its way." };
}

const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

export async function updatePassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return { error: "Your reset link has expired. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { error: "Choose a password you haven't used before." };
    if (error.code === "weak_password") return { error: "That password is too weak." };
    console.error("[auth] updateUser failed", error.message);
    return { error: "Could not update your password. Please try again." };
  }

  const fullName = String(formData.get("full_name") ?? "").trim();
  if (formData.get("mode") === "invite") {
    if (fullName) {
      await supabase
        .from("profiles")
        .update({ full_name: fullName.slice(0, 120) })
        .eq("id", claims.claims.sub);
    }
    await supabase.rpc("accept_invitation");
  }
  redirect("/dashboard");
}
