import { LayoutDashboardIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ActivityTimeline } from "@/components/activity-timeline";
import { ThroughputChart, WorkloadChart } from "@/components/charts";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { RangePicker } from "@/components/range-picker";
import { PersonPicker } from "@/components/person-picker";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { DueDate, PriorityBadge, StatusBadge } from "@/components/tasks/task-badges";
import { RelativeTime } from "@/components/time";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  Skeleton,
  UserAvatar,
} from "@/components/ui/primitives";
import type { ActivityEvent } from "@/lib/activity";
import { canCreateTasks, requireViewer } from "@/lib/auth/session";
import { addDaysIso } from "@/lib/dates";
import { assigneeParam, resolvePeopleView } from "@/lib/people";
import { resolveRange } from "@/lib/range";
import { createClient } from "@/lib/supabase/server";
import { queryContext } from "@/lib/tasks/queries";
import { cn, displayName } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

type Summary = {
  today: string;
  open: number;
  assigned_to_me: number;
  in_progress: number;
  in_review: number;
  blocked: number;
  overdue: number;
  due_today: number;
  completed: number;
  created: number;
  avg_cycle_hours: number | null;
};

function Metric({
  label,
  value,
  href,
  tone,
  hint,
}: {
  label: string;
  value: number;
  href: string;
  tone?: "danger" | "warning";
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <div className="text-xs text-muted-foreground group-hover:text-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "danger" && value > 0 && "text-destructive",
          tone === "warning" && value > 0 && "text-[oklch(0.5_0.13_60)] dark:text-[oklch(0.82_0.13_70)]",
        )}
      >
        {value}
      </div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </Link>
  );
}

