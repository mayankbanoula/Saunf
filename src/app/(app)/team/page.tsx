import { UsersIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge, Card, Skeleton, UserAvatar } from "@/components/ui/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/tasks/constants";
import { displayName } from "@/lib/utils";

export const metadata: Metadata = { title: "Team" };

type SP = Record<string, string | string[] | undefined>;

async function TeamContent({ searchParams }: { searchParams: Promise<SP> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const tab = sp.tab === "departments" ? "departments" : "people";
  const supabase = await createClient();

  const [{ data: members, error }, { data: departments }, { data: workload }] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("user_id, role, department_id, profiles!workspace_members_user_id_fkey(full_name, email, job_title)")
      .eq("workspace_id", viewer.workspaceId)
      .eq("is_active", true),
    supabase
      .from("departments")
      .select("id, name, description, manager:profiles!departments_manager_id_fkey(id, full_name, email)")
      .order("name"),
    supabase.rpc("workload_by_member"),
  ]);
  if (error) throw new Error(`Could not load team: ${error.message}`);
  const deptName = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const load = new Map((workload ?? []).map((w) => [w.user_id, w]));
  const people = (members ?? [])
    .map((m) => ({ id: m.user_id, role: m.role, dept: m.department_id, ...m.profiles! }))
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));

  return (
    <>
      <div className="mb-4 flex rounded-md border bg-card p-0.5 sm:w-fit" role="group" aria-label="Team view">
        <Button asChild size="xs" variant={tab === "people" ? "secondary" : "ghost"}>
          <Link href="/team">People ({people.length})</Link>
        </Button>
        <Button asChild size="xs" variant={tab === "departments" ? "secondary" : "ghost"}>
          <Link href="/team?tab=departments">Departments ({departments?.length ?? 0})</Link>
        </Button>
      </div>
      {tab === "people" ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead className="hidden sm:table-cell">Role</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((p) => {
                const w = load.get(p.id);
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={`/team/${p.id}`} className="flex items-center gap-3 hover:underline">
                        <UserAvatar name={displayName(p)} id={p.id} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{displayName(p)}</span>
                          <span className="block truncate text-xs text-muted-foreground">{p.job_title ?? p.email}</span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {p.dept ? deptName.get(p.dept) : "—"}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant={p.role === "employee" ? "secondary" : "accent"}>{ROLE_LABEL[p.role]}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Link href={`/tasks?assignee=${p.id}&open=1`} className="hover:underline">
                        {w?.open_count ?? 0}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(w?.overdue_count ?? 0) > 0 ? (
                        <Link href={`/tasks?assignee=${p.id}&due=overdue`} className="text-destructive hover:underline">
                          {w?.overdue_count}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      ) : !departments?.length ? (
        <EmptyState
          icon={UsersIcon}
          title="No departments yet"
          description="Admins can create departments in the Admin panel."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {departments.map((d) => {
            const inDept = people.filter((p) => p.dept === d.id);
            const open = inDept.reduce((n, p) => n + Number(load.get(p.id)?.open_count ?? 0), 0);
            const overdue = inDept.reduce((n, p) => n + Number(load.get(p.id)?.overdue_count ?? 0), 0);
            return (
              <Link key={d.id} href={`/team/departments/${d.id}`} className="group">
                <Card className="h-full p-4 transition-colors group-hover:border-primary/40">
                  <h2 className="font-semibold group-hover:text-primary">{d.name}</h2>
                  <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
                    {d.description || "No description."}
                  </p>
                  <div className="text-xs text-muted-foreground">
                    Manager: {d.manager ? displayName(d.manager) : "—"} · {inDept.length} people
                  </div>
                  <div className="mt-1 text-xs">
                    {open} open tasks{overdue ? <span className="text-destructive"> · {overdue} overdue</span> : null}
                  </div>
                  <div className="mt-3 flex -space-x-1.5">
                    {inDept.slice(0, 8).map((p) => (
                      <UserAvatar key={p.id} size="sm" name={displayName(p)} id={p.id} className="ring-2 ring-card" />
                    ))}
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

export default function TeamPage({ searchParams }: PageProps<"/team">) {
  return (
    <>
      <PageHeader title="Team" description="People and departments in your workspace." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <TeamContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
