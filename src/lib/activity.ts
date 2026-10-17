import { formatDueDate } from "@/lib/dates";
import {
  PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  ROLE_LABEL,
  STATUS_LABEL,
  type ProjectStatus,
  type TaskPriority,
  type TaskStatus,
  type WorkspaceRole,
} from "@/lib/tasks/constants";

export type ActivityEvent = {
  id: string;
  event_type: string;
  created_at: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  actor: { id: string; full_name: string; email: string } | null;
  task?: { key: string; title: string } | null;
  project?: { id: string; name: string } | null;
};

const FIELD_LABEL: Record<string, string> = {
  title: "title",
  description: "description",
  project: "project",
  department: "department",
  parent: "parent task",
  start_date: "start date",
  estimate: "estimate",
  name: "name",
  owner: "owner",
  status: "status",
  dates: "dates",
  visibility: "visibility",
  archived: "archive state",
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length ? v : null;
}

function listJoin(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function actorName(e: Pick<ActivityEvent, "actor">) {
  return e.actor ? e.actor.full_name || e.actor.email : "System";
}

function deadline(v: Record<string, unknown> | null) {
  const d = str(v?.due_date);
  return d ? formatDueDate(d, str(v?.due_time)) : "no due date";
}

/**
 * Describe an event as the phrase that follows the actor's name, e.g.
 * "changed the status from To do to In progress". `subject` names the task when the
 * event is shown outside the task page ("this task" otherwise).
 */
export function describeActivity(e: ActivityEvent, subject = "this task"): string {
  const o = e.old_value ?? {};
  const n = e.new_value ?? {};
  const m = e.metadata ?? {};
  switch (e.event_type) {
    case "task_created":
      return `created ${subject}`;
    case "task_assigned":
      return `assigned ${subject} to ${str(n.assignee_name) ?? "someone"}`;
    case "task_reassigned":
      return `reassigned ${subject} from ${str(o.assignee_name) ?? "someone"} to ${str(n.assignee_name) ?? "someone"}`;
    case "task_unassigned":
      return `unassigned ${str(o.assignee_name) ?? "the assignee"} from ${subject}`;
    case "status_changed":
      return `changed the status${subject === "this task" ? "" : ` of ${subject}`} from ${STATUS_LABEL[o.status as TaskStatus] ?? o.status} to ${STATUS_LABEL[n.status as TaskStatus] ?? n.status}`;
    case "priority_changed":
      return `changed the priority${subject === "this task" ? "" : ` of ${subject}`} from ${PRIORITY_LABEL[o.priority as TaskPriority] ?? o.priority} to ${PRIORITY_LABEL[n.priority as TaskPriority] ?? n.priority}`;
    case "deadline_changed":
      return `changed the due date${subject === "this task" ? "" : ` of ${subject}`} from ${deadline(o)} to ${deadline(n)}`;
    case "progress_changed":
      return `updated progress${subject === "this task" ? "" : ` on ${subject}`} from ${o.progress ?? 0}% to ${n.progress ?? 0}%`;
    case "task_blocked":
      return `marked ${subject} as blocked${str(n.blocker_description) ? `: “${str(n.blocker_description)}”` : ""}`;
    case "task_unblocked":
      return `cleared the blocker on ${subject}`;
    case "task_completed":
      return `completed ${subject}`;
    case "task_reopened":
      return `reopened ${subject} (${STATUS_LABEL[n.status as TaskStatus] ?? n.status})`;
    case "task_archived":
      return `archived ${subject}`;
    case "task_restored":
      return `restored ${subject}`;
    case "task_edited": {
      const fields = Array.isArray(m.fields) ? (m.fields as string[]) : [];
      if (fields.length === 1 && fields[0] === "title") {
        return `renamed ${subject} from “${str(o.title)}” to “${str(n.title)}”`;
      }
      if (fields.length === 1 && fields[0] === "project") {
        return `moved ${subject} ${str(n.project) ? `to ${str(n.project)}` : "out of its project"}`;
      }
      return `edited the ${listJoin(fields.map((f) => FIELD_LABEL[f] ?? f))}${subject === "this task" ? "" : ` of ${subject}`}`;
    }
    case "collaborator_added":
      return `added ${str(m.name) ?? "someone"} as a collaborator${subject === "this task" ? "" : ` on ${subject}`}`;
    case "collaborator_removed":
      return `removed collaborator ${str(m.name) ?? "someone"}${subject === "this task" ? "" : ` from ${subject}`}`;
    case "label_added":
      return `added the label “${str(m.name) ?? "label"}”${subject === "this task" ? "" : ` to ${subject}`}`;
    case "label_removed":
      return `removed the label “${str(m.name) ?? "label"}”${subject === "this task" ? "" : ` from ${subject}`}`;
    case "dependency_added":
      return `marked ${subject} as blocked by ${str(m.key) ?? "another task"}`;
    case "dependency_removed":
      return `removed the dependency on ${str(m.key) ?? "another task"}`;
    case "comment_added":
      return `commented on ${subject}`;
    case "comment_edited":
      return `edited a comment on ${subject}`;
    case "comment_deleted":
      return `deleted a comment on ${subject}`;
    case "attachment_added":
      return `attached ${str(m.file_name) ?? "a file"}${subject === "this task" ? "" : ` to ${subject}`}`;
    case "attachment_removed":
      return `removed the attachment ${str(m.file_name) ?? "a file"}${subject === "this task" ? "" : ` from ${subject}`}`;
    case "project_created":
      return `created the project ${str(n.name) ?? ""}`.trim();
    case "project_updated": {
      const fields = Array.isArray(m.fields) ? (m.fields as string[]) : [];
      if (fields.length === 1 && fields[0] === "status") {
        return `changed the project status to ${PROJECT_STATUS_LABEL[n.status as ProjectStatus] ?? n.status}`;
      }
      return `updated the project ${listJoin(fields.map((f) => FIELD_LABEL[f] ?? f))}`;
    }
    case "project_member_added":
      return `added ${str(m.name) ?? "someone"} to the project${m.role === "lead" ? " as a lead" : ""}`;
    case "project_member_removed":
      return `removed ${str(m.name) ?? "someone"} from the project`;
    case "member_joined":
      return `${str(m.name) ?? "A new member"} joined the workspace as ${ROLE_LABEL[n.role as WorkspaceRole] ?? n.role}`;
    case "member_role_changed":
      return `changed ${str(m.name) ?? "a member"}'s role from ${ROLE_LABEL[o.role as WorkspaceRole] ?? o.role} to ${ROLE_LABEL[n.role as WorkspaceRole] ?? n.role}`;
    case "member_department_changed":
      return `moved ${str(m.name) ?? "a member"} ${str(n.department) ? `to ${str(n.department)}` : "out of their department"}`;
    case "member_deactivated":
      return `deactivated ${str(m.name) ?? "a member"}`;
    case "member_reactivated":
      return `reactivated ${str(m.name) ?? "a member"}`;
    case "invitation_sent":
      return `invited ${str(n.email) ?? "someone"} as ${ROLE_LABEL[n.role as WorkspaceRole] ?? n.role}`;
    case "invitation_revoked":
      return `revoked the invitation for ${str(m.email) ?? "someone"}`;
    case "department_created":
      return `created the department ${str(n.name) ?? ""}`.trim();
    case "department_updated":
      return `updated the department ${str(n.name) ?? ""}`.trim();
    case "department_deleted":
      return `deleted the department ${str(o.name) ?? ""}`.trim();
    case "settings_updated":
      return `updated workspace settings (${listJoin(Object.keys(n).map((k) => k.replaceAll("_", " ")))})`;
    default:
      return e.event_type.replaceAll("_", " ");
  }
}

/** Events where the actor is not the grammatical subject (e.g. "X joined the workspace"). */
export function isSelfDescribing(eventType: string) {
  return eventType === "member_joined";
}
