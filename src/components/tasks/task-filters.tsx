"use client";

import {
  ArrowDownWideNarrowIcon,
  ArrowUpNarrowWideIcon,
  KanbanSquareIcon,
  ListIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, NativeSelect } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { Label } from "@/components/ui/primitives";
import { PRIORITY_LABEL, STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/constants";
import { cn } from "@/lib/utils";

export type FilterOptions = {
  members: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  labels: { id: string; name: string; color: string }[];
  departments: { id: string; name: string }[];
};

type Hidden = Partial<Record<"assignee" | "creator" | "project" | "view" | "archived", boolean>>;

const SORT_OPTIONS = [
  { value: "updated", label: "Last updated" },
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "created", label: "Created" },
  { value: "key", label: "Task ID" },
];

export function TaskFilters({ options, hide = {} }: { options: FilterOptions; hide?: Hidden }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = React.useState(params.get("q") ?? "");

  const setParams = React.useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (!("page" in updates)) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // Debounce the search box into the URL.
  React.useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = window.setTimeout(() => setParams({ q: q.trim() || null }), 300);
    return () => window.clearTimeout(t);
  }, [q, params, setParams]);

  const csv = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
  const toggleCsv = (key: string, value: string) => {
    const cur = csv(key);
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    setParams({ [key]: next.join(",") || null });
  };

  const statuses = csv("status");
  const priorities = csv("priority");
  const view = params.get("view") ?? "list";
  const sort = params.get("sort") ?? "updated";
  const dir = params.get("dir") ?? (sort === "due" ? "asc" : "desc");
  const advancedKeys = [
    "creator",
    "department",
    "label",
    "created_from",
    "created_to",
    "completed_from",
    "completed_to",
    "due_from",
    "due_to",
    "archived",
    "blocked",
  ];
  const advancedCount = advancedKeys.filter((k) => params.get(k)).length;
  const anyFilter = ["q", "status", "priority", "assignee", "project", "due", "open", ...advancedKeys].some(
    (k) => params.get(k) && !(hide as Record<string, boolean>)[k],
  );

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by ID, title, description"
            className="pl-8"
            aria-label="Search tasks"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className={cn(statuses.length && "border-primary/50")}>
              Status{statuses.length ? ` · ${statuses.length}` : ""}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {TASK_STATUSES.map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={statuses.includes(s)}
                onCheckedChange={() => toggleCsv("status", s)}
                onSelect={(e) => e.preventDefault()}
              >
                {STATUS_LABEL[s]}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={params.get("open") === "1"}
              onCheckedChange={(c) => setParams({ open: c ? "1" : null })}
              onSelect={(e) => e.preventDefault()}
            >
              Open only (not done)
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className={cn(priorities.length && "border-primary/50")}>
              Priority{priorities.length ? ` · ${priorities.length}` : ""}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {[...TASK_PRIORITIES].reverse().map((p) => (
              <DropdownMenuCheckboxItem
                key={p}
                checked={priorities.includes(p)}
                onCheckedChange={() => toggleCsv("priority", p)}
                onSelect={(e) => e.preventDefault()}
              >
                {PRIORITY_LABEL[p]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {!hide.assignee ? (
          <NativeSelect
            aria-label="Assignee"
            className="h-8 w-auto max-w-44 text-sm"
            value={params.get("assignee") ?? ""}
            onChange={(e) => setParams({ assignee: e.target.value || null })}
          >
            <option value="">Any assignee</option>
            <option value="me">Assigned to me</option>
            <option value="none">Unassigned</option>
            {options.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        ) : null}

        {!hide.project ? (
          <NativeSelect
            aria-label="Project"
            className="h-8 w-auto max-w-44 text-sm"
            value={params.get("project") ?? ""}
            onChange={(e) => setParams({ project: e.target.value || null })}
          >
            <option value="">Any project</option>
            <option value="none">No project</option>
            {options.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        ) : null}

        <NativeSelect
          aria-label="Due date"
          className="h-8 w-auto text-sm"
          value={params.get("due") ?? ""}
          onChange={(e) => setParams({ due: e.target.value || null })}
        >
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Due in 7 days</option>
          <option value="none">No due date</option>
        </NativeSelect>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn(advancedCount && "border-primary/50")}>
              <SlidersHorizontalIcon /> More{advancedCount ? ` · ${advancedCount}` : ""}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <div className="grid gap-3">
              {!hide.creator ? (
                <FilterSelect label="Creator" value={params.get("creator") ?? ""} onChange={(v) => setParams({ creator: v })}>
                  <option value="">Anyone</option>
                  <option value="me">Me</option>
                  {options.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </FilterSelect>
              ) : null}
              <FilterSelect label="Department" value={params.get("department") ?? ""} onChange={(v) => setParams({ department: v })}>
                <option value="">Any department</option>
                {options.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect label="Label" value={params.get("label") ?? ""} onChange={(v) => setParams({ label: v })}>
                <option value="">Any label</option>
                {options.labels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </FilterSelect>
              <DateRange
                label="Due between"
                from={params.get("due_from") ?? ""}
                to={params.get("due_to") ?? ""}
                onChange={(from, to) => setParams({ due_from: from, due_to: to })}
              />
              <DateRange
                label="Created between"
                from={params.get("created_from") ?? ""}
                to={params.get("created_to") ?? ""}
                onChange={(from, to) => setParams({ created_from: from, created_to: to })}
              />
              <DateRange
                label="Completed between"
                from={params.get("completed_from") ?? ""}
                to={params.get("completed_to") ?? ""}
                onChange={(from, to) => setParams({ completed_from: from, completed_to: to })}
              />
              {!hide.archived ? (
                <FilterSelect label="Archived" value={params.get("archived") ?? ""} onChange={(v) => setParams({ archived: v })}>
                  <option value="">Hide archived</option>
                  <option value="include">Include archived</option>
                  <option value="only">Only archived</option>
                </FilterSelect>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={params.get("blocked") === "1"}
                  onChange={(e) => setParams({ blocked: e.target.checked ? "1" : null })}
                />
                Blocked tasks only
              </label>
            </div>
          </PopoverContent>
        </Popover>

        {anyFilter ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              const keep = new URLSearchParams();
              for (const k of ["view", "sort", "dir"]) {
                const v = params.get(k);
                if (v) keep.set(k, v);
              }
              router.replace(keep.size ? `${pathname}?${keep}` : pathname, { scroll: false });
            }}
          >
            <XIcon /> Clear
          </Button>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <NativeSelect
            aria-label="Sort by"
            className="h-8 w-auto text-sm"
            value={sort}
            onChange={(e) => setParams({ sort: e.target.value === "updated" ? null : e.target.value, dir: null })}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={dir === "asc" ? "Sort ascending" : "Sort descending"}
            onClick={() => setParams({ dir: dir === "asc" ? "desc" : "asc" })}
          >
            {dir === "asc" ? <ArrowUpNarrowWideIcon /> : <ArrowDownWideNarrowIcon />}
          </Button>
          {!hide.view ? (
            <div className="flex rounded-md border bg-card p-0.5" role="group" aria-label="View">
              <Button
                variant={view === "list" ? "secondary" : "ghost"}
                size="xs"
                aria-pressed={view === "list"}
                onClick={() => setParams({ view: null })}
              >
                <ListIcon /> List
              </Button>
              <Button
                variant={view === "board" ? "secondary" : "ghost"}
                size="xs"
                aria-pressed={view === "board"}
                onClick={() => setParams({ view: "board" })}
              >
                <KanbanSquareIcon /> Board
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string | null) => void;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <NativeSelect id={id} className="h-8 text-sm" value={value} onChange={(e) => onChange(e.target.value || null)}>
        {children}
      </NativeSelect>
    </div>
  );
}

function DateRange({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string | null, to: string | null) => void;
}) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-xs font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <Input type="date" aria-label={`${label} from`} className="h-8 text-sm" value={from} onChange={(e) => onChange(e.target.value || null, to || null)} />
        <Input type="date" aria-label={`${label} to`} className="h-8 text-sm" value={to} onChange={(e) => onChange(from || null, e.target.value || null)} />
      </div>
    </fieldset>
  );
}
