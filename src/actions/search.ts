"use server";

import { z } from "zod";

import { fail, ok, runAction, type ActionResult } from "@/lib/actions";
import { viewerForAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { escapeLike, pgrstQuote } from "@/lib/utils";

export type SearchResults = {
  tasks: { id: string; key: string; title: string; status: string }[];
  people: { id: string; full_name: string; email: string; job_title: string | null }[];
  projects: { id: string; name: string; status: string }[];
  labels: { id: string; name: string; color: string }[];
};

export async function globalSearch(rawQuery: string, limit = 6): Promise<ActionResult<SearchResults>> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    const parsed = z.string().trim().min(1).max(100).safeParse(rawQuery);
    if (!parsed.success) return ok({ tasks: [], people: [], projects: [], labels: [] });
    const term = `%${escapeLike(parsed.data.toLowerCase())}%`;
    const supabase = await createClient();
    const n = Math.min(Math.max(limit, 1), 50);

    // Every query runs under RLS, so results only include what the viewer may see.
    const [tasks, members, projects, labels] = await Promise.all([
      supabase
        .from("tasks")
        .select("id, key, title, status")
        .ilike("search_text", term)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(n),
      supabase
        .from("workspace_members")
        .select("user_id, profiles!workspace_members_user_id_fkey!inner(id, full_name, email, job_title)")
        .eq("workspace_id", viewer.workspaceId)
        .eq("is_active", true)
        .or(`full_name.ilike.${pgrstQuote(term)},email.ilike.${pgrstQuote(term)}`, { referencedTable: "profiles" })
        .limit(n),
      supabase
        .from("projects")
        .select("id, name, status")
        .ilike("name", term)
        .is("archived_at", null)
        .limit(n),
      supabase.from("labels").select("id, name, color").ilike("name", term).limit(n),
    ]);
    if (tasks.error || members.error || projects.error || labels.error) {
      console.error("[search]", tasks.error ?? members.error ?? projects.error ?? labels.error);
      return fail("Search failed. Please try again.");
    }
    return ok({
      tasks: tasks.data ?? [],
      people: (members.data ?? []).map((m) => m.profiles),
      projects: projects.data ?? [],
      labels: labels.data ?? [],
    });
  });
}
