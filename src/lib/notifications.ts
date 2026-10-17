import type { NotificationType } from "@/lib/tasks/constants";

type NotificationLike = {
  type: NotificationType;
  data: { key?: string; title?: string; excerpt?: string; note?: string };
  actor: { full_name: string; email: string } | null;
};

/** One-line, human-readable description of a notification. */
export function describeNotification(n: NotificationLike): { text: string; detail?: string } {
  const who = n.actor ? n.actor.full_name || n.actor.email : "Saunf";
  const task = n.data.key ? `${n.data.key}` : "a task";
  switch (n.type) {
    case "task_assigned":
      return { text: `${who} assigned you ${task}`, detail: n.data.note ?? n.data.title };
    case "task_reassigned":
      return { text: `${who} reassigned ${task} to you`, detail: n.data.note ?? n.data.title };
    case "collaborator_added":
      return { text: `${who} added you as a collaborator on ${task}`, detail: n.data.title };
    case "comment_added":
      return { text: `${who} commented on ${task}`, detail: n.data.excerpt };
    case "mentioned":
      return { text: `${who} mentioned you on ${task}`, detail: n.data.excerpt };
    case "task_due_soon":
      return { text: `${task} is due soon`, detail: n.data.title };
    case "task_overdue":
      return { text: `${task} is overdue`, detail: n.data.title };
    case "task_completed":
      return { text: `${who} completed ${task}`, detail: n.data.title };
    case "task_reopened":
      return { text: `${who} reopened ${task}`, detail: n.data.title };
    case "review_requested":
      return { text: `${who} moved ${task} to review`, detail: n.data.title };
  }
}
