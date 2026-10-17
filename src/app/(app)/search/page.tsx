import { SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { globalSearch } from "@/actions/search";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/tasks/task-badges";
import { Card, CardContent, CardHeader, CardTitle, Skeleton, UserAvatar } from "@/components/ui/primitives";
import { PROJECT_STATUS_LABEL, type ProjectStatus, type TaskStatus } from "@/lib/tasks/constants";

export const metadata: Metadata = { title: "Search" };

async function Results({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  if (!q) return <EmptyState icon={SearchIcon} title="Search your workspace" description="Use the search bar (Ctrl/⌘ K) to find tasks, people, projects and labels." />;
  const res = await globalSearch(q, 50);
  if (!res.ok) throw new Error(res.error);
  const { tasks, people, projects, labels } = res.data;
  if (!tasks.length && !people.length && !projects.length && !labels.length) {
    return <EmptyState icon={SearchIcon} title={`No results for “${q}”`} description="Try a task ID like SAU-00012, part of a title, or a person's name." />;
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader>
          <CardTitle>Tasks ({tasks.length})</CardTitle>
          <Link href={`/tasks?q=${encodeURIComponent(q)}`} className="text-xs text-primary hover:underline">
            Open in task list
          </Link>
        </CardHeader>
        <CardContent>
          {tasks.length ? (
            <ul className="divide-y">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2">
                  <span className="font-mono text-xs text-muted-foreground">{t.key}</span>
                  <Link href={`/tasks/${t.key}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                    {t.title}
                  </Link>
                  <StatusBadge status={t.status as TaskStatus} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No matching tasks.</p>
          )}
        </CardContent>
      </Card>
      <div className="grid content-start gap-5">
        <Card>
          <CardHeader>
            <CardTitle>People ({people.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {people.map((p) => (
                <li key={p.id}>
                  <Link href={`/team/${p.id}`} className="flex items-center gap-2 text-sm hover:underline">
                    <UserAvatar size="sm" name={p.full_name || p.email} id={p.id} />
                    <span className="truncate">{p.full_name || p.email}</span>
                  </Link>
                </li>
              ))}
              {!people.length ? <li className="text-sm text-muted-foreground">No matching people.</li> : null}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Projects ({projects.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/projects/${p.id}`} className="truncate hover:underline">
                    {p.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">{PROJECT_STATUS_LABEL[p.status as ProjectStatus]}</span>
                </li>
              ))}
              {!projects.length ? <li className="text-sm text-muted-foreground">No matching projects.</li> : null}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Labels ({labels.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {labels.map((l) => (
                <Link key={l.id} href={`/tasks?label=${l.id}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-muted">
                  <span className="size-2 rounded-full" style={{ background: l.color }} /> {l.name}
                </Link>
              ))}
              {!labels.length ? <span className="text-sm text-muted-foreground">No matching labels.</span> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <>
      <PageHeader title="Search results" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}
