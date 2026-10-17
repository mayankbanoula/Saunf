"use client";

import { Loader2Icon, UserRoundPenIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { assignTask, updateTask } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/form";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/overlays";
import { Progress } from "@/components/ui/primitives";
import { assignableMembers, type PermissionViewer } from "@/lib/permissions";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/constants";
import type { UpdateTaskInput } from "@/lib/validation/task";

/**
 * Optimistic field: shows the new value immediately; if the server rejects it the
 * transition ends without new server props, so React rolls the value back.
 */
function useOptimisticField<T>(serverValue: T) {
  const [value, setOptimistic] = React.useOptimistic(serverValue);
  const [pending, startTransition] = React.useTransition();
  const commit = (next: T, run: () => Promise<{ ok: boolean; error?: string }>, success?: string) => {
    startTransition(async () => {
      setOptimistic(next);
      const res = await run();
      if (!res.ok) toast.error(res.error ?? "Update failed");
      else if (success) toast.success(success);
    });
  };
  return { value, pending, commit };
}

/** Reset local draft state when the server value changes (React's "adjust state during render"). */
function useDraft<T>(serverValue: T) {
  const [draft, setDraft] = React.useState(serverValue);
  const [seen, setSeen] = React.useState(serverValue);
  if (!Object.is(seen, serverValue)) {
    setSeen(serverValue);
    setDraft(serverValue);
  }
  return [draft, setDraft] as const;
}

export function StatusControl({ taskId, status, disabled }: { taskId: string; status: TaskStatus; disabled: boolean }) {
  const { value, pending, commit } = useOptimisticField(status);
  return (
    <div className="flex items-center gap-2">
      <NativeSelect
        aria-label="Status"
        value={value}
        disabled={disabled || pending}
        onChange={(e) => {
          const next = e.target.value as TaskStatus;
          commit(next, () => updateTask(taskId, { status: next }), `Status changed to ${STATUS_LABEL[next]}`);
        }}
        className="h-8"
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </NativeSelect>
      {pending ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
    </div>
  );
}

export function PriorityControl({
  taskId,
  priority,
  disabled,
}: {
  taskId: string;
  priority: TaskPriority;
  disabled: boolean;
}) {
  const { value, pending, commit } = useOptimisticField(priority);
  return (
    <NativeSelect
      aria-label="Priority"
      value={value}
      disabled={disabled || pending}
      onChange={(e) => {
        const next = e.target.value as TaskPriority;
        commit(next, () => updateTask(taskId, { priority: next }), `Priority set to ${PRIORITY_LABEL[next]}`);
      }}
      className="h-8"
    >
      {TASK_PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {PRIORITY_LABEL[p]}
        </option>
      ))}
    </NativeSelect>
  );
}

export function DueDateControl({
  taskId,
  dueDate,
  dueTime,
  startDate,
  disabled,
}: {
  taskId: string;
  dueDate: string | null;
  dueTime: string | null;
  startDate: string | null;
  disabled: boolean;
}) {
  const [date, setDate] = useDraft(dueDate ?? "");
  const [time, setTime] = useDraft(dueTime?.slice(0, 5) ?? "");
  const [pending, startTransition] = React.useTransition();

  const save = (nextDate: string, nextTime: string) => {
    const patch: UpdateTaskInput = { due_date: nextDate || null, due_time: nextDate ? nextTime || null : null };
    if (startDate && nextDate && nextDate < startDate) {
      toast.error("Due date cannot be before the start date");
      setDate(dueDate ?? "");
      return;
    }
    startTransition(async () => {
      const res = await updateTask(taskId, patch);
      if (!res.ok) {
        toast.error(res.error);
        setDate(dueDate ?? "");
        setTime(dueTime?.slice(0, 5) ?? "");
      } else toast.success("Deadline updated");
    });
  };

  return (
    <div className="grid grid-cols-[minmax(8.5rem,1fr)_6.5rem] gap-1.5">
      <Input
        type="date"
        aria-label="Due date"
        className="h-8"
        value={date}
        min={startDate ?? undefined}
        disabled={disabled || pending}
        onChange={(e) => setDate(e.target.value)}
        onBlur={() => date !== (dueDate ?? "") && save(date, time)}
      />
      <Input
        type="time"
        aria-label="Due time"
        className="h-8"
        value={time}
        disabled={disabled || pending || !date}
        onChange={(e) => setTime(e.target.value)}
        onBlur={() => time !== (dueTime?.slice(0, 5) ?? "") && save(date, time)}
      />
    </div>
  );
}

