"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { dbErrorMessage, fail, ok, runAction, validationFailure, type ActionResult } from "@/lib/actions";
import { viewerForAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { projectSchema, type ProjectInput } from "@/lib/validation/project";

export async function createProject(input: ProjectInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const viewer = await viewerForAction(["admin", "manager"]);
    const parsed = projectSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .insert({ ...parsed.data, owner_id: parsed.data.owner_id ?? viewer.id, workspace_id: viewer.workspaceId })
      .select("id")
      .single();
    if (error) return fail(error.code === "23505" ? "A project with that name already exists." : dbErrorMessage(error));
    refresh();
    return ok(data);
  });
}

export async function updateProject(projectId: string, input: ProjectInput): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    const id = z.uuid().safeParse(projectId);
    const parsed = projectSchema.safeParse(input);
    if (!id.success) return fail("Invalid project.");
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.from("projects").update(parsed.data).eq("id", id.data).select("id");
    if (error) return fail(error.code === "23505" ? "A project with that name already exists." : dbErrorMessage(error));
    if (!data?.length) return fail("You don't have permission to edit this project.");
    refresh();
    return ok(null);
  });
}

export async function setProjectArchived(projectId: string, archived: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    const id = z.uuid().safeParse(projectId);
    if (!id.success) return fail("Invalid project.");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id.data)
      .select("id");
    if (error) return fail(dbErrorMessage(error));
    if (!data?.length) return fail("You don't have permission to change this project.");
    refresh();
    return ok(null);
  });
}

export async function addProjectMember(projectId: string, userId: string, role: "lead" | "member"): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    const parsed = z
      .object({ projectId: z.uuid(), userId: z.uuid(), role: z.enum(["lead", "member"]) })
      .safeParse({ projectId, userId, role });
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const { error } = await supabase.from("project_members").insert({
      project_id: parsed.data.projectId,
      user_id: parsed.data.userId,
      role: parsed.data.role,
      workspace_id: viewer.workspaceId,
    });
    if (error) return fail(error.code === "23505" ? "They're already a member." : dbErrorMessage(error));
    refresh();
    return ok(null);
  });
}

export async function removeProjectMember(projectId: string, userId: string): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    const parsed = z.object({ projectId: z.uuid(), userId: z.uuid() }).safeParse({ projectId, userId });
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_members")
      .delete()
      .eq("project_id", parsed.data.projectId)
      .eq("user_id", parsed.data.userId)
      .select("user_id");
    if (error) return fail(dbErrorMessage(error));
    if (!data?.length) return fail("You don't have permission to change project members.");
    refresh();
    return ok(null);
  });
}
