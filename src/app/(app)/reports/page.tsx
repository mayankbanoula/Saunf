import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ThroughputChart } from "@/components/charts";
import { PageHeader } from "@/components/layout/page-header";
import { PersonPicker } from "@/components/person-picker";
import { RangePicker } from "@/components/range-picker";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  Skeleton,
} from "@/components/ui/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireViewer } from "@/lib/auth/session";
import { assigneeParam, resolvePeopleView } from "@/lib/people";
import { resolveRange } from "@/lib/range";
import { createClient } from "@/lib/supabase/server";
import {
  PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  STATUS_DOT,
  STATUS_LABEL,
  type TaskPriority,
} from "@/lib/tasks/constants";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };

type Summary = {
  open: number;
  todo: number;
  in_progress: number;
  in_review: number;
  blocked: number;
  unassigned: number;
  overdue: number;
  completed: number;
  created: number;
  avg_cycle_hours: number | null;
  open_by_priority: Record<TaskPriority, number>;
};

function Bar({
  label,
  value,
  max,
  href,
  dot,
}: {
  label: string;
  value: number;
  max: number;
  href: string;
  dot?: string;
}) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <li>
      <Link href={href} className="group grid grid-cols-[7rem_1fr_2.5rem] items-center gap-3 text-sm">
        <span className="flex items-center gap-1.5 group-hover:underline">
          {dot ? <span className={cn("size-2 rounded-full", dot)} /> : null}
          {label}
        </span>
        <span className="h-2 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-[var(--chart-2)]" style={{ width: `${pct}%` }} />
        </span>
        <span className="text-right tabular-nums">{value}</span>
      </Link>
    </li>
  );
}

