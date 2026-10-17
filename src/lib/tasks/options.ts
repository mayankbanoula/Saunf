import "server-only";

import type { FilterOptions } from "@/components/tasks/task-filters";
import type { Viewer } from "@/lib/auth/session";
import type { ServerSupabase } from "@/lib/supabase/server";
import { displayName } from "@/lib/utils";

/** Options for filter dropdowns. Everything is RLS-scoped to the viewer. */
export async function loadFilterOptions(supabase: ServerSupabase, viewer: Viewer): Promise<FilterOptions> {
  const [members, projects, labels, departments] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("user_id, profiles!workspace_members_user_id_fkey(full_name, email)")
      .eq("workspace_id", viewer.workspaceId)
      .eq("is_active", true),
    supabase.from("projects").select("id, name").is("archived_at", null).order("name"),
    supabase.from("labels").select("id, name, color").order("name"),
    supabase.from("departments").select("id, name").order("name"),
  ]);
  return {
    members: (members.data ?? [])
      .map((m) => ({ id: m.user_id, name: displayName(m.profiles) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    projects: projects.data ?? [],
    labels: labels.data ?? [],
    departments: departments.data ?? [],
  };
}
