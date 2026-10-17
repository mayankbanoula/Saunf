import type { Metadata } from "next";
import { Suspense } from "react";

import { TaskListSkeleton, TaskListView } from "@/components/tasks/task-list-view";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin · Archived tasks" };

async function Archive({ searchParams }: { searchParams: PageProps<"/admin/archive">["searchParams"] }) {
  await requireRole(["admin"]);
  return (
    <TaskListView
      searchParams={searchParams}
      basePath="/admin/archive"
      overrides={{ archived: "only" }}
      hide={{ archived: true, view: true }}
      emptyTitle="No archived tasks"
      emptyDescription="Archived tasks appear here. Select tasks and choose Restore to bring them back."
    />
  );
}

export default function AdminArchivePage({ searchParams }: PageProps<"/admin/archive">) {
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">Select tasks to restore them. Restoring is recorded in each task&apos;s history.</p>
      <Suspense fallback={<TaskListSkeleton />}>
        <Archive searchParams={searchParams} />
      </Suspense>
    </>
  );
}