export function ProgressControl({
  taskId,
  progress,
  disabled,
}: {
  taskId: string;
  progress: number;
  disabled: boolean;
}) {
  const { value, pending, commit } = useOptimisticField(progress);
  const [draft, setDraft] = useDraft(value);
  const save = () => {
    if (draft === value) return;
    commit(draft, () => updateTask(taskId, { progress: draft }), `Progress updated to ${draft}%`);
  };
  if (disabled) {
    return (
      <div className="flex items-center gap-2">
        <Progress value={value} aria-label={`${value}% complete`} />
        <span className="w-10 text-right text-sm">{value}%</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={draft}
        aria-label="Progress"
        disabled={pending}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={save}
        onKeyUp={(e) => (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") && save()}
        className="h-1.5 flex-1 cursor-pointer accent-[var(--primary)]"
      />
      <span className="w-10 text-right text-sm tabular-nums">{draft}%</span>
    </div>
  );
}

export function BlockedControl({
  taskId,
  isBlocked,
  description,
  disabled,
}: {
  taskId: string;
  isBlocked: boolean;
  description: string | null;
  disabled: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(description ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const submit = (blocked: boolean) =>
    startTransition(async () => {
      const res = await updateTask(taskId, {
        is_blocked: blocked,
        blocker_description: blocked ? text.trim() || null : null,
      });
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success(blocked ? "Marked as blocked" : "Blocker cleared");
    });

  return (
    <>
      <div className="flex items-center gap-2">
        <Switch
          id="blocked-switch"
          checked={isBlocked}
          disabled={disabled || pending}
          onCheckedChange={(c) => (c ? setOpen(true) : submit(false))}
          aria-label="Blocked"
        />
        <label htmlFor="blocked-switch" className="text-sm">
          {isBlocked ? "Blocked" : "Not blocked"}
        </label>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as blocked</DialogTitle>
            <DialogDescription>
              The task keeps its status. Describe what&apos;s blocking it so others can help.
            </DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <Field label="What's blocking this task?" htmlFor="blocker">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => submit(true)} disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : null} Mark blocked
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ReassignButton({
  taskId,
  currentAssigneeId,
  members,
  viewer,
}: {
  taskId: string;
  currentAssigneeId: string | null;
  members: { id: string; full_name: string; department_id: string | null }[];
  viewer: PermissionViewer;
}) {
  const [open, setOpen] = React.useState(false);
  const [assignee, setAssignee] = React.useState(currentAssigneeId ?? "");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const options = assignableMembers(viewer, members);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const res = await assignTask({ task_id: taskId, assignee_id: assignee || null, note: note.trim() || undefined });
      if (!res.ok) return setError(res.error);
      toast.success(assignee ? "Task reassigned" : "Task unassigned");
      setOpen(false);
      setNote("");
    });

  return (
    <>
      <Button variant="outline" size="xs" onClick={() => setOpen(true)}>
        <UserRoundPenIcon /> {currentAssigneeId ? "Reassign" : "Assign"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{currentAssigneeId ? "Reassign task" : "Assign task"}</DialogTitle>
            <DialogDescription>The change is recorded in the assignment history.</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <Field label="Assignee" htmlFor="reassign-to">
            <NativeSelect value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Unassigned</option>
              {options.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                  {m.id === viewer.id ? " (me)" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Reason or note" htmlFor="reassign-note" hint="Optional.">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || assignee === (currentAssigneeId ?? "")}>
              {pending ? <Loader2Icon className="animate-spin" /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
