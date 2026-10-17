"use server";

import { createClient as createPlainClient } from "@supabase/supabase-js";
import { refresh } from "next/cache";

import { dbErrorMessage, fail, ok, runAction, validationFailure, type ActionResult } from "@/lib/actions";
import { viewerForAction } from "@/lib/auth/session";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  passwordChangeSchema,
  profileSchema,
  type PasswordChangeInput,
  type ProfileInput,
} from "@/lib/validation/profile";

export async function updateProfile(input: ProfileInput): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ ...parsed.data, job_title: parsed.data.job_title || null })
      .eq("id", viewer.id);
    if (error) return fail(dbErrorMessage(error));
    refresh();
    return ok(null);
  });
}

export async function changePassword(input: PasswordChangeInput): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    const parsed = passwordChangeSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);

    // Re-verify the current password with a throwaway client (doesn't touch the session cookie).
    const verifier = createPlainClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: verifyError } = await verifier.auth.signInWithPassword({
      email: viewer.email,
      password: parsed.data.current,
    });
    if (verifyError) return fail("Your current password is incorrect.", { current: ["Incorrect password"] });
    await verifier.auth.signOut({ scope: "local" });

    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) {
      if (error.code === "same_password") return fail("Choose a password you haven't used before.");
      return fail("Could not update your password.");
    }
    return ok(null);
  });
}
