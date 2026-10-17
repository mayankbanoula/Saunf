"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { dbErrorMessage, fail, ok, runAction, validationFailure, type ActionResult } from "@/lib/actions";
import { viewerForAction } from "@/lib/auth/session";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  departmentSchema,
  inviteSchema,
  memberUpdateSchema,
  settingsSchema,
  type DepartmentInput,
  type InviteInput,
  type SettingsInput,
} from "@/lib/validation/admin";

const BAN_FOREVER = "876000h"; // ~100 years

// ---------------------------------------------------------------------------
// Invitations / account creation
// ---------------------------------------------------------------------------
export async function inviteMember(input: InviteInput): Promise<ActionResult<{ mode: "invite" | "password" }>> {
  return runAction(async () => {
    const viewer = await viewerForAction(["admin"]);
    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const { email, full_name, role, department_id, mode, password } = parsed.data;

    const supabase = await createClient();
    const { data: existing } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
    if (existing) return fail("Someone with that email already has an account in this workspace.");

    // 1) Record the invitation with the admin's own session (RLS: admins only).
    const { data: invitation, error } = await supabase
      .from("invitations")
      .insert({ workspace_id: viewer.workspaceId, email, full_name, role, department_id: department_id ?? null })
      .select("id")
      .single();
    if (error) {
      return fail(
        error.code === "23505" ? "There's already a pending invitation for that email." : dbErrorMessage(error),
      );
    }

    // 2) Create the auth user (service role). The on_auth_user_created trigger turns the
    //    pending invitation into a workspace membership with the chosen role.
    const admin = createAdminClient();
    const result =
      mode === "password"
        ? await admin.auth.admin.createUser({
            email,
            password: password!,
            email_confirm: true,
            user_metadata: { full_name },
          })
        : await admin.auth.admin.inviteUserByEmail(email, {
            redirectTo: `${publicEnv.siteUrl}/auth/confirm?next=/set-password`,
            data: { full_name },
          });
    if (result.error) {
      await supabase.from("invitations").update({ status: "revoked" }).eq("id", invitation.id);
      console.error("[admin] auth user creation failed", result.error.message);
      return fail(
        result.error.message.toLowerCase().includes("already")
          ? "An account with that email already exists."
          : `Could not create the account: ${result.error.message}`,
      );
    }
    if (mode === "password") {
      await supabase.from("invitations").update({ status: "accepted" }).eq("id", invitation.id);
    }
    refresh();
    return ok({ mode });
  });
}

export async function resendInvitation(invitationId: string): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction(["admin"]);
    const id = z.uuid().safeParse(invitationId);
    if (!id.success) return fail("Invalid invitation.");
    const supabase = await createClient();
    const { data: inv } = await supabase
      .from("invitations")
      .select("email, full_name, status")
      .eq("id", id.data)
      .maybeSingle();
    if (!inv || inv.status !== "pending") return fail("Only pending invitations can be resent.");
    // Supabase Auth re-sends the invitation email for a user who hasn't accepted yet.
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.inviteUserByEmail(inv.email, {
      redirectTo: `${publicEnv.siteUrl}/auth/confirm?next=/set-password`,
      data: { full_name: inv.full_name },
    });
    if (error) {
      console.error("[admin] resend invite failed", error.message);
      return fail(
        error.message.toLowerCase().includes("already")
          ? "This person has already accepted. Ask them to use “Forgot password” if needed."
          : `Could not resend the invitation: ${error.message}`,
      );
    }
    return ok(null);
  });
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction(["admin"]);
    const id = z.uuid().safeParse(invitationId);
    if (!id.success) return fail("Invalid invitation.");
    const supabase = await createClient();
    const { data: inv, error } = await supabase
      .from("invitations")
      .update({ status: "revoked" })
      .eq("id", id.data)
      .eq("status", "pending")
      .select("accepted_user_id")
      .maybeSingle();
    if (error) return fail(dbErrorMessage(error));
    if (!inv) return fail("Only pending invitations can be revoked.");
    if (inv.accepted_user_id) {
      // The invitation created an account that was never completed. Delete it rather than
      // banning it, so the person can still sign up (or be invited) again later. Opening the
      // invite link counts as a sign-in, so last_sign_in_at can't tell "never used" apart.
      await supabase.from("workspace_members").update({ is_active: false }).eq("user_id", inv.accepted_user_id);
      const admin = createAdminClient();
      const { error: deleteError } = await admin.auth.admin.deleteUser(inv.accepted_user_id);
      if (deleteError) {
        console.error("[admin] deleting revoked invitee failed", deleteError.message);
        await admin.auth.admin.updateUserById(inv.accepted_user_id, { ban_duration: BAN_FOREVER });
      }
    }
    refresh();
    return ok(null);
  });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
