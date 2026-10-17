import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { WorkloadChart } from "@/components/charts";
import { PageHeader } from "@/components/layout/page-header";
import { TaskListSkeleton, TaskListView } from "@/components/tasks/task-list-view";
import { Card, CardContent, CardHeader, CardTitle, Skeleton, UserAvatar } from "@/components/ui/primitives";
import { requireViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/tasks/constants";
import { displayName } from "@/lib/utils";

export const metadata: Metadata = { title: "Department" };

async function DepartmentContent({ params, searchParams }: PageProps<"/team/departments/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requireViewer();
  const supabase = await createClient();
  const [{ data: dept }, { data: members }, { data: workload }] = await Promise.all([
    supabase
      .from("departments")
      .select("id, name, description, manager:profiles!departments_manager_id_fkey(id, full_name, email)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("workspace_members")
      .select("user_id, role, profiles!workspace_members_user_id_fkey(full_name, email, job_title)")
      .eq("workspace_id", viewer.workspaceId)
      .eq("department_id", id)
      .eq("is_active", true),
    supabase.rpc("workload_by_member"),
  ]);
  if (!dept) notFound();
  const load = new Map((workload ?? []).map((w) => [w.user_id, w]));
  const people = (members ?? []).map((m) => ({ id: m.user_id, role: m.role, ...m.profiles! }));
  const chart = people
    .map((p) => {
      const w = load.get(p.id);
      return {
        name: displayName(p),
        onTrack: Number(w?.open_count ?? 0) - Number(w?.overdue_count ?? 0),
        overdue: Number(w?.overdue_count ?? 0),
      };
    })
    .filter((r) => r.onTrack + r.overdue > 0);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Team", href: "/team?tab=departments" }, { label: dept.name }]}
        title={dept.name}
        description={dept.description || (dept.manager ? `Managed by ${displayName(dept.manager)}` : undefined)}
      />
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Members ({people.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {people.map((p) => (
                <li key={p.id}>
                  <Link href={`/team/${p.id}`} className="flex items-center gap-2 text-sm hover:underline">
                    <UserAvatar size="sm" name={displayName(p)} id={p.id} />
                    <span className="min-w-0 flex-1 truncate">{displayName(p)}</span>
                    <span className="text-xs text-muted-foreground">
                      {dept.manager?.id === p.id ? "Manager" : ROLE_LABEL[p.role]}
                    </span>
                  </Link>
                </li>
              ))}
              {!people.length ? <li className="text-sm text-muted-foreground">No members.</li> : null}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Workload</CardTitle>
          </CardHeader>
          <CardContent>
            {chart.length ? (
              <WorkloadChart data={chart} />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No open assigned tasks.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <h2 className="mb-3 text-sm font-semibold">Department tasks</h2>
      <Suspense fallback={<TaskListSkeleton />}>
        <TaskListView
          searchParams={searchParams}
          basePath={`/team/departments/${id}`}
          overrides={{ department: id }}
          emptyTitle="No tasks for this department"
        />
      </Suspense>
    </>
  );
}

export default function DepartmentPage(props: PageProps<"/team/departments/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <DepartmentContent {...props} />
    </Suspense>
  );
}
