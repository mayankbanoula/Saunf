"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { setTaskStatus } from "@/actions/tasks";
import { BlockedBadge, DueDate, LabelChip, PriorityBadge } from "@/components/tasks/task-badges";
import { UserAvatar } from "@/components/ui/primitives";
import { PRIORITY_RANK, STATUS_DOT, STATUS_LABEL, TASK_STATUSES, type TaskStatus } from "@/lib/tasks/constants";
import type { TaskListRow } from "@/lib/tasks/queries";
import { cn, displayName } from "@/lib/utils";

export function TaskBoard({
  rows,
  today,
  nowTime,
  truncated,
}: {
  rows: TaskListRow[];
  today: string;
  nowTime: string;
  truncated: boolean;
}) {
  const [tasks, setTasks] = React.useState(rows);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const dndId = React.useId(); // stable ids across SSR and hydration
  // Re-sync when the server sends fresh data (after refresh / filter change).
  React.useEffect(() => setTasks(rows), [rows]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const byStatus = React.useMemo(() => {
    const groups: Record<TaskStatus, TaskListRow[]> = { todo: [], in_progress: [], in_review: [], done: [] };
    for (const t of tasks) groups[t.status].push(t);
    for (const s of TASK_STATUSES) {
      groups[s].sort(
        (a, b) =>
          PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
          (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
      );
    }
    return groups;
  }, [tasks]);

  const active = activeId ? tasks.find((t) => t.id === activeId) : null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const id = String(e.active.id);
    const to = e.over?.id as TaskStatus | undefined;
    const task = tasks.find((t) => t.id === id);
    if (!task || !to || task.status === to) return;

    const previous = tasks;
    // Optimistic update, mirroring the database's completion rules.
    setTasks((list) =>
      list.map((t) =>
        t.id === id
          ? { ...t, status: to, progress: to === "done" ? 100 : t.status === "done" && t.progress === 100 ? (to === "todo" ? 0 : 90) : t.progress }
          : t,
      ),
    );
    const res = await setTaskStatus(id, to);
    if (!res.ok) {
      setTasks(previous);
      toast.error(`${task.key}: ${res.error}`);
    } else {
      toast.success(`${task.key} moved to ${STATUS_LABEL[to]}`);
    }
  }

  return (
    <>
      {truncated ? (
        <p className="mb-2 text-xs text-muted-foreground">
          Showing the first {rows.length} matching tasks. Narrow the filters to see the rest.
        </p>
      ) : null}
      <DndContext id={dndId} sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 lg:grid-flow-row lg:grid-cols-4">
          {TASK_STATUSES.map((status) => (
            <Column key={status} status={status} count={byStatus[status].length}>
              {byStatus[status].map((t) => (
                <DraggableCard key={t.id} task={t} today={today} nowTime={nowTime} />
              ))}
            </Column>
          ))}
        </div>
        <DragOverlay>{active ? <Card task={active} today={today} nowTime={nowTime} dragging /> : null}</DragOverlay>
      </DndContext>
    </>
  );
}

function Column({ status, count, children }: { status: TaskStatus; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${STATUS_LABEL[status]} column`}
      className={cn(
        "flex min-h-[50vh] flex-col rounded-lg border bg-muted/50 transition-colors",
        isOver && "border-primary/50 bg-accent/60",
      )}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className={cn("size-2 rounded-full", STATUS_DOT[status])} aria-hidden />
        <h2 className="text-sm font-semibold">{STATUS_LABEL[status]}</h2>
        <span className="ml-auto rounded bg-card px-1.5 text-xs text-muted-foreground">{count}</span>
      </header>
      <div className="flex flex-1 flex-col gap-2 px-2 pb-2">{children}</div>
    </section>
  );
}

function DraggableCard({ task, today, nowTime }: { task: TaskListRow; today: string; nowTime: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn("touch-none", isDragging && "opacity-30")}>
      <Card task={task} today={today} nowTime={nowTime} />
    </div>
  );
}

function Card({ task, today, nowTime, dragging }: { task: TaskListRow; today: string; nowTime: string; dragging?: boolean }) {
  const labels = task.task_labels.map((tl) => tl.labels).filter((l) => l !== null);
  return (
    <article className={cn("rounded-md border bg-card p-2.5 shadow-xs", dragging && "rotate-1 shadow-lg")}>
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{task.key}</span>
        <PriorityBadge priority={task.priority} iconOnly className="ml-auto" />
      </div>
      <Link
        href={`/tasks/${task.key}`}
        className="line-clamp-2 text-sm font-medium hover:text-primary hover:underline"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {task.title}
      </Link>
      {labels.length || task.is_blocked ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.is_blocked ? <BlockedBadge /> : null}
          {labels.slice(0, 3).map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <DueDate task={task} today={today} nowTime={nowTime} />
        {task.progress > 0 && task.status !== "done" ? (
          <span className="text-xs text-muted-foreground">{task.progress}%</span>
        ) : null}
        <span className="ml-auto">
          {task.assignee ? (
            <UserAvatar size="sm" name={displayName(task.assignee)} id={task.assignee.id} />
          ) : (
            <span className="text-[11px] text-muted-foreground">Unassigned</span>
          )}
        </span>
      </div>
    </article>
  );
}
