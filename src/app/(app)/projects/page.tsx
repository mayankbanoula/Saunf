import { FolderKanbanIcon, LockIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { NewProjectButton } from "@/components/projects/project-dialogs";
import { Badge, Card, Progress, Skeleton, UserAvatar } from "@/components/ui/primitives";
import { requireViewer } from "@/lib/auth/session";
import { formatDueDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_STATUS_LABEL } from "@/lib/tasks/constants";
import { queryContext } from "@/lib/tasks/queries";
import { displayName } from "@/lib/utils";

export const metadata: Metadata = { title: "Projects" };

type SP = Record<string, string | string[] | undefined>;

async function ProjectsContent({ searchParams }: { searchParams: Promise<SP> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const showArchived = sp.archived === "1";
  const supabase = await createClient();
  const ctx = queryContext(viewer);

  let query = supabase
    .from("projects")
    .select("id, name, description, status, is_private, target_date, archived_at, owner:profiles!projects_owner_profile_fkey(id, full_name, email), project_members(count)")
    .order("name");
  query = showArchived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  const [{ data: projects, error }, { data: progress }] = await Promise.all([query, supabase.rpc("project_progress")]);
  if (error) throw new Error(`Could not load projects: ${error.message}`);
  const stats = new Map((progress ?? []).map((p) => [p.project_id, p]));

  return (
    <>
      <div className="mb-4 flex gap-3 text-sm">
        <Link href="/projects" className={!showArchived ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}>
          Active
        </Link>
        <Link href="/projects?archived=1" className={showArchived ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}>
          Archived
        </Link>
      </div>
      {!projects?.length ? (
        <EmptyState
          icon={FolderKanbanIcon}
          title={showArchived ? "No archived projects" : "No projects yet"}
          description={viewer.role === "employee" ? "Projects created by managers and admins appear here." : "Create a project to group related work."}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const s = stats.get(p.id);
            const total = Number(s?.total ?? 0);
            const done = Number(s?.done ?? 0);
            const pct = total ? Math.round((done / total) * 100) : 0;
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="group">
                <Card className="h-full p-4 transition-colors group-hover:border-primary/40">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <h2 className="font-semibold group-hover:text-primary">{p.name}</h2>
                    <div className="flex shrink-0 gap-1">
                      {p.is_private ? (
                        <Badge variant="outline">
                          <LockIcon /> Private
                        </Badge>
                      ) : null}
                      <Badge variant={p.status === "active" ? "accent" : "secondary"}>{PROJECT_STATUS_LABEL[p.status]}</Badge>
                    </div>
                  </div>
                  <p className="mb-3 line-clamp-2 min-h-10 text-sm text-muted-foreground">{p.description || "No description."}</p>
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>
                      {done}/{total} tasks done{Number(s?.overdue ?? 0) > 0 ? <span className="text-destructive"> · {s?.overdue} overdue</span> : null}
                    </span>
                    <span>{pct}%</span>
                  </div>
                  <Progress value={pct} aria-label={`${pct}% complete`} />
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      {p.owner ? <UserAvatar size="xs" name={displayName(p.owner)} id={p.owner.id} /> : null}
                      {p.owner ? displayName(p.owner) : "No owner"} · {p.project_members[0]?.count ?? 0} members
                    </span>
                    {p.target_date ? <span>Target {formatDueDate(p.target_date, null, ctx.today)}</span> : null}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

async function HeaderActions() {
  const viewer = await requireViewer();
  if (viewer.role === "employee") return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_members")
    .select("user_id, profiles!workspace_members_user_id_fkey(full_name, email)")
    .eq("workspace_id", viewer.workspaceId)
    .eq("is_active", true);
  const members = (data ?? []).map((m) => ({ id: m.user_id, name: displayName(m.profiles) })).sort((a, b) => a.name.localeCompare(b.name));
  return <NewProjectButton members={members} />;
}

export default function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  return (
    <>
      <PageHeader
        title="Projects"
        description="Projects you can access. Private projects are visible only to their members."
        actions={
          <Suspense>
            <HeaderActions />
          </Suspense>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <ProjectsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
