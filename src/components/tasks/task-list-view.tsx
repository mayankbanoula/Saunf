import { ListTodoIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskTable, type TaskTableColumn } from "@/components/tasks/task-table";
import { Skeleton } from "@/components/ui/primitives";
import { canCreateTasks, requireViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PAGE_SIZE } from "@/lib/tasks/constants";
import { activeFilterCount, filtersToSearchParams, parseTaskFilters } from "@/lib/tasks/filters";
import { loadFilterOptions } from "@/lib/tasks/options";
import { fetchTaskPage, fetchTasksForBoard, queryContext } from "@/lib/tasks/queries";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const BOARD_LIMIT = 300;

export async function TaskListView({
  searchParams,
  basePath,
  overrides = {},
  hide = {},
  columns,
  emptyTitle = "No tasks yet",
  emptyDescription = "Create a task to get started.",
  createDefaults,
}: {
  searchParams: SearchParams;
  basePath: string;
  overrides?: Record<string, string>;
  hide?: Parameters<typeof TaskFilters>[0]["hide"];
  columns?: TaskTableColumn[];
  emptyTitle?: string;
  emptyDescription?: string;
  createDefaults?: { project_id?: string };
}) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const filters = parseTaskFilters(sp, overrides);
  const supabase = await createClient();
  const ctx = queryContext(viewer);

  const [options, result] = await Promise.all([
    loadFilterOptions(supabase, viewer),
    filters.view === "board"
      ? fetchTasksForBoard(supabase, filters, ctx, BOARD_LIMIT).then((rows) => ({ rows, total: rows.length }))
      : fetchTaskPage(supabase, filters, ctx),
  ]);

  // Strip the page's fixed filters so pagination links stay clean.
  const linkParams = filtersToSearchParams(filters);
  for (const key of Object.keys(overrides)) linkParams.delete(key);
  const filtered =
    activeFilterCount({ ...filters, ...Object.fromEntries(Object.keys(overrides).map((k) => [k, undefined])) }) > 0;

  return (
    <>
      <TaskFilters options={options} hide={hide} />
      {result.rows.length === 0 && filters.view === "list" ? (
        <EmptyState
          icon={ListTodoIcon}
          title={filtered ? "No tasks match these filters" : emptyTitle}
          description={filtered ? "Try removing a filter or searching for something else." : emptyDescription}
          action={!filtered && canCreateTasks(viewer) ? <NewTaskButton defaults={createDefaults} /> : undefined}
        />
      ) : filters.view === "board" ? (
        <TaskBoard
          rows={result.rows}
          today={ctx.today}
          nowTime={ctx.nowTime}
          truncated={result.rows.length >= BOARD_LIMIT}
        />
      ) : (
        <>
          <TaskTable
            rows={result.rows}
            today={ctx.today}
            nowTime={ctx.nowTime}
            members={options.members}
            columns={columns}
          />
          <Pagination
            page={filters.page}
            pageSize={PAGE_SIZE}
            total={result.total}
            basePath={basePath}
            searchParams={linkParams}
          />
        </>
      )}
    </>
  );
}

export function TaskListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading tasks">
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="rounded-lg border bg-card">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-3 py-3 last:border-0">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
