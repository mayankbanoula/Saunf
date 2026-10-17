"use client";

import { GitBranchIcon, LinkIcon, Loader2Icon, XIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { addDependency, removeDependency } from "@/actions/tasks";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { StatusBadge } from "@/components/tasks/task-badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/primitives";
import type { TaskStatus } from "@/lib/tasks/constants";
import { displayName } from "@/lib/utils";

type MiniTask = { id: string; key: string; title: string; status: TaskStatus };

export function Subtasks({
  parent,
  subtasks,
  canAdd,
}: {
  parent: { id: string; key: string; project_id: string | null };
  subtasks: (MiniTask & { progress: number; assignee: { id: string; full_name: string; email: string } | null })[];
  canAdd: boolean;
}) {
  const done = subtasks.filter((s) => s.status === "done").length;
  return (
    <section aria-labelledby="subtasks-heading">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="subtasks-heading" className="flex items-center gap-2 text-sm font-semibold">
          <GitBranchIcon className="size-4 text-muted-foreground" /> Subtasks
          {subtasks.length ? (
            <span className="text-muted-foreground">
              {done}/{subtasks.length}
            </span>
          ) : null}
        </h2>
        {canAdd ? (
          <NewTaskButton
            variant="outline"
            size="xs"
            label="Add subtask"
            defaults={{ parent_id: parent.id, parentKey: parent.key, project_id: parent.project_id ?? undefined }}
          />
        ) : null}
      </div>
      {subtasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No subtasks. Break larger work into smaller tasks.</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {subtasks.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2">
              <span className="font-mono text-xs text-muted-foreground">{s.key}</span>
              <Link
                href={`/tasks/${s.key}`}
                className="min-w-0 flex-1 truncate text-sm hover:text-primary hover:underline"
              >
                {s.title}
              </Link>
              <StatusBadge status={s.status} />
              {s.assignee ? <UserAvatar size="sm" name={displayName(s.assignee)} id={s.assignee.id} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Dependencies({
  taskId,
  blockedBy,
  blocking,
  canEdit,
}: {
  taskId: string;
  blockedBy: MiniTask[];
  blocking: MiniTask[];
  canEdit: boolean;
}) {
  const [key, setKey] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const add = () =>
    startTransition(async () => {
      const res = await addDependency(taskId, key);
      if (!res.ok) return void toast.error(res.error);
      setKey("");
      toast.success("Dependency added");
    });

  return (
    <section aria-labelledby="deps-heading">
      <h2 id="deps-heading" className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <LinkIcon className="size-4 text-muted-foreground" /> Dependencies
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Blocked by</div>
          {blockedBy.length === 0 ? <p className="text-sm text-muted-foreground">Nothing.</p> : null}
          <ul className="grid gap-1">
            {blockedBy.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <StatusBadge status={t.status} />
                <Link href={`/tasks/${t.key}`} className="min-w-0 flex-1 truncate hover:underline">
                  <span className="font-mono text-xs text-muted-foreground">{t.key}</span> {t.title}
                </Link>
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6"
                    aria-label={`Remove dependency on ${t.key}`}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await removeDependency(taskId, t.id);
                        if (!res.ok) toast.error(res.error);
                      })
                    }
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {canEdit ? (
            <form
              className="mt-2 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (key.trim()) add();
              }}
            >
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Task ID, e.g. SAU-00012"
                className="h-8"
                aria-label="Blocked by task ID"
              />
              <Button size="sm" variant="outline" disabled={pending || !key.trim()}>
                {pending ? <Loader2Icon className="animate-spin" /> : null} Add
              </Button>
            </form>
          ) : null}
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Blocking</div>
          {blocking.length === 0 ? <p className="text-sm text-muted-foreground">Nothing.</p> : null}
          <ul className="grid gap-1">
            {blocking.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <StatusBadge status={t.status} />
                <Link href={`/tasks/${t.key}`} className="min-w-0 flex-1 truncate hover:underline">
                  <span className="font-mono text-xs text-muted-foreground">{t.key}</span> {t.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
