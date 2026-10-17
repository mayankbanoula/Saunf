import { AlertOctagonIcon, ArchiveIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ActivityTimeline } from "@/components/activity-timeline";
import { PageHeader } from "@/components/layout/page-header";
import { Attachments } from "@/components/tasks/detail/attachments";
import { Comments } from "@/components/tasks/detail/comments";
import { Dependencies, Subtasks } from "@/components/tasks/detail/relations";
import { TaskActions } from "@/components/tasks/detail/task-actions";
import {
  BlockedControl,
  DueDateControl,
  PriorityControl,
  ProgressControl,
  ReassignButton,
  StatusControl,
} from "@/components/tasks/detail/task-controls";
import { BlockedBadge, DueDate, LabelChip, PriorityBadge, StatusBadge } from "@/components/tasks/task-badges";
import { LocalDateTime } from "@/components/time";
import { Alert, Card, CardContent, CardHeader, CardTitle, Skeleton, UserAvatar } from "@/components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { requireViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getTaskDetail } from "@/lib/tasks/detail";
import { queryContext } from "@/lib/tasks/queries";
import { displayName } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/tasks/[key]">): Promise<Metadata> {
  const { key } = await params;
  return { title: decodeURIComponent(key).toUpperCase() };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.75rem_1fr] items-center gap-2 py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function Person({ p }: { p: { id: string; full_name: string; email: string } | null }) {
  if (!p) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <UserAvatar size="sm" name={displayName(p)} id={p.id} />
      <span className="truncate">{displayName(p)}</span>
    </span>
  );
}

