"use client";

import { ArchiveIcon, ArchiveRestoreIcon, Loader2Icon, XIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { bulkUpdateTasks } from "@/actions/tasks";
import { BlockedBadge, DueDate, LabelChip, PriorityBadge, StatusBadge } from "@/components/tasks/task-badges";
import { RelativeTime } from "@/components/time";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/overlays";
import { Progress, UserAvatar } from "@/components/ui/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TaskListRow } from "@/lib/tasks/queries";
import { PRIORITY_LABEL, STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/constants";
import { cn, displayName } from "@/lib/utils";

export type TaskTableColumn = "creator" | "assignee" | "project" | "progress" | "updated";

export function TaskTable({
  rows,
  today,
  nowTime,
  members,
  columns = ["assignee", "creator", "project", "updated"],
  bulk = true,
}: {
  rows: TaskListRow[];
  today: string;
  nowTime: string;
  members: { id: string; name: string }[];
  columns?: TaskTableColumn[];
  bulk?: boolean;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [pending, startTransition] = React.useTransition();
  const show = (c: TaskTableColumn) => columns.includes(c);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const anyArchived = rows.some((r) => selected.has(r.id) && r.archived_at);

  // New rows (page/filter change or refresh) clear the selection.
  const [seenRows, setSeenRows] = React.useState(rows);
  if (seenRows !== rows) {
    setSeenRows(rows);
    setSelected(new Set());
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function apply(patch: Parameters<typeof bulkUpdateTasks>[0]["patch"], label: string) {
    const ids = [...selected];
    startTransition(async () => {
      const res = await bulkUpdateTasks({ task_ids: ids, patch });
      if (res.ok) {
        toast.success(`${label} — ${res.data} task${res.data === 1 ? "" : "s"} updated`);
        setSelected(new Set());
      } else toast.error(res.error);
    });
  }

  return (
    <div className="rounded-lg border bg-card">
      {bulk && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b bg-accent/50 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <NativeSelect
            aria-label="Set status"
            className="h-8 w-auto text-sm"
            value=""
            disabled={pending}
            onChange={(e) =>
              e.target.value && apply({ status: e.target.value as (typeof TASK_STATUSES)[number] }, "Status changed")
            }
          >
            <option value="">Set status…</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Set priority"
            className="h-8 w-auto text-sm"
            value=""
            disabled={pending}
            onChange={(e) =>
              e.target.value &&
              apply({ priority: e.target.value as (typeof TASK_PRIORITIES)[number] }, "Priority changed")
            }
          >
            <option value="">Set priority…</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Assign to"
            className="h-8 w-auto max-w-44 text-sm"
            value=""
            disabled={pending}
            onChange={(e) =>
              e.target.value && apply({ assignee_id: e.target.value === "none" ? null : e.target.value }, "Reassigned")
            }
          >
            <option value="">Assign to…</option>
            <option value="none">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
          {anyArchived ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => apply({ archived: false }, "Restored")}
            >
              <ArchiveRestoreIcon /> Restore
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => apply({ archived: true }, "Archived")}
            >
              <ArchiveIcon /> Archive
            </Button>
          )}
          {pending ? <Loader2Icon className="size-4 animate-spin" /> : null}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            <XIcon /> Clear
          </Button>
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {bulk ? (
              <TableHead className="w-8">
                <Checkbox
                  aria-label="Select all tasks on this page"
                  checked={allSelected}
                  onCheckedChange={(c) => setSelected(c ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </TableHead>
            ) : null}
            <TableHead className="w-24">ID</TableHead>
            <TableHead>Title</TableHead>
            {show("assignee") ? <TableHead>Assignee</TableHead> : null}
            {show("creator") ? <TableHead className="hidden lg:table-cell">Creator</TableHead> : null}
            <TableHead>Status</TableHead>
            <TableHead className="hidden sm:table-cell">Priority</TableHead>
            <TableHead>Due</TableHead>
            {show("progress") ? <TableHead className="hidden md:table-cell">Progress</TableHead> : null}
            {show("project") ? <TableHead className="hidden xl:table-cell">Project</TableHead> : null}
            {show("updated") ? <TableHead className="hidden md:table-cell">Updated</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => {
            const labels = t.task_labels.map((tl) => tl.labels).filter((l) => l !== null);
            return (
              <TableRow
                key={t.id}
                data-state={selected.has(t.id) ? "selected" : undefined}
                className={cn(t.archived_at && "opacity-70")}
              >
                {bulk ? (
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${t.key}`}
                      checked={selected.has(t.id)}
                      onCheckedChange={() => toggle(t.id)}
                    />
                  </TableCell>
                ) : null}
                <TableCell className="font-mono text-xs text-muted-foreground">{t.key}</TableCell>
                <TableCell className="max-w-[22rem] min-w-48">
                  <Link
                    href={`/tasks/${t.key}`}
                    className="line-clamp-1 font-medium hover:text-primary hover:underline"
                  >
                    {t.title}
                  </Link>
                  {labels.length || t.is_blocked || t.archived_at ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.archived_at ? <span className="rounded bg-muted px-1.5 text-[11px]">Archived</span> : null}
                      {t.is_blocked ? <BlockedBadge /> : null}
                      {labels.slice(0, 3).map((l) => (
                        <LabelChip key={l.id} label={l} />
                      ))}
                    </div>
                  ) : null}
                </TableCell>
                {show("assignee") ? (
                  <TableCell>
                    {t.assignee ? (
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <UserAvatar size="sm" name={displayName(t.assignee)} id={t.assignee.id} />
                        <span className="hidden max-w-32 truncate text-sm lg:inline">{displayName(t.assignee)}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Unassigned</span>
                    )}
                  </TableCell>
                ) : null}
                {show("creator") ? (
                  <TableCell className="hidden max-w-32 truncate text-sm text-muted-foreground lg:table-cell">
                    {displayName(t.creator)}
                  </TableCell>
                ) : null}
                <TableCell>
                  <StatusBadge status={t.status} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <PriorityBadge priority={t.priority} />
                </TableCell>
                <TableCell>
                  <DueDate task={t} today={today} nowTime={nowTime} />
                </TableCell>
                {show("progress") ? (
                  <TableCell className="hidden md:table-cell">
                    <div className="flex w-28 items-center gap-2">
                      <Progress value={t.progress} aria-label={`${t.progress}% complete`} />
                      <span className="w-8 text-right text-xs text-muted-foreground">{t.progress}%</span>
                    </div>
                  </TableCell>
                ) : null}
                {show("project") ? (
                  <TableCell className="hidden max-w-40 truncate text-sm text-muted-foreground xl:table-cell">
                    {t.project ? (
                      <Link href={`/projects/${t.project.id}`} className="hover:text-foreground hover:underline">
                        {t.project.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                ) : null}
                {show("updated") ? (
                  <TableCell className="hidden text-xs whitespace-nowrap text-muted-foreground md:table-cell">
                    <RelativeTime iso={t.updated_at} />
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
