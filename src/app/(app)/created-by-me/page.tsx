import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { TaskListSkeleton, TaskListView } from "@/components/tasks/task-list-view";
import { Skeleton } from "@/components/ui/primitives";
import { requireViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { queryContext } from "@/lib/tasks/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Created by me" };

/** Shortcuts to the tasks you created that need your attention. */
async function AwaitingAction() {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const ctx = queryContext(viewer);
  const base = () =>
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", viewer.id)
      .is("archived_at", null);
  const [review, overdue, unassigned, blocked] = await Promise.all([
    base().eq("status", "in_review"),
    base()
      .neq("status", "done")
      .or(`due_date.lt.${ctx.today},and(due_date.eq.${ctx.today},due_time.lt.${ctx.nowTime})`),
    base().neq("status", "done").is("assignee_id", null),
    base().neq("status", "done").eq("is_blocked", true),
  ]);
  const chips = [
    { label: "Awaiting your review", count: review.count ?? 0, href: "/created-by-me?status=in_review" },
    { label: "Overdue", count: overdue.count ?? 0, href: "/created-by-me?due=overdue" },
    { label: "Unassigned", count: unassigned.count ?? 0, href: "/created-by-me?assignee=none&open=1" },
    { label: "Blocked", count: blocked.count ?? 0, href: "/created-by-me?blocked=1&open=1" },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {chips.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          className={cn(
            "rounded-lg border bg-card px-3 py-2 transition-colors hover:border-primary/40",
            c.count > 0 && c.label !== "Unassigned" && "border-warning/50",
          )}
        >
          <div className="text-lg font-semibold">{c.count}</div>
          <div className="text-xs text-muted-foreground">{c.label}</div>
        </Link>
      ))}
    </div>
  );
}

export default function CreatedByMePage({ searchParams }: PageProps<"/created-by-me">) {
  return (
    <>
      <PageHeader
        title="Created by me"
        description="Tasks you created, who has them now, and how far along they are."
        actions={<NewTaskButton />}
      />
      <Suspense fallback={<Skeleton className="mb-4 h-16" />}>
        <AwaitingAction />
      </Suspense>
      <Suspense fallback={<TaskListSkeleton />}>
        <TaskListView
          searchParams={searchParams}
          basePath="/created-by-me"
          overrides={{ creator: "me" }}
          hide={{ creator: true }}
          columns={["assignee", "project", "progress", "updated"]}
          emptyTitle="You haven't created any tasks"
          emptyDescription="Tasks you create for yourself or others are tracked here."
        />
      </Suspense>
    </>
  );
}