export async function updateMember(input: z.input<typeof memberUpdateSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await viewerForAction(["admin"]);
    const parsed = memberUpdateSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const { user_id, ...patch } = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("workspace_members")
      .update(patch)
      .eq("workspace_id", viewer.workspaceId)
      .eq("user_id", user_id)
      .select("user_id");
    if (error) return fail(dbErrorMessage(error));
    if (!data?.length) return fail("Member not found.");
    refresh();
    return ok(null);
  });
}

export async function setMemberActive(userId: string, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await viewerForAction(["admin"]);
    const id = z.uuid().safeParse(userId);
    if (!id.success) return fail("Invalid member.");
    if (id.data === viewer.id) return fail("You can't deactivate your own account.");
    const supabase = await createClient();
    // The database enforces "not yourself" and "keep one active admin".
    const { data, error } = await supabase
      .from("workspace_members")
      .update({ is_active: active })
      .eq("workspace_id", viewer.workspaceId)
      .eq("user_id", id.data)
      .select("user_id");
    if (error) return fail(dbErrorMessage(error));
    if (!data?.length) return fail("Member not found.");

    // Block (or restore) sign-in so a deactivated user can't refresh their session.
    const admin = createAdminClient();
    const { error: banError } = await admin.auth.admin.updateUserById(id.data, {
      ban_duration: active ? "none" : BAN_FOREVER,
    });
    if (banError) {
      console.error("[admin] ban/unban failed", banError.message);
      return fail(
        active
          ? "Member reactivated, but their sign-in could not be restored. Try again."
          : "Member deactivated (no data access), but sign-in could not be blocked. Try again.",
      );
    }
    refresh();
    return ok(null);
  });
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------
export async function saveDepartment(input: DepartmentInput, departmentId?: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await viewerForAction(["admin"]);
    const parsed = departmentSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const values = {
      ...parsed.data,
      manager_id: parsed.data.manager_id ?? null,
      description: parsed.data.description || null,
    };
    const { error } = departmentId
      ? await supabase.from("departments").update(values).eq("id", departmentId)
      : await supabase.from("departments").insert({ ...values, workspace_id: viewer.workspaceId });
    if (error)
      return fail(error.code === "23505" ? "A department with that name already exists." : dbErrorMessage(error));
    refresh();
    return ok(null);
  });
}

export async function deleteDepartment(departmentId: string): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction(["admin"]);
    const id = z.uuid().safeParse(departmentId);
    if (!id.success) return fail("Invalid department.");
    const supabase = await createClient();
    const { data, error } = await supabase.from("departments").delete().eq("id", id.data).select("id");
    if (error) return fail(dbErrorMessage(error));
    if (!data?.length) return fail("Department not found.");
    refresh();
    return ok(null);
  });
}

// ---------------------------------------------------------------------------
// Workspace settings
// ---------------------------------------------------------------------------
export async function updateWorkspaceSettings(input: SettingsInput): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await viewerForAction(["admin"]);
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const { workspace_name, ...settings } = parsed.data;
    const supabase = await createClient();
    const [{ error: wsError }, { error }] = await Promise.all([
      supabase.from("workspaces").update({ name: workspace_name }).eq("id", viewer.workspaceId),
      supabase.from("workspace_settings").update(settings).eq("workspace_id", viewer.workspaceId),
    ]);
    if (wsError || error) return fail(dbErrorMessage((wsError ?? error)!));
    refresh();
    return ok(null);
  });
}
