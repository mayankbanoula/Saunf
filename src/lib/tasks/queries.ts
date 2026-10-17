import "server-only";

import type { Viewer } from "@/lib/auth/session";
import { addDaysIso, dateRangeToTimestamps, nowInTimezone } from "@/lib/dates";
import type { ServerSupabase } from "@/lib/supabase/server";
import { PAGE_SIZE } from "@/lib/tasks/constants";
import { SORT_COLUMN, sortDirection, type TaskFilters } from "@/lib/tasks/filters";
import { escapeLike } from "@/lib/utils";

export const TASK_LIST_SELECT = `id, key, title, status, priority, progress, start_date, due_date, due_time,
  is_blocked, created_at, updated_at, completed_at, archived_at, project_id, creator_id, assignee_id,
  assignee:profiles!tasks_assignee_profile_fkey(id, full_name, email),
  creator:profiles!tasks_creator_profile_fkey(id, full_name, email),
  project:projects!tasks_workspace_id_project_id_fkey(id, name),
  task_labels(labels(id, name, color))`;

export type TaskListRow = {
  id: string;
  key: string;
  title: string;
  status: "todo" | "in_progress" | "in_review" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  progress: number;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  is_blocked: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
  project_id: string | null;
  creator_id: string | null;
  assignee_id: string | null;
  assignee: { id: string; full_name: string; email: string } | null;
  creator: { id: string; full_name: string; email: string } | null;
  project: { id: string; name: string } | null;
  task_labels: { labels: { id: string; name: string; color: string } | null }[];
};

export type QueryContext = { viewerId: string; today: string; nowTime: string; timezone: string };

export function queryContext(viewer: Viewer): QueryContext {
  const { today, time } = nowInTimezone(viewer.settings.timezone);
  return { viewerId: viewer.id, today, nowTime: time, timezone: viewer.settings.timezone };
}

/**
 * Build the filtered task query. RLS restricts rows to what the viewer may see;
 * these filters only narrow further.
 */
export function buildTaskQuery(
  supabase: ServerSupabase,
  filters: TaskFilters,
  ctx: QueryContext,
  options: { count?: boolean } = {},
) {
  const select = filters.label ? `${TASK_LIST_SELECT}, label_filter:task_labels!inner(label_id)` : TASK_LIST_SELECT;
  let query = supabase.from("tasks").select(select, options.count ? { count: "exact" } : undefined);

  if (filters.archived === "only") query = query.not("archived_at", "is", null);
  else if (filters.archived !== "include") query = query.is("archived_at", null);

  if (filters.q) query = query.ilike("search_text", `%${escapeLike(filters.q.toLowerCase())}%`);
  if (filters.status.length) query = query.in("status", filters.status);
  if (filters.open) query = query.neq("status", "done");
  if (filters.priority.length) query = query.in("priority", filters.priority);

  if (filters.assignee === "me") query = query.eq("assignee_id", ctx.viewerId);
  else if (filters.assignee === "none") query = query.is("assignee_id", null);
  else if (filters.assignee) query = query.eq("assignee_id", filters.assignee);

  if (filters.creator === "me") query = query.eq("creator_id", ctx.viewerId);
  else if (filters.creator) query = query.eq("creator_id", filters.creator);

  if (filters.project === "none") query = query.is("project_id", null);
  else if (filters.project) query = query.eq("project_id", filters.project);

  if (filters.department) query = query.eq("department_id", filters.department);
  if (filters.label) query = query.eq("label_filter.label_id", filters.label);
  if (filters.blocked) query = query.eq("is_blocked", true);

  switch (filters.due) {
    case "overdue":
      query = query
        .neq("status", "done")
        .or(`due_date.lt.${ctx.today},and(due_date.eq.${ctx.today},due_time.lt.${ctx.nowTime})`);
      break;
    case "today":
      query = query.neq("status", "done").eq("due_date", ctx.today);
      break;
    case "week":
      query = query.neq("status", "done").gte("due_date", ctx.today).lte("due_date", addDaysIso(ctx.today, 7));
      break;
    case "none":
      query = query.is("due_date", null);
      break;
  }
  if (filters.due_from) query = query.gte("due_date", filters.due_from);
  if (filters.due_to) query = query.lte("due_date", filters.due_to);
  // Creation dates are interpreted in the workspace timezone.
  if (filters.created_from || filters.created_to) {
    const { fromTs, toTs } = dateRangeToTimestamps(
      filters.created_from ?? "1970-01-01",
      filters.created_to ?? "9999-12-30",
      ctx.timezone,
    );
    if (filters.created_from) query = query.gte("created_at", fromTs);
    if (filters.created_to) query = query.lt("created_at", toTs);
  }
  if (filters.completed_from || filters.completed_to) {
    const { fromTs, toTs } = dateRangeToTimestamps(
      filters.completed_from ?? "1970-01-01",
      filters.completed_to ?? "9999-12-30",
      ctx.timezone,
    );
    if (filters.completed_from) query = query.gte("completed_at", fromTs);
    if (filters.completed_to) query = query.lt("completed_at", toTs);
  }

  const ascending = sortDirection(filters) === "asc";
  query = query.order(SORT_COLUMN[filters.sort], { ascending, nullsFirst: false });
  if (filters.sort !== "key") query = query.order("number", { ascending: false });
  return query;
}

export async function fetchTaskPage(supabase: ServerSupabase, filters: TaskFilters, ctx: QueryContext) {
  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await buildTaskQuery(supabase, filters, ctx, { count: true }).range(
    from,
    from + PAGE_SIZE - 1,
  );
  if (error) {
    // Requesting a page past the end returns 416 / PGRST103: treat as empty.
    if (error.code === "PGRST103") return { rows: [] as TaskListRow[], total: count ?? 0 };
    throw new Error(`Could not load tasks: ${error.message}`);
  }
  return { rows: (data ?? []) as unknown as TaskListRow[], total: count ?? 0 };
}

/** Board view: up to `limit` matching tasks, without pagination. */
export async function fetchTasksForBoard(
  supabase: ServerSupabase,
  filters: TaskFilters,
  ctx: QueryContext,
  limit = 300,
) {
  const { data, error } = await buildTaskQuery(supabase, filters, ctx).limit(limit);
  if (error) throw new Error(`Could not load tasks: ${error.message}`);
  return (data ?? []) as unknown as TaskListRow[];
}

export function labelsOf(row: Pick<TaskListRow, "task_labels">) {
  return row.task_labels.map((tl) => tl.labels).filter((l): l is NonNullable<typeof l> => l !== null);
}
