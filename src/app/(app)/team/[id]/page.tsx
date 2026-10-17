import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/layout/page-header";
import { TaskListSkeleton, TaskListView } from "@/components/tasks/task-list-view";
import { Badge, Card, Skeleton, UserAvatar } from "@/components/ui/primitives";
import { requireViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/tasks/constants";
import { displayName } from "@/lib/utils";

export const metadata: Metadata = { title: "Team member" };

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={tone === "danger" && value > 0 ? "text-xl font-semibold text-destructive" : "text-xl font-semibold"}
      >
        {value}
      </div>
    </Card>
  );
}

async function PersonContent({ params, searchParams }: PageProps<"/team/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requireViewer();
  const supabase = await createClient();
  const [{ data: member }, { data: workload }] = await Promise.all([
    supabase
      .from("workspace_members")
      .select(
        "user_id, role, is_active, joined_at, department:departments!workspace_members_workspace_id_department_id_fkey(id, name), profiles!workspace_members_user_id_fkey(full_name, email, job_title)",
      )
      .eq("workspace_id", viewer.workspaceId)
      .eq("user_id", id)
      .maybeSingle(),
    supabase.rpc("workload_by_member"),
  ]);
  if (!member?.profiles) notFound();
  const w = workload?.find((x) => x.user_id === id);
  const name = displayName(member.profiles);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Team", href: "/team" }, { label: name }]}
        title={
          <span className="flex items-center gap-3">
            <UserAvatar name={name} id={id} size="lg" />
            <span>
              {name}
              <span className="block text-sm font-normal text-muted-foreground">
                {member.profiles.job_title ?? "—"} · {member.profiles.email}
              </span>
            </span>
          </span>
        }
        actions={
          <>
            <Badge variant="accent">{ROLE_LABEL[member.role]}</Badge>
            {member.department ? <Badge variant="outline">{member.department.name}</Badge> : null}
            {!member.is_active ? <Badge variant="destructive">Deactivated</Badge> : null}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open tasks" value={Number(w?.open_count ?? 0)} />
        <Stat label="In progress" value={Number(w?.in_progress_count ?? 0)} />
        <Stat label="In review" value={Number(w?.in_review_count ?? 0)} />
        <Stat label="Overdue" value={Number(w?.overdue_count ?? 0)} tone="danger" />
      </div>
      <h2 className="mb-3 text-sm font-semibold">Assigned tasks you can see</h2>
      <Suspense fallback={<TaskListSkeleton />}>
        <TaskListView
          searchParams={searchParams}
          basePath={`/team/${id}`}
          overrides={{ assignee: id }}
          hide={{ assignee: true }}
          columns={["creator", "project", "progress", "updated"]}
          emptyTitle={`No tasks assigned to ${name.split(" ")[0]}`}
          emptyDescription="Only tasks you have access to are listed."
        />
      </Suspense>
    </>
  );
}

export default function PersonPage(props: PageProps<"/team/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <PersonContent {...props} />
    </Suspense>
  );
}
