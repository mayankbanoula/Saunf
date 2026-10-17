import type { Database } from "@/lib/database.types";

export type TaskStatus = Database["public"]["Enums"]["task_status"];
export type TaskPriority = Database["public"]["Enums"]["task_priority"];
export type WorkspaceRole = Database["public"]["Enums"]["workspace_role"];
export type ProjectStatus = Database["public"]["Enums"]["project_status"];
export type NotificationType = Database["public"]["Enums"]["notification_type"];
export type AssignmentPolicy = Database["public"]["Enums"]["assignment_policy"];
export type TaskVisibility = Database["public"]["Enums"]["task_visibility"];

export const TASK_STATUSES = ["todo", "in_progress", "in_review", "done"] as const satisfies readonly TaskStatus[];
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const satisfies readonly TaskPriority[];
export const WORKSPACE_ROLES = ["admin", "manager", "employee"] as const satisfies readonly WorkspaceRole[];
export const PROJECT_STATUSES = [
  "planning",
  "active",
  "on_hold",
  "completed",
  "cancelled",
] as const satisfies readonly ProjectStatus[];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, medium: 1, high: 2, urgent: 3 };

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "Planning",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const ASSIGNMENT_POLICY_LABEL: Record<AssignmentPolicy, string> = {
  anyone: "Employees can assign tasks to anyone",
  department: "Employees can assign within their department",
  self: "Employees can only assign tasks to themselves",
};

export const VISIBILITY_LABEL: Record<TaskVisibility, string> = {
  all: "Everyone can see all tasks (except private projects)",
  participants: "Employees see only tasks they are involved in",
};

export const STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-status-todo",
  in_progress: "bg-status-in-progress",
  in_review: "bg-status-in-review",
  done: "bg-status-done",
};

export const PRIORITY_TEXT: Record<TaskPriority, string> = {
  low: "text-priority-low",
  medium: "text-priority-medium",
  high: "text-priority-high",
  urgent: "text-priority-urgent",
};

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
] as const;
export const ATTACHMENT_BUCKET = "task-attachments";

export const PAGE_SIZE = 25;
