"use client";

import { Command } from "cmdk";
import { FolderKanbanIcon, Loader2Icon, SearchIcon, TagIcon, UserIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { globalSearch, type SearchResults } from "@/actions/search";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { STATUS_DOT, STATUS_LABEL, type TaskStatus } from "@/lib/tasks/constants";
import { cn } from "@/lib/utils";

const itemClass = "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm data-[selected=true]:bg-muted";
const groupClass =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const res = await globalSearch(q);
      if (cancelled) return;
      setLoading(false);
      setResults(res.ok ? res.data : null);
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const empty =
    results && !results.tasks.length && !results.people.length && !results.projects.length && !results.labels.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-muted-foreground shadow-xs hover:bg-muted/50 sm:max-w-md"
      >
        <SearchIcon className="size-4" />
        <span className="flex-1 truncate text-left">Search tasks, people, projects…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
          showClose={false}
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <Command shouldFilter={false} className="flex flex-col">
            <div className="flex items-center gap-2 border-b px-3">
              <SearchIcon className="size-4 text-muted-foreground" />
              <Command.Input
                value={query}
                onValueChange={(v) => {
                  setQuery(v);
                  if (v.trim()) setLoading(true);
                  else {
                    setResults(null);
                    setLoading(false);
                  }
                }}
                placeholder="Search by task ID, title, person, project or label…"
                className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {loading ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-1">
              {!query.trim() ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Type to search your workspace.</p>
              ) : null}
              {empty ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">No results.</p> : null}
              {results?.tasks.length ? (
                <Command.Group heading="Tasks" className={groupClass}>
                  {results.tasks.map((t) => (
                    <Command.Item
                      key={t.id}
                      value={`task-${t.id}`}
                      onSelect={() => go(`/tasks/${t.key}`)}
                      className={itemClass}
                    >
                      <span
                        className={cn("size-2 rounded-full", STATUS_DOT[t.status as TaskStatus])}
                        title={STATUS_LABEL[t.status as TaskStatus]}
                      />
                      <span className="font-mono text-xs text-muted-foreground">{t.key}</span>
                      <span className="truncate">{t.title}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {results?.people.length ? (
                <Command.Group heading="People" className={groupClass}>
                  {results.people.map((p) => (
                    <Command.Item
                      key={p.id}
                      value={`person-${p.id}`}
                      onSelect={() => go(`/tasks?assignee=${p.id}`)}
                      className={itemClass}
                    >
                      <UserIcon className="size-4 text-muted-foreground" />
                      <span className="truncate">{p.full_name || p.email}</span>
                      <span className="truncate text-xs text-muted-foreground">{p.job_title ?? p.email}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {results?.projects.length ? (
                <Command.Group heading="Projects" className={groupClass}>
                  {results.projects.map((p) => (
                    <Command.Item
                      key={p.id}
                      value={`project-${p.id}`}
                      onSelect={() => go(`/projects/${p.id}`)}
                      className={itemClass}
                    >
                      <FolderKanbanIcon className="size-4 text-muted-foreground" />
                      <span className="truncate">{p.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {results?.labels.length ? (
                <Command.Group heading="Labels" className={groupClass}>
                  {results.labels.map((l) => (
                    <Command.Item
                      key={l.id}
                      value={`label-${l.id}`}
                      onSelect={() => go(`/tasks?label=${l.id}`)}
                      className={itemClass}
                    >
                      <TagIcon className="size-4" style={{ color: l.color }} />
                      <span className="truncate">{l.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {query.trim() ? (
                <Command.Item
                  value="see-all"
                  onSelect={() => go(`/search?q=${encodeURIComponent(query.trim())}`)}
                  className={cn(itemClass, "mt-1 border-t text-primary")}
                >
                  <SearchIcon className="size-4" /> See all results for “{query.trim()}”
                </Command.Item>
              ) : null}
            </Command.List>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
