import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { TaskListSkeleton, TaskListView } from "@/components/tasks/task-list-view";

export const metadata: Metadata = { title: "All tasks" };

export default function AllTasksPage({ searchParams }: PageProps<"/tasks">) {
  return (
    <>
      <PageHeader
        title="All tasks"
        description="Every task you have access to in this workspace."
        actions={<NewTaskButton />}
      />
      <Suspense fallback={<TaskListSkeleton />}>
        <TaskListView
          searchParams={searchParams}
          basePath="/tasks"
          emptyDescription="Tasks you can access will appear here. Create the first one."
        />
      </Suspense>
    </>
  );
}
