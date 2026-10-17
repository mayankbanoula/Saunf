"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { safeNextPath } from "@/lib/actions";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = { error?: string; message?: string; fieldErrors?: Record<string, string> } | null;

const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));
const passwordSchema = z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters");

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
    return { error: "Incorrect email or password." };
  }

  const { data: member } = await supabase
    .from("workspace_members")
    .select("is_active")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!member) {
    await supabase.auth.signOut();
    return { error: "Your account doesn't have access to a workspace. Contact your administrator." };
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
