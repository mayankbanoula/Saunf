"use client";

import { ArchiveIcon, ArchiveRestoreIcon, CheckCircle2Icon, Loader2Icon, PencilIcon, RotateCcwIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { setTaskArchived, setTaskStatus } from "@/actions/tasks";
import { TaskFormDialog, type EditableTask } from "@/components/tasks/task-form-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Permissions = { edit: boolean; work: boolean; archive: boolean; restore: boolean };

export function TaskActions({ task, permissions }: { task: EditableTask; permissions: Permissions }) {
  const [editing, setEditing] = React.useState(false);
  const [confirmArchive, setConfirmArchive] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(success);
      else toast.error(res.error ?? "Something went wrong");
    });

  const done = task.status === "done";

  return (
    <>
      {permissions.work ? (
        done ? (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => setTaskStatus(task.id, "in_progress"), `${task.key} reopened`)}>
            <RotateCcwIcon /> Reopen
          </Button>
        ) : (
          <Button size="sm" disabled={pending} onClick={() => run(() => setTaskStatus(task.id, "done"), `${task.key} completed`)}>
            <CheckCircle2Icon /> Complete
          </Button>
        )
      ) : null}
      {permissions.edit ? (
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <PencilIcon /> Edit
        </Button>
      ) : null}
      {permissions.archive ? (
        <Button variant="ghost" size="sm" onClick={() => setConfirmArchive(true)}>
          <ArchiveIcon /> Archive
        </Button>
      ) : null}
      {permissions.restore ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => setTaskArchived(task.id, false), `${task.key} restored`)}>
          <ArchiveRestoreIcon /> Restore
        </Button>
      ) : null}
      {pending ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}

      <TaskFormDialog open={editing} onOpenChange={setEditing} task={task} />
      <Dialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive {task.key}?</DialogTitle>
            <DialogDescription>
              Archived tasks are hidden from task lists and can&apos;t be edited until restored. History is kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmArchive(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setConfirmArchive(false);
                run(() => setTaskArchived(task.id, true), `${task.key} archived`);
              }}
            >
              Archive task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
