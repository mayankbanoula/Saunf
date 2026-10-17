import "server-only";

import type { ActivityEvent } from "@/lib/activity";
import type { Viewer } from "@/lib/auth/session";
import { taskPermissions, type PermissionViewer } from "@/lib/permissions";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { TaskPriority, TaskStatus } from "@/lib/tasks/constants";

type Person = { id: string; full_name: string; email: string };

const DETAIL_SELECT = `*,
  assignee:profiles!tasks_assignee_profile_fkey(id, full_name, email),
  creator:profiles!tasks_creator_profile_fkey(id, full_name, email),
  assigned_by_profile:profiles!tasks_assigned_by_fkey(id, full_name, email),
  completed_by_profile:profiles!tasks_completed_by_fkey(id, full_name, email),
  archived_by_profile:profiles!tasks_archived_by_fkey(id, full_name, email),
  project:projects!tasks_workspace_id_project_id_fkey(id, name, owner_id),
  department:departments!tasks_workspace_id_department_id_fkey(id, name),
  task_collaborators(user_id, profile:profiles!task_collaborators_profile_fkey(id, full_name, email)),
  task_labels(labels(id, name, color))`;

export type TaskDetail = Awaited<ReturnType<typeof getTaskDetail>>;

export async function getTaskDetail(supabase: ServerSupabase, viewer: Viewer, key: string) {
  const { data: task, error } = await supabase
    .from("tasks")
    .select(DETAIL_SELECT)
    .eq("key", key.toUpperCase())
    .maybeSingle();
  if (error) throw new Error(`Could not load task: ${error.message}`);
  if (!task) return null;

  const [
    subtasks,
    blockedBy,
    blocking,
    comments,
    attachments,
    activity,
    assignments,
    managed,
    depts,
    projectRole,
    parent,
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, key, title, status, priority, progress, assignee:profiles!tasks_assignee_profile_fkey(id, full_name, email)",
      )
      .eq("parent_id", task.id)
      .is("archived_at", null)
      .order("number"),
    supabase
      .from("task_dependencies")
      .select(
        "depends_on_task_id, task:tasks!task_dependencies_workspace_id_depends_on_task_id_fkey(id, key, title, status)",
      )
      .eq("task_id", task.id),
    supabase
      .from("task_dependencies")
      .select("task_id, task:tasks!task_dependencies_workspace_id_task_id_fkey(id, key, title, status)")
      .eq("depends_on_task_id", task.id),
    supabase
      .from("task_comments")
      .select(
        "id, body, created_at, edited_at, deleted_at, mentioned_user_ids, author:profiles!task_comments_author_id_fkey(id, full_name, email)",
      )
      .eq("task_id", task.id)
      .order("created_at"),
    supabase
      .from("task_attachments")
      .select(
        "id, file_name, mime_type, size_bytes, created_at, uploaded_by, uploader:profiles!task_attachments_uploaded_by_fkey(id, full_name, email)",
      )
      .eq("task_id", task.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("activity_events")
      .select(
        "id, event_type, created_at, old_value, new_value, metadata, actor:profiles!activity_events_actor_id_fkey(id, full_name, email)",
      )
      .eq("task_id", task.id)
      .order("created_at")
      .limit(500),
    supabase
      .from("task_assignments")
      .select(
        "id, changed_at, note, previous:profiles!task_assignments_previous_assignee_id_fkey(id, full_name, email), next:profiles!task_assignments_new_assignee_id_fkey(id, full_name, email), by:profiles!task_assignments_changed_by_fkey(id, full_name, email)",
      )
      .eq("task_id", task.id)
      .order("changed_at"),
    supabase.from("departments").select("id").eq("manager_id", viewer.id),
    supabase
      .from("workspace_members")
      .select("user_id, department_id")
      .eq("workspace_id", viewer.workspaceId)
      .in(
        "user_id",
        [task.creator_id, task.assignee_id].filter((x): x is string => !!x),
      ),
    task.project_id
      ? supabase
          .from("project_members")
          .select("role")
          .eq("project_id", task.project_id)
          .eq("user_id", viewer.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    task.parent_id
      ? supabase.from("tasks").select("id, key, title, status").eq("id", task.parent_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const deptOf = (uid: string | null) => depts.data?.find((d) => d.user_id === uid)?.department_id ?? null;
  const permViewer: PermissionViewer = {
    id: viewer.id,
    role: viewer.role,
    departmentId: viewer.departmentId,
    managedDepartmentIds: (managed.data ?? []).map((d) => d.id),
    assignmentPolicy: viewer.settings.assignment_policy,
  };
  const collaborators = (task.task_collaborators ?? []).map((c) => c.profile).filter((p): p is Person => p !== null);
  const permissions = taskPermissions(permViewer, {
    creator_id: task.creator_id,
    assignee_id: task.assignee_id,
    department_id: task.department_id,
    archived_at: task.archived_at,
    collaborator_ids: collaborators.map((c) => c.id),
    creator_department_id: deptOf(task.creator_id),
    assignee_department_id: deptOf(task.assignee_id),
    is_project_manager: task.project?.owner_id === viewer.id || projectRole.data?.role === "lead",
  });

  return {
    task: {
      ...task,
      status: task.status as TaskStatus,
      priority: task.priority as TaskPriority,
      collaborators,
      parent: parent.data,
      labels: (task.task_labels ?? []).map((tl) => tl.labels).filter((l) => l !== null),
    },
    subtasks: subtasks.data ?? [],
    blockedBy: (blockedBy.data ?? []).map((d) => d.task).filter((t) => t !== null),
    blocking: (blocking.data ?? []).map((d) => d.task).filter((t) => t !== null),
    comments: comments.data ?? [],
    attachments: attachments.data ?? [],
    activity: (activity.data ?? []) as unknown as ActivityEvent[],
    assignments: assignments.data ?? [],
    permissions,
    permViewer,
  };
}
