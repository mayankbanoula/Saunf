// UI-side mirror of the database permission rules (docs/SECURITY.md). Used ONLY to
// decide which controls to show; Postgres RLS and triggers are the real gate.
import type { AssignmentPolicy, WorkspaceRole } from "@/lib/tasks/constants";

export type PermissionViewer = {
  id: string;
  role: WorkspaceRole;
  departmentId: string | null;
  managedDepartmentIds?: string[];
  assignmentPolicy: AssignmentPolicy;
};

export type MemberLite = { id: string; department_id: string | null; is_active?: boolean };

export function canAssignTo(viewer: PermissionViewer, target: MemberLite | null): boolean {
  if (!target) return true;
  if (target.is_active === false) return false;
  if (viewer.role !== "employee" || target.id === viewer.id) return true;
  switch (viewer.assignmentPolicy) {
    case "anyone":
      return true;
    case "department":
      return viewer.departmentId !== null && viewer.departmentId === target.department_id;
    case "self":
      return false;
  }
}

export function assignableMembers<T extends MemberLite>(viewer: PermissionViewer, members: T[]): T[] {
  return members.filter((m) => canAssignTo(viewer, m));
}

export type TaskForPermission = {
  creator_id: string | null;
  assignee_id: string | null;
  department_id: string | null;
  archived_at: string | null;
  collaborator_ids: string[];
  creator_department_id?: string | null;
  assignee_department_id?: string | null;
  is_project_manager?: boolean;
};

function inManagerScope(viewer: PermissionViewer, task: TaskForPermission) {
  if (viewer.role !== "manager") return false;
  const depts = new Set([...(viewer.managedDepartmentIds ?? []), ...(viewer.departmentId ? [viewer.departmentId] : [])]);
  return [task.department_id, task.creator_department_id, task.assignee_department_id].some(
    (d) => d != null && depts.has(d),
  );
}

export function canEditTask(viewer: PermissionViewer, task: TaskForPermission) {
  return (
    viewer.role === "admin" ||
    task.creator_id === viewer.id ||
    Boolean(task.is_project_manager) ||
    inManagerScope(viewer, task)
  );
}

export function canWorkTask(viewer: PermissionViewer, task: TaskForPermission) {
  return (
    canEditTask(viewer, task) ||
    task.assignee_id === viewer.id ||
    task.collaborator_ids.includes(viewer.id)
  );
}

export function canReassignTask(viewer: PermissionViewer, task: TaskForPermission) {
  return canEditTask(viewer, task) || task.assignee_id === viewer.id;
}

export function taskPermissions(viewer: PermissionViewer, task: TaskForPermission) {
  const archived = task.archived_at !== null;
  const edit = canEditTask(viewer, task);
  return {
    edit: edit && !archived,
    work: canWorkTask(viewer, task) && !archived,
    reassign: canReassignTask(viewer, task) && !archived,
    archive: edit && !archived,
    restore: edit && archived,
    comment: !archived,
  };
}
