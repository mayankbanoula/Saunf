import { LockIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { NewProjectButton } from "@/components/projects/project-dialogs";
import { LocalDateTime } from "@/components/time";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_STATUS_LABEL } from "@/lib/tasks/constants";
import { displayName } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Projects" };

async function Projects() {
  const viewer = await requireRole(["admin"]);
  const supabase = await createClient();
  const [{ data: projects, error }, { data: members }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, is_private, archived_at, created_at, owner:profiles!projects_owner_profile_fkey(id, full_name, email), project_members(count), tasks!tasks_workspace_id_project_id_fkey(count)")
      .order("archived_at", { nullsFirst: true })
      .order("name"),
    supabase
      .from("workspace_members")
      .select("user_id, profiles!workspace_members_user_id_fkey(full_name, email)")
      .eq("workspace_id", viewer.workspaceId)
      .eq("is_active", true),
  ]);
  if (error) throw new Error(`Could not load projects: ${error.message}`);
  const people = (members ?? []).map((m) => ({ id: m.user_id, name: displayName(m.profiles) })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Admins can see and manage every project, including private ones.</p>
        <NewProjectButton members={people} />
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Project</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Owner</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead className="text-right">Tasks</TableHead>
              <TableHead className="hidden lg:table-cell">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(projects ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/projects/${p.id}`} className="flex items-center gap-1.5 font-medium hover:underline">
                    {p.is_private ? <LockIcon className="size-3.5 text-muted-foreground" aria-label="Private" /> : null}
                    {p.name}
                  </Link>
                </TableCell>
                <TableCell>
                  {p.archived_at ? <Badge variant="warning">Archived</Badge> : <Badge variant="secondary">{PROJECT_STATUS_LABEL[p.status]}</Badge>}
                </TableCell>
                <TableCell className="hidden md:table-cell">{p.owner ? displayName(p.owner) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{p.project_members[0]?.count ?? 0}</TableCell>
                <TableCell className="text-right tabular-nums">{p.tasks[0]?.count ?? 0}</TableCell>
                <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                  <LocalDateTime iso={p.created_at} dateOnly />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

export default function AdminProjectsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <Projects />
    </Suspense>
  );
}
