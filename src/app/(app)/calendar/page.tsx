import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { PersonPicker } from "@/components/person-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { requireViewer } from "@/lib/auth/session";
import { dueTone } from "@/lib/dates";
import { assigneeParam, requestedMember, resolvePeopleView } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";
import { STATUS_DOT } from "@/lib/tasks/constants";
import { queryContext } from "@/lib/tasks/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendar" };

const MAX_TASKS = 600;
const TONE_CLASS = {
  overdue: "border-destructive/40 bg-destructive/5 text-destructive",
  today: "border-warning/50 bg-warning/10",
  soon: "border-warning/30 bg-warning/5",
  later: "border-border bg-card",
  done: "border-border bg-muted text-muted-foreground line-through",
  none: "border-border bg-card",
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function CalendarContent({ searchParams }: { searchParams: Promise<SP> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const ctx = queryContext(viewer);
  const mode = one(sp.view) === "week" ? "week" : "month";
  const viewPromise = resolvePeopleView(viewer, sp.person);
  const rawDate = one(sp.date);
  const anchor = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? parseISO(rawDate) : parseISO(ctx.today);

  const rangeStart =
    mode === "month"
      ? startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 })
      : startOfWeek(anchor, { weekStartsOn: 1 });
  const rangeEnd =
    mode === "month" ? endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }) : endOfWeek(anchor, { weekStartsOn: 1 });
  const days: Date[] = [];
  for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 1)) days.push(d);

  const supabase = await createClient();
  // Tasks you're involved in (plus your reportees'; admins: all), narrowed by the person picker.
  const query = supabase
    .rpc("tasks_in_view", { p_member: requestedMember(viewer, sp.person) })
    .select("id, key, title, status, priority, due_date, due_time")
    .is("archived_at", null)
    .gte("due_date", format(rangeStart, "yyyy-MM-dd"))
    .lte("due_date", format(rangeEnd, "yyyy-MM-dd"))
    .order("due_time", { nullsFirst: true })
    .limit(MAX_TASKS);
  const [view, { data: tasks, error }] = await Promise.all([viewPromise, query]);
  if (error) throw new Error(`Could not load calendar: ${error.message}`);

  const byDay = new Map<string, NonNullable<typeof tasks>>();
  for (const t of tasks ?? []) {
    const list = byDay.get(t.due_date!) ?? [];
    list.push(t);
    byDay.set(t.due_date!, list);
  }

  const href = (date: Date, overrides: Record<string, string | null> = {}) => {
    const p = new URLSearchParams();
    if (mode === "week") p.set("view", "week");
    if (view.current !== view.options[0]?.value && view.options.length) p.set("person", view.current);
    p.set("date", format(date, "yyyy-MM-dd"));
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    return `/calendar?${p}`;
  };
  const prev = mode === "month" ? addMonths(anchor, -1) : addWeeks(anchor, -1);
  const next = mode === "month" ? addMonths(anchor, 1) : addWeeks(anchor, 1);
  const title =
    mode === "month"
      ? format(anchor, "MMMM yyyy")
      : `${format(rangeStart, "d MMM")} – ${format(rangeEnd, "d MMM yyyy")}`;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon-sm">
            <Link href={href(prev)} aria-label={mode === "month" ? "Previous month" : "Previous week"}>
              <ChevronLeftIcon />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={href(parseISO(ctx.today))}>Today</Link>
          </Button>
          <Button asChild variant="outline" size="icon-sm">
            <Link href={href(next)} aria-label={mode === "month" ? "Next month" : "Next week"}>
              <ChevronRightIcon />
            </Link>
          </Button>
        </div>
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="ml-auto flex items-center gap-2">
          <PersonPicker current={view.current} options={view.options} />
          <div className="flex rounded-md border bg-card p-0.5" role="group" aria-label="Calendar view">
            <Button asChild size="xs" variant={mode === "month" ? "secondary" : "ghost"}>
              <Link href={href(anchor, { view: null })}>Month</Link>
            </Button>
            <Button asChild size="xs" variant={mode === "week" ? "secondary" : "ghost"}>
              <Link href={href(anchor, { view: "week" })}>Week</Link>
            </Button>
          </div>
        </div>
      </div>
      {(tasks?.length ?? 0) >= MAX_TASKS ? (
        <p className="mb-2 text-xs text-muted-foreground">Showing the first {MAX_TASKS} tasks in this range.</p>
      ) : null}

      <div className="relative overflow-x-auto rounded-lg border bg-card">
        <div className="grid min-w-[720px] grid-cols-7">
          {days.slice(0, 7).map((d) => (
            <div key={d.toISOString()} className="border-b px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {format(d, "EEE")}
            </div>
          ))}
          {days.map((d) => {
            const iso = format(d, "yyyy-MM-dd");
            const list = byDay.get(iso) ?? [];
            const isToday = iso === ctx.today;
            const outside = mode === "month" && !isSameMonth(d, anchor);
            const limit = mode === "month" ? 4 : 20;
            return (
              <div
                key={iso}
                className={cn(
                  "min-w-0 overflow-hidden border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0",
                  mode === "month" ? "min-h-28" : "min-h-80",
                  outside && "bg-muted/40",
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs",
                      isToday && "bg-primary font-semibold text-primary-foreground",
                      outside && "text-muted-foreground",
                    )}
                  >
                    {format(d, "d")}
                  </span>
                  {list.length > 0 ? <span className="text-[10px] text-muted-foreground">{list.length}</span> : null}
                </div>
                <ul className="grid min-w-0 gap-1">
                  {list.slice(0, limit).map((t) => {
                    const tone = dueTone(t, ctx.today, ctx.nowTime);
                    return (
                      <li key={t.id} className="min-w-0">
                        <Link
                          href={`/tasks/${t.key}`}
                          title={`${t.key} · ${t.title}${tone === "overdue" ? " (overdue)" : ""}`}
                          className={cn(
                            "flex min-w-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:border-primary/50",
                            TONE_CLASS[tone],
                          )}
                        >
                          <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[t.status])} aria-hidden />
                          {t.due_time ? <span className="shrink-0 tabular-nums">{t.due_time.slice(0, 5)}</span> : null}
                          <span className="truncate">{t.title}</span>
                        </Link>
                      </li>
                    );
                  })}
                  {list.length > limit ? (
                    <li>
                      <Link
                        href={`/tasks?due_from=${iso}&due_to=${iso}${assigneeParam(view, viewer)}`}
                        className="px-1 text-[11px] text-primary hover:underline"
                      >
                        +{list.length - limit} more
                      </Link>
                    </li>
                  ) : null}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded border border-destructive/40 bg-destructive/5" /> Overdue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded border border-warning/50 bg-warning/10" /> Due today / within 3 days
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded border bg-muted" /> Done
        </span>
      </div>
    </>
  );
}

export default function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  return (
    <>
      <PageHeader title="Calendar" description="Tasks by due date. Archived tasks are hidden." />
      <Suspense fallback={<Skeleton className="h-[640px]" />}>
        <CalendarContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
