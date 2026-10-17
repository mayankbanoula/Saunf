"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { createLabel, createTask, getTaskFormOptions, updateTask, type TaskFormOptions } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/form";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Skeleton } from "@/components/ui/primitives";
import { assignableMembers } from "@/lib/permissions";
import { PRIORITY_LABEL, STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/constants";
import { createTaskSchema } from "@/lib/validation/task";

type FormInput = z.input<typeof createTaskSchema>;
type FormOutput = z.output<typeof createTaskSchema>;

export type EditableTask = {
  id: string;
  key: string;
  title: string;
  description: string;
  status: FormOutput["status"];
  priority: FormOutput["priority"];
  progress: number;
  assignee_id: string | null;
  project_id: string | null;
  department_id: string | null;
  parent_id: string | null;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  estimate_hours: number | null;
  label_ids: string[];
  collaborator_ids: string[];
};

export type TaskFormDefaults = Partial<Pick<EditableTask, "project_id" | "parent_id" | "assignee_id" | "due_date" | "status">> & {
  parentKey?: string;
};

function useTaskFormOptions(open: boolean) {
  const [options, setOptions] = React.useState<TaskFormOptions | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getTaskFormOptions().then((res) => {
      if (cancelled) return;
      if (res.ok) setOptions(res.data);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);
  return { options, setOptions, error };
}

export function TaskFormDialog({
  open,
  onOpenChange,
  task,
  defaults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: EditableTask;
  defaults?: TaskFormDefaults;
}) {
  const { options, setOptions, error } = useTaskFormOptions(open);
  const mode = task ? "edit" : "create";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? `Edit ${task!.key}` : defaults?.parentKey ? `New subtask of ${defaults.parentKey}` : "New task"}</DialogTitle>
          <DialogDescription>
            {mode === "edit" ? "Changes are recorded in the task's activity history." : "Fields marked * are required."}
          </DialogDescription>
        </DialogHeader>
        {error ? <FormError message={error} /> : null}
        {!options && !error ? (
          <div className="grid gap-3">
            <Skeleton className="h-9" />
            <Skeleton className="h-24" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          </div>
        ) : null}
        {options ? (
          options.viewer.canCreate || mode === "edit" ? (
            <TaskForm
              key={task?.id ?? "new"}
              options={options}
              onLabelCreated={(label) =>
                setOptions((o) => (o ? { ...o, labels: [...o.labels, label].sort((a, b) => a.name.localeCompare(b.name)) } : o))
              }
              task={task}
              defaults={defaults}
              onDone={() => onOpenChange(false)}
            />
          ) : (
            <FormError message="Your workspace settings don't allow you to create tasks. Ask an admin or manager." />
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  options,
  task,
  defaults,
  onDone,
  onLabelCreated,
}: {
  options: TaskFormOptions;
  task?: EditableTask;
  defaults?: TaskFormDefaults;
  onDone: () => void;
  onLabelCreated: (label: { id: string; name: string; color: string }) => void;
}) {
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const viewer = options.viewer;
  const assignable = assignableMembers(
    { ...viewer, assignmentPolicy: viewer.assignmentPolicy },
    options.members,
  );
  // Keep the current assignee selectable even if policy wouldn't allow picking them now.
  const assigneeOptions =
    task?.assignee_id && !assignable.some((m) => m.id === task.assignee_id)
      ? [...assignable, ...options.members.filter((m) => m.id === task.assignee_id)]
      : assignable;

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: {
      title: task?.title ?? "",
      description: task?.description ?? "",
      status: task?.status ?? defaults?.status ?? viewer.defaultStatus,
      priority: task?.priority ?? viewer.defaultPriority,
      assignee_id: task ? (task.assignee_id ?? "") : (defaults?.assignee_id ?? (viewer.assignmentPolicy === "self" && viewer.role === "employee" ? viewer.id : "")),
      project_id: task?.project_id ?? defaults?.project_id ?? "",
      department_id: task?.department_id ?? "",
      parent_id: task?.parent_id ?? defaults?.parent_id ?? null,
      start_date: task?.start_date ?? "",
      due_date: task?.due_date ?? defaults?.due_date ?? "",
      due_time: task?.due_time?.slice(0, 5) ?? "",
      estimate_hours: task?.estimate_hours ?? "",
      label_ids: task?.label_ids ?? [],
      collaborator_ids: task?.collaborator_ids ?? [],
      note: "",
    },
  });
  const { register, handleSubmit, formState, control, watch } = form;
  const errors = formState.errors;
  const assigneeChanged = watch("assignee_id") !== (task?.assignee_id ?? "");

  async function onSubmit(values: FormOutput) {
    setServerError(null);
    const { label_ids, collaborator_ids, note, ...fields } = values;
    if (task) {
      const res = await updateTask(task.id, fields, { label_ids, collaborator_ids, note: note || undefined });
      if (!res.ok) return setServerError(res.error);
      toast.success(`${task.key} updated`);
      onDone();
      return;
    }
    const res = await createTask(values);
    if (!res.ok) return setServerError(res.error);
    toast.success(`${res.data.key} created`, {
      action: { label: "Open", onClick: () => router.push(`/tasks/${res.data.key}`) },
    });
    onDone();
  }

  const memberOptions = options.members
    .filter((m) => m.id !== watch("assignee_id"))
    .map((m) => ({ value: m.id, label: m.full_name, hint: m.email }));

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
      <FormError message={serverError} />
      <Field label="Title" htmlFor="task-title" error={errors.title?.message} required>
        <Input {...register("title")} autoFocus placeholder="What needs to be done?" maxLength={200} />
      </Field>
      <Field label="Description" htmlFor="task-description" error={errors.description?.message}>
        <Textarea {...register("description")} rows={4} placeholder="Add context, acceptance criteria, links…" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Assignee"
          htmlFor="task-assignee"
          error={errors.assignee_id?.message}
          hint={viewer.role === "employee" && viewer.assignmentPolicy !== "anyone" ? "Limited by workspace policy." : undefined}
        >
          <NativeSelect {...register("assignee_id")}>
            <option value="">Unassigned</option>
            {assigneeOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
                {m.id === viewer.id ? " (me)" : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Project" htmlFor="task-project" error={errors.project_id?.message}>
          <NativeSelect {...register("project_id")}>
            <option value="">No project</option>
            {options.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {!task ? (
          <Field label="Status" htmlFor="task-status">
            <NativeSelect {...register("status")}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        <Field label="Priority" htmlFor="task-priority">
          <NativeSelect {...register("priority")}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Start date" htmlFor="task-start" error={errors.start_date?.message}>
          <Input type="date" {...register("start_date")} />
        </Field>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <Field label="Due date" htmlFor="task-due" error={errors.due_date?.message}>
            <Input type="date" {...register("due_date")} />
          </Field>
          <Field label="Time" htmlFor="task-due-time" error={errors.due_time?.message}>
            <Input type="time" {...register("due_time")} />
          </Field>
        </div>
        <Field label="Department" htmlFor="task-department" hint={!task ? "Defaults to the assignee's department." : undefined}>
          <NativeSelect {...register("department_id")}>
            <option value="">{task ? "None" : "Automatic"}</option>
            {options.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Estimate (hours)" htmlFor="task-estimate" error={errors.estimate_hours?.message}>
          <Input type="number" step="0.5" min="0" inputMode="decimal" {...register("estimate_hours")} />
        </Field>
      </div>

      <Field label="Labels" htmlFor="task-labels">
        <Controller
          control={control}
          name="label_ids"
          render={({ field }) => (
            <MultiSelect
              options={options.labels.map((l) => ({ value: l.id, label: l.name, color: l.color }))}
              value={field.value ?? []}
              onChange={field.onChange}
              placeholder="Add labels"
              onCreate={async (name) => {
                const res = await createLabel(name);
                if (!res.ok) {
                  toast.error(res.error);
                  return null;
                }
                onLabelCreated(res.data);
                return { value: res.data.id, label: res.data.name, color: res.data.color };
              }}
            />
          )}
        />
      </Field>
      <Field label="Collaborators" htmlFor="task-collaborators" hint="People who should follow and help with this task.">
        <Controller
          control={control}
          name="collaborator_ids"
          render={({ field }) => (
            <MultiSelect
              options={memberOptions}
              value={field.value ?? []}
              onChange={field.onChange}
              placeholder="Add people"
            />
          )}
        />
      </Field>
      {assigneeChanged && watch("assignee_id") ? (
        <Field label="Assignment note" htmlFor="task-note" hint="Optional — saved in the assignment history.">
          <Input {...register("note")} maxLength={500} placeholder="Why this person?" />
        </Field>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
          {task ? "Save changes" : "Create task"}
        </Button>
      </DialogFooter>
    </form>
  );
}
