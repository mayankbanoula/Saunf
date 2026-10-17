import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { TaskListSkeleton, TaskListView } from "@/components/tasks/task-list-view";

export const metadata: Metadata = { title: "My tasks" };

export default function MyTasksPage({ searchParams }: PageProps<"/my-tasks">) {
  return (
    <>
      <PageHeader title="My tasks" description="Tasks currently assigned to you." actions={<NewTaskButton />} />
      <Suspense fallback={<TaskListSkeleton />}>
        <TaskListView
          searchParams={searchParams}
          basePath="/my-tasks"
          overrides={{ assignee: "me" }}
          hide={{ assignee: true }}
          columns={["creator", "project", "progress", "updated"]}
          emptyTitle="Nothing assigned to you"
          emptyDescription="When someone assigns you a task, it shows up here."
        />
      </Suspense>
    </>
  );
}
