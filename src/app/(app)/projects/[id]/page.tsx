import { LockIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ActivityTimeline } from "@/components/activity-timeline";
import { PageHeader } from "@/components/layout/page-header";
import { ProjectAdminButtons, ProjectMembers } from "@/components/projects/project-dialogs";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { TaskListSkeleton, TaskListView } from "@/components/tasks/task-list-view";
import { Badge, Card, CardContent, CardHeader, CardTitle, Progress, Skeleton } from "@/components/ui/primitives";
import type { ActivityEvent } from "@/lib/activity";
import { canCreateTasks, requireViewer } from "@/lib/auth/session";
import { formatDueDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_STATUS_LABEL } from "@/lib/tasks/constants";
import { queryContext } from "@/lib/tasks/queries";
import { displayName } from "@/lib/utils";

export const metadata: Metadata = { title: "Project" };

async function ProjectContent({ params, searchParams }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requireViewer();
  const supabase = await createClient();
  const ctx = queryContext(viewer);

  const { data: project } = await supabase
    .from("projects")
    .select(
      "*, owner:profiles!projects_owner_profile_fkey(id, full_name, email), project_members(user_id, role, profile:profiles!project_members_profile_fkey(id, full_name, email))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const [{ data: progress }, { data: activity }, { data: memberRows }] = await Promise.all([
    supabase.rpc("project_progress"),
    supabase
      .from("activity_events")
      .select(
        "id, event_type, created_at, old_value, new_value, metadata, actor:profiles!activity_events_actor_id_fkey(id, full_name, email), task:tasks(key, title)",
      )
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("workspace_members")
      .select("user_id, profiles!workspace_members_user_id_fkey(full_name, email)")
      .eq("workspace_id", viewer.workspaceId)
      .eq("is_active", true),
  ]);
  const stat = progress?.find((p) => p.project_id === id);
  const total = Number(stat?.total ?? 0);
  const done = Number(stat?.done ?? 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const candidates = (memberRows ?? [])
    .map((m) => ({ id: m.user_id, name: displayName(m.profiles) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const canManage =
    viewer.role === "admin" ||
    project.owner_id === viewer.id ||
    project.project_members.some((m) => m.user_id === viewer.id && m.role === "lead");
  const members = [
    ...(project.owner ? [{ id: project.owner.id, name: displayName(project.owner), role: "lead", isOwner: true }] : []),
    ...project.project_members
      .filter((m) => m.user_id !== project.owner_id && m.profile)
      .map((m) => ({ id: m.user_id, name: displayName(m.profile), role: m.role })),
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: project.name }]}
        title={project.name}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant={project.status === "active" ? "accent" : "secondary"}>
              {PROJECT_STATUS_LABEL[project.status]}
            </Badge>
            {project.is_private ? (
              <Badge variant="outline">
                <LockIcon /> Private
              </Badge>
            ) : null}
            {project.archived_at ? <Badge variant="warning">Archived</Badge> : null}
            {project.target_date ? (
              <span className="text-xs">Target {formatDueDate(project.target_date, null, ctx.today)}</span>
            ) : null}
          </span>
        }
        actions={
          <>
            {canCreateTasks(viewer) && !project.archived_at ? (
              <NewTaskButton defaults={{ project_id: project.id }} label="Add task" />
            ) : null}
            {canManage ? (
              <ProjectAdminButtons
                project={{
                  id: project.id,
                  name: project.name,
                  description: project.description,
                  status: project.status,
                  owner_id: project.owner_id,
                  start_date: project.start_date,
                  target_date: project.target_date,
                  is_private: project.is_private,
                }}
                members={candidates}
                archived={!!project.archived_at}
              />
            ) : null}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {project.description || "No description."}
            </p>
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span>
                  {done} of {total} tasks done
                  {Number(stat?.overdue ?? 0) > 0 ? (
                    <span className="text-destructive"> · {stat?.overdue} overdue</span>
                  ) : null}
                </span>
                <span className="font-medium">{pct}%</span>
              </div>
              <Progress value={pct} aria-label={`${pct}% complete`} />
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Owner</dt>
                <dd>{project.owner ? displayName(project.owner) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Start</dt>
                <dd>{project.start_date ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Target</dt>
                <dd>{project.target_date ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Visibility</dt>
                <dd>{project.is_private ? "Members only" : "Workspace"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectMembers projectId={project.id} members={members} candidates={candidates} canManage={canManage} />
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 text-sm font-semibold">Tasks</h2>
      <Suspense fallback={<TaskListSkeleton />}>
        <TaskListView
          searchParams={searchParams}
          basePath={`/projects/${project.id}`}
          overrides={{ project: project.id }}
          hide={{ project: true }}
          emptyTitle="No tasks in this project"
          createDefaults={{ project_id: project.id }}
        />
      </Suspense>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Project activity</CardTitle>
        </CardHeader>
        <CardContent className="pl-9">
          <ActivityTimeline
            events={(activity ?? []) as unknown as ActivityEvent[]}
            showTask
            emptyText="No activity yet."
          />
        </CardContent>
      </Card>
    </>
  );
}

export default function ProjectPage(props: PageProps<"/projects/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-48" />
          <TaskListSkeleton />
        </div>
      }
    >
      <ProjectContent {...props} />
    </Suspense>
  );
}
