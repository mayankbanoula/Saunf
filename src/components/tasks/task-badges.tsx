import { AlertOctagonIcon, ArrowDownIcon, ArrowUpIcon, ChevronsUpIcon, EqualIcon } from "lucide-react";

import { dueTone, formatDueDate } from "@/lib/dates";
import {
  PRIORITY_LABEL,
  PRIORITY_TEXT,
  STATUS_DOT,
  STATUS_LABEL,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/constants";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border bg-card px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      <span className={cn("size-2 rounded-full", STATUS_DOT[status])} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

const PRIORITY_ICON = { low: ArrowDownIcon, medium: EqualIcon, high: ArrowUpIcon, urgent: ChevronsUpIcon };

export function PriorityBadge({
  priority,
  className,
  iconOnly = false,
}: {
  priority: TaskPriority;
  className?: string;
  iconOnly?: boolean;
}) {
  const Icon = PRIORITY_ICON[priority];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap",
        PRIORITY_TEXT[priority],
        className,
      )}
      title={`${PRIORITY_LABEL[priority]} priority`}
    >
      <Icon className="size-3.5" aria-hidden />
      {iconOnly ? <span className="sr-only">{PRIORITY_LABEL[priority]}</span> : PRIORITY_LABEL[priority]}
    </span>
  );
}

const DUE_CLASSES = {
  overdue: "text-destructive font-medium",
  today: "text-[oklch(0.5_0.13_60)] font-medium dark:text-[oklch(0.82_0.13_70)]",
  soon: "text-foreground",
  later: "text-muted-foreground",
  done: "text-muted-foreground",
  none: "text-muted-foreground",
};

export function DueDate({
  task,
  today,
  nowTime,
  className,
}: {
  task: { status: string; due_date: string | null; due_time: string | null };
  today: string;
  nowTime: string;
  className?: string;
}) {
  if (!task.due_date) return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  const tone = dueTone(task, today, nowTime);
  return (
    <span className={cn("text-xs whitespace-nowrap", DUE_CLASSES[tone], className)}>
      {formatDueDate(task.due_date, task.due_time, today)}
      {tone === "overdue" ? <span className="sr-only"> (overdue)</span> : null}
    </span>
  );
}

export function BlockedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive",
        className,
      )}
    >
      <AlertOctagonIcon className="size-3" aria-hidden /> Blocked
    </span>
  );
}

export function LabelChip({ label }: { label: { name: string; color: string } }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] whitespace-nowrap">
      <span className="size-2 rounded-full" style={{ background: label.color }} aria-hidden />
      {label.name}
    </span>
  );
}
