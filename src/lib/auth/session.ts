import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceRole } from "@/lib/tasks/constants";

export type WorkspaceSettings = Database["public"]["Tables"]["workspace_settings"]["Row"];

export type Viewer = {
  id: string;
  email: string;
  fullName: string;
  jobTitle: string | null;
  role: WorkspaceRole;
  departmentId: string | null;
  workspaceId: string;
  workspaceName: string;
  taskPrefix: string;
  settings: WorkspaceSettings;
};

/** The verified user id from the session JWT, or null. Deduplicated per request. */
export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
});

/**
 * Data-access-layer entry point: the signed-in user's profile + active membership.
 * Returns null when signed out; `membership: false` when signed in without access.
 */
export const getViewer = cache(async (): Promise<Viewer | null | { membership: false }> => {
  const userId = await getUserId();
  if (!userId) return null;

  const supabase = await createClient();
  const [{ data: profile }, { data: member }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, job_title").eq("id", userId).maybeSingle(),
    supabase
      .from("workspace_members")
      .select("workspace_id, role, department_id, is_active, workspaces(name, task_prefix)")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("joined_at")
      .limit(1)
      .maybeSingle(),
  ]);

  if (!profile || !member || !member.workspaces) return { membership: false };

  const { data: settings } = await supabase
    .from("workspace_settings")
    .select("*")
    .eq("workspace_id", member.workspace_id)
    .single();
  if (!settings) return { membership: false };

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name || profile.email,
    jobTitle: profile.job_title,
    role: member.role,
    departmentId: member.department_id,
    workspaceId: member.workspace_id,
    workspaceName: member.workspaces.name,
    taskPrefix: member.workspaces.task_prefix,
    settings,
  };
});

/** Use in pages/layouts: redirects when signed out or without an active membership. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if ("membership" in viewer) redirect("/no-access");
  return viewer;
}

export async function requireRole(roles: WorkspaceRole[]): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!roles.includes(viewer.role)) redirect("/dashboard?denied=1");
  return viewer;
}

export class ActionError extends Error {}

/** Use in Server Actions: throws instead of redirecting. */
export async function viewerForAction(roles?: WorkspaceRole[]): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer || "membership" in viewer) throw new ActionError("Your session has expired. Please sign in again.");
  if (roles && !roles.includes(viewer.role)) throw new ActionError("You do not have permission to do that.");
  return viewer;
}

export function canCreateTasks(viewer: Viewer) {
  return viewer.role !== "employee" || viewer.settings.employees_can_create_tasks;
}