async function DashboardContent({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const range = resolveRange(sp, viewer.settings.timezone);
  const ctx = queryContext(viewer);
  const view = await resolvePeopleView(viewer, sp.person);
  const supabase = await createClient();
  const p_member = view.member ?? undefined;

  let upcoming = supabase
    .from("tasks")
    .select(
      "id, key, title, status, priority, due_date, due_time, assignee:profiles!tasks_assignee_profile_fkey(id, full_name, email)",
    )
    .is("archived_at", null)
    .neq("status", "done")
    .gte("due_date", ctx.today)
    .lte("due_date", addDaysIso(ctx.today, 14))
    .order("due_date")
    .order("due_time", { nullsFirst: false })
    .limit(8);
  let recent = supabase
    .from("tasks")
    .select("id, key, title, status, updated_at, assignee:profiles!tasks_assignee_profile_fkey(id, full_name, email)")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(8);
  let activity = supabase
    .from("activity_events")
    .select(
      "id, event_type, created_at, old_value, new_value, metadata, actor:profiles!activity_events_actor_id_fkey(id, full_name, email), task:tasks(key, title)",
    )
    .not("task_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);
  if (view.ids) {
    upcoming = upcoming.in("assignee_id", view.ids);
    recent = recent.in("assignee_id", view.ids);
    activity = activity.in("actor_id", view.ids);
  }

  const [summaryRes, throughputRes, workloadRes, projectsRes, upcomingRes, recentRes, activityRes] = await Promise.all([
    supabase.rpc("dashboard_summary", { p_from: range.fromTs, p_to: range.toTs, p_member }),
    supabase.rpc("task_throughput", { p_from: range.from, p_to: range.to, p_member }),
    supabase.rpc("workload_by_member", { p_from: range.fromTs, p_to: range.toTs, p_member }),
    supabase.rpc("project_progress", { p_member }),
    upcoming,
    recent,
    activity,
  ]);

  const firstError = [summaryRes, throughputRes, workloadRes, projectsRes, upcomingRes, recentRes, activityRes].find(
    (r) => r.error,
  )?.error;
  if (firstError) throw new Error(`Dashboard failed to load: ${firstError.message}`);

  const s = summaryRes.data as unknown as Summary;
  const hasAnyTasks = (recentRes.data?.length ?? 0) > 0;

  if (!hasAnyTasks) {
    return (
      <EmptyState
        icon={LayoutDashboardIcon}
        title={view.ids ? `No tasks yet · ${view.label}` : "Your workspace has no tasks yet"}
        description="Once tasks are assigned, this dashboard shows workload, deadlines, progress and recent activity — all from live data."
        action={canCreateTasks(viewer) ? <NewTaskButton label="Create a task" /> : undefined}
        className="mt-6"
      />
    );
  }

  const rangeQS = `completed_from=${range.from}&completed_to=${range.to}`;
  const who = assigneeParam(view, viewer);
  const workload = (workloadRes.data ?? [])
    .filter((w) => w.open_count > 0)
    .slice(0, 12)
    .map((w) => ({
      name: w.full_name || w.email,
      onTrack: Number(w.open_count) - Number(w.overdue_count),
      overdue: Number(w.overdue_count),
    }));
  const throughput = (throughputRes.data ?? []).map((d) => ({
    day: d.day,
    created: Number(d.created),
    completed: Number(d.completed),
  }));
  const projects = (projectsRes.data ?? []).filter((p) => p.total > 0 && p.status !== "cancelled");

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <Metric label="Open tasks" value={s.open} href={`/tasks?open=1${who}`} />
        <Metric label="Assigned to me" value={s.assigned_to_me} href="/my-tasks?open=1" />
        <Metric label="In progress" value={s.in_progress} href={`/tasks?status=in_progress${who}`} />
        <Metric label="Awaiting review" value={s.in_review} href={`/tasks?status=in_review${who}`} />
        <Metric label="Overdue" value={s.overdue} href={`/tasks?due=overdue${who}`} tone="danger" />
        <Metric label="Due today" value={s.due_today} href={`/tasks?due=today${who}`} tone="warning" />
        <Metric label="Blocked" value={s.blocked} href={`/tasks?blocked=1&open=1${who}`} tone="danger" />
        <Metric
          label="Completed"
          value={s.completed}
          href={`/tasks?status=done&${rangeQS}${who}`}
          hint={s.avg_cycle_hours != null ? `avg ${(s.avg_cycle_hours / 24).toFixed(1)} days to finish` : range.label}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Created vs completed</CardTitle>
              <CardDescription>
                {range.label} · {s.created} created, {s.completed} completed
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ThroughputChart data={throughput} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Upcoming deadlines</CardTitle>
              <CardDescription>Open tasks due in the next 14 days</CardDescription>
            </div>
            <Link href="/tasks?due=week&sort=due" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {upcomingRes.data?.length ? (
              <ul className="divide-y">
                {upcomingRes.data.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 py-2">
                    <PriorityBadge priority={t.priority} iconOnly />
                    <Link href={`/tasks/${t.key}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                      {t.title}
                    </Link>
                    <DueDate task={t} today={ctx.today} nowTime={ctx.nowTime} />
                    {t.assignee ? <UserAvatar size="xs" name={displayName(t.assignee)} id={t.assignee.id} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing due in the next two weeks.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Workload by employee</CardTitle>
              <CardDescription>Open tasks currently assigned</CardDescription>
            </div>
            <Link href="/reports" className="text-xs text-primary hover:underline">
              Reports
            </Link>
          </CardHeader>
          <CardContent>
            {workload.length ? (
              <WorkloadChart data={workload} />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No open assigned tasks.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Project progress</CardTitle>
              <CardDescription>Share of each project&apos;s tasks that are done</CardDescription>
            </div>
            <Link href="/projects" className="text-xs text-primary hover:underline">
              All projects
            </Link>
          </CardHeader>
          <CardContent>
            {projects.length ? (
              <ul className="grid gap-3">
                {projects.slice(0, 8).map((p) => {
                  const pct = Math.round((Number(p.done) / Number(p.total)) * 100);
                  return (
                    <li key={p.project_id}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                        <Link href={`/projects/${p.project_id}`} className="truncate hover:underline">
                          {p.name}
                        </Link>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {p.done}/{p.total} · {pct}%
                          {Number(p.overdue) > 0 ? (
                            <span className="text-destructive"> · {p.overdue} overdue</span>
                          ) : null}
                        </span>
                      </div>
                      <Progress value={pct} aria-label={`${p.name} ${pct}% complete`} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No projects with tasks yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recently updated</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {recentRes.data?.map((t) => (
                <li key={t.id} className="flex items-center gap-2 py-2">
                  <span className="font-mono text-xs text-muted-foreground">{t.key}</span>
                  <Link href={`/tasks/${t.key}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                    {t.title}
                  </Link>
                  <StatusBadge status={t.status} className="hidden sm:inline-flex" />
                  <RelativeTime iso={t.updated_at} className="text-xs whitespace-nowrap text-muted-foreground" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <Link
              href={view.current === view.options[0]?.value ? "/activity" : `/activity?person=${view.current}`}
              className="text-xs text-primary hover:underline"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent className="pl-8">
            <ActivityTimeline events={(activityRes.data ?? []) as unknown as ActivityEvent[]} showTask />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function DashboardHeader({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const range = resolveRange(sp, viewer.settings.timezone);
  const view = await resolvePeopleView(viewer, sp.person);
  return (
    <PageHeader
      title={`Welcome back, ${viewer.fullName.split(" ")[0]}`}
      description={`${viewer.workspaceName} · ${view.label}`}
      actions={
        <>
          <PersonPicker current={view.current} options={view.options} />
          <RangePicker current={range.key} from={range.from} to={range.to} />
        </>
      }
    />
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-5" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <>
      <Suspense fallback={<Skeleton className="mb-5 h-12 w-72" />}>
        <DashboardHeader searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