async function ReportsContent({ searchParams }: { searchParams: PageProps<"/reports">["searchParams"] }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const range = resolveRange(sp, viewer.settings.timezone);
  const view = await resolvePeopleView(viewer, sp.person);
  const p_member = view.member ?? undefined;
  const supabase = await createClient();
  const [summaryRes, throughputRes, workloadRes, projectsRes, deptRes] = await Promise.all([
    supabase.rpc("dashboard_summary", { p_from: range.fromTs, p_to: range.toTs, p_member }),
    supabase.rpc("task_throughput", { p_from: range.from, p_to: range.to, p_member }),
    supabase.rpc("workload_by_member", { p_from: range.fromTs, p_to: range.toTs, p_member }),
    supabase.rpc("project_progress", { p_member }),
    supabase.from("departments").select("id, name"),
  ]);
  const err = summaryRes.error ?? throughputRes.error ?? workloadRes.error ?? projectsRes.error;
  if (err) throw new Error(`Reports failed to load: ${err.message}`);
  const s = summaryRes.data as unknown as Summary;
  const deptName = new Map((deptRes.data ?? []).map((d) => [d.id, d.name]));
  const throughput = (throughputRes.data ?? []).map((d) => ({
    day: d.day,
    created: Number(d.created),
    completed: Number(d.completed),
  }));
  const statusMax = Math.max(s.todo, s.in_progress, s.in_review, 1);
  const prioMax = Math.max(...Object.values(s.open_by_priority), 1);
  const who = assigneeParam(view, viewer);
  const rangeQS = `completed_from=${range.from}&completed_to=${range.to}`;
  const scopeNote = view.ids ? `${view.label}.` : "All tasks in the workspace.";

  return (
    <div className="grid grid-cols-1 gap-5">
      <p className="text-xs text-muted-foreground">{scopeNote} Archived tasks are excluded.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          {
            label: "Created",
            value: s.created,
            hint: range.label,
            href: `/tasks?created_from=${range.from}&created_to=${range.to}${who}`,
          },
          { label: "Completed", value: s.completed, hint: range.label, href: `/tasks?status=done&${rangeQS}${who}` },
          {
            label: "Avg. time to complete",
            value: s.avg_cycle_hours != null ? `${(s.avg_cycle_hours / 24).toFixed(1)} d` : "—",
            hint: "for tasks completed in range",
            href: `/tasks?status=done&${rangeQS}${who}`,
          },
          { label: "Open now", value: s.open, hint: `${s.unassigned} unassigned`, href: `/tasks?open=1${who}` },
          { label: "Overdue now", value: s.overdue, hint: `${s.blocked} blocked`, href: `/tasks?due=overdue${who}` },
        ].map((m) => (
          <Link key={m.label} href={m.href} className="rounded-lg border bg-card px-4 py-3 hover:border-primary/40">
            <div className="text-xs text-muted-foreground">{m.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{m.value}</div>
            <div className="text-[11px] text-muted-foreground">{m.hint}</div>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Throughput</CardTitle>
            <CardDescription>Tasks created and completed per day · {range.label}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ThroughputChart data={throughput} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Open tasks by status</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3">
              {(["todo", "in_progress", "in_review"] as const).map((st) => (
                <Bar
                  key={st}
                  label={STATUS_LABEL[st]}
                  value={s[st]}
                  max={statusMax}
                  href={`/tasks?status=${st}${who}`}
                  dot={STATUS_DOT[st]}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Open tasks by priority</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3">
              {(["urgent", "high", "medium", "low"] as const).map((p) => (
                <Bar
                  key={p}
                  label={PRIORITY_LABEL[p]}
                  value={s.open_by_priority[p]}
                  max={prioMax}
                  href={`/tasks?priority=${p}&open=1${who}`}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Workload by employee</CardTitle>
            <CardDescription>
              Current open work; “Completed” counts tasks finished in the selected range.
            </CardDescription>
          </div>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Employee</TableHead>
              <TableHead className="hidden md:table-cell">Department</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">In progress</TableHead>
              <TableHead className="text-right">In review</TableHead>
              <TableHead className="text-right">Urgent</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
              <TableHead className="text-right">Completed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(workloadRes.data ?? []).map((w) => (
              <TableRow key={w.user_id}>
                <TableCell>
                  <Link href={`/team/${w.user_id}`} className="font-medium hover:underline">
                    {w.full_name || w.email}
                  </Link>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {w.department_id ? deptName.get(w.department_id) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Link href={`/tasks?assignee=${w.user_id}&open=1`} className="hover:underline">
                    {w.open_count}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{w.in_progress_count}</TableCell>
                <TableCell className="text-right tabular-nums">{w.in_review_count}</TableCell>
                <TableCell className="text-right tabular-nums">{w.urgent_count}</TableCell>
                <TableCell className={cn("text-right tabular-nums", Number(w.overdue_count) > 0 && "text-destructive")}>
                  {w.overdue_count}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Link href={`/tasks?assignee=${w.user_id}&status=done&${rangeQS}`} className="hover:underline">
                    {w.completed_count}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Project</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="w-48">Progress</TableHead>
              <TableHead className="text-right">Tasks</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
              <TableHead className="hidden md:table-cell">Target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(projectsRes.data ?? []).map((p) => {
              const pct = Number(p.total) ? Math.round((Number(p.done) / Number(p.total)) * 100) : 0;
              return (
                <TableRow key={p.project_id}>
                  <TableCell>
                    <Link href={`/projects/${p.project_id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{PROJECT_STATUS_LABEL[p.status]}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={pct} aria-label={`${pct}%`} />
                      <span className="w-9 text-right text-xs tabular-nums">{pct}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.done}/{p.total}
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", Number(p.overdue) > 0 && "text-destructive")}>
                    {p.overdue}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{p.target_date ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

async function Header({ searchParams }: { searchParams: PageProps<"/reports">["searchParams"] }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const range = resolveRange(sp, viewer.settings.timezone);
  const view = await resolvePeopleView(viewer, sp.person);
  return (
    <PageHeader
      title="Reports"
      description="Workload, throughput and progress from live data."
      actions={
        <>
          <PersonPicker current={view.current} options={view.options} />
          <RangePicker current={range.key} from={range.from} to={range.to} />
        </>
      }
    />
  );
}

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <>
      <Suspense fallback={<Skeleton className="mb-5 h-12 w-72" />}>
        <Header searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-[700px]" />}>
        <ReportsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