async function TaskDetailContent({ params }: { params: PageProps<"/tasks/[key]">["params"] }) {
  const { key } = await params;
  const viewer = await requireViewer();
  const supabase = await createClient();
  const detail = await getTaskDetail(supabase, viewer, decodeURIComponent(key));
  if (!detail) notFound();
  const { task, permissions } = detail;
  const ctx = queryContext(viewer);

  const { data: memberRows } = await supabase
    .from("workspace_members")
    .select("user_id, department_id, profiles!workspace_members_user_id_fkey(full_name, email)")
    .eq("workspace_id", viewer.workspaceId)
    .eq("is_active", true);
  const members = (memberRows ?? [])
    .map((m) => ({ id: m.user_id, full_name: displayName(m.profiles), department_id: m.department_id }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const editable = {
    id: task.id,
    key: task.key,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    progress: task.progress,
    assignee_id: task.assignee_id,
    project_id: task.project_id,
    department_id: task.department_id,
    parent_id: task.parent_id,
    start_date: task.start_date,
    due_date: task.due_date,
    due_time: task.due_time,
    estimate_hours: task.estimate_hours,
    label_ids: task.labels.map((l) => l.id),
    collaborator_ids: task.collaborators.map((c) => c.id),
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Tasks", href: "/tasks" },
          ...(task.project ? [{ label: task.project.name, href: `/projects/${task.project.id}` }] : []),
          ...(task.parent ? [{ label: task.parent.key, href: `/tasks/${task.parent.key}` }] : []),
          { label: task.key },
        ]}
        title={
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-base font-normal text-muted-foreground">{task.key}</span>
            <span className="whitespace-normal">{task.title}</span>
          </span>
        }
        description={
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.is_blocked ? <BlockedBadge /> : null}
            {task.due_date ? (
              <span className="text-xs">
                Due <DueDate task={task} today={ctx.today} nowTime={ctx.nowTime} />
              </span>
            ) : null}
          </span>
        }
        actions={<TaskActions task={editable} permissions={permissions} />}
      />

      {task.archived_at ? (
        <Alert variant="warning" className="mb-4">
          <ArchiveIcon />
          <span>
            Archived by {displayName(task.archived_by_profile)} on <LocalDateTime iso={task.archived_at} />. Restore it
            to make changes.
          </span>
        </Alert>
      ) : null}
      {task.is_blocked ? (
        <Alert variant="destructive" className="mb-4">
          <AlertOctagonIcon />
          <span>
            <strong>Blocked.</strong> {task.blocker_description || "No description given."}
          </span>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              {task.description ? (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{task.description}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No description.</p>
              )}
            </CardContent>
          </Card>

          <Subtasks parent={task} subtasks={detail.subtasks} canAdd={permissions.edit} />
          <Dependencies
            taskId={task.id}
            blockedBy={detail.blockedBy}
            blocking={detail.blocking}
            canEdit={permissions.edit}
          />
          <Attachments
            taskId={task.id}
            attachments={detail.attachments}
            canUpload={permissions.comment}
            canDeleteAny={permissions.edit || viewer.role === "admin"}
            viewerId={viewer.id}
          />
          <Comments
            taskId={task.id}
            comments={detail.comments}
            members={members}
            viewerId={viewer.id}
            isAdmin={viewer.role === "admin"}
            canComment={permissions.comment}
          />

          <section aria-labelledby="history-heading">
            <h2 id="history-heading" className="mb-3 text-sm font-semibold">
              History
            </h2>
            <Tabs defaultValue="activity">
              <TabsList>
                <TabsTrigger value="activity">Activity</TabsTrigger>
                <TabsTrigger value="assignments">Assignments ({detail.assignments.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="activity" className="mt-4 pl-3">
                <ActivityTimeline events={detail.activity} />
              </TabsContent>
              <TabsContent value="assignments" className="mt-4">
                {detail.assignments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">This task has never been assigned.</p>
                ) : (
                  <ol className="divide-y rounded-md border bg-card">
                    {detail.assignments.map((a) => (
                      <li key={a.id} className="px-3 py-2 text-sm">
                        <div>
                          <span className="font-medium">{a.by ? displayName(a.by) : "System"}</span>{" "}
                          {a.previous ? (
                            <>
                              reassigned from <span className="font-medium">{displayName(a.previous)}</span> to{" "}
                            </>
                          ) : (
                            "assigned to "
                          )}
                          <span className="font-medium">{a.next ? displayName(a.next) : "nobody"}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <LocalDateTime iso={a.changed_at} />
                          {a.note ? <> · “{a.note}”</> : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </TabsContent>
            </Tabs>
          </section>
        </div>

        <aside className="grid content-start gap-4">
          <Card>
            <CardContent className="pt-4">
              <dl className="divide-y">
                <Row label="Status">
                  <StatusControl taskId={task.id} status={task.status} disabled={!permissions.work} />
                </Row>
                <Row label="Assignee">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Person p={task.assignee} />
                    {permissions.reassign ? (
                      <ReassignButton
                        taskId={task.id}
                        currentAssigneeId={task.assignee_id}
                        members={members}
                        viewer={detail.permViewer}
                      />
                    ) : null}
                  </div>
                </Row>
                <Row label="Priority">
                  <PriorityControl taskId={task.id} priority={task.priority} disabled={!permissions.edit} />
                </Row>
                <Row label="Due">
                  <DueDateControl
                    taskId={task.id}
                    dueDate={task.due_date}
                    dueTime={task.due_time}
                    startDate={task.start_date}
                    disabled={!permissions.edit}
                  />
                </Row>
                <Row label="Progress">
                  <ProgressControl taskId={task.id} progress={task.progress} disabled={!permissions.work} />
                </Row>
                <Row label="Blocked">
                  <BlockedControl
                    taskId={task.id}
                    isBlocked={task.is_blocked}
                    description={task.blocker_description}
                    disabled={!permissions.work}
                  />
                </Row>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <dl className="divide-y">
                <Row label="Project">
                  {task.project ? (
                    <Link href={`/projects/${task.project.id}`} className="hover:underline">
                      {task.project.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </Row>
                <Row label="Department">
                  {task.department?.name ?? <span className="text-muted-foreground">None</span>}
                </Row>
                <Row label="Labels">
                  {task.labels.length ? (
                    <div className="flex flex-wrap gap-1">
                      {task.labels.map((l) => (
                        <Link key={l.id} href={`/tasks?label=${l.id}`}>
                          <LabelChip label={l} />
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </Row>
                <Row label="Collaborators">
                  {task.collaborators.length ? (
                    <div className="flex flex-wrap gap-1">
                      {task.collaborators.map((c) => (
                        <UserAvatar key={c.id} size="sm" name={displayName(c)} id={c.id} />
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </Row>
                <Row label="Start date">{task.start_date ?? <span className="text-muted-foreground">—</span>}</Row>
                <Row label="Estimate">
                  {task.estimate_hours ? `${task.estimate_hours} h` : <span className="text-muted-foreground">—</span>}
                </Row>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <dl className="divide-y">
                <Row label="Created by">
                  <Person p={task.creator} />
                </Row>
                <Row label="Created">
                  <LocalDateTime iso={task.created_at} />
                </Row>
                <Row label="Assigned">
                  {task.assigned_at ? (
                    <span>
                      <LocalDateTime iso={task.assigned_at} />
                      {task.assigned_by_profile ? (
                        <span className="block text-xs text-muted-foreground">
                          by {displayName(task.assigned_by_profile)}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Row>
                <Row label="Updated">
                  <LocalDateTime iso={task.updated_at} />
                </Row>
                {task.completed_at ? (
                  <Row label="Completed">
                    <span>
                      <LocalDateTime iso={task.completed_at} />
                      {task.completed_by_profile ? (
                        <span className="block text-xs text-muted-foreground">
                          by {displayName(task.completed_by_profile)}
                        </span>
                      ) : null}
                    </span>
                  </Row>
                ) : null}
              </dl>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}

function TaskDetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-7 w-2/3" />
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-24" />
          <Skeleton className="h-48" />
        </div>
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}

export default function TaskPage({ params }: PageProps<"/tasks/[key]">) {
  return (
    <Suspense fallback={<TaskDetailSkeleton />}>
      <TaskDetailContent params={params} />
    </Suspense>
  );
}
