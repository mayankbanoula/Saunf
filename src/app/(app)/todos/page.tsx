import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { PersonPicker } from "@/components/person-picker";
import { TodoBoard, type TodoItem } from "@/components/todos/todo-list";
import { Skeleton } from "@/components/ui/primitives";
import { requireViewer } from "@/lib/auth/session";
import { addDaysIso } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { queryContext } from "@/lib/tasks/queries";
import { displayName } from "@/lib/utils";
import type { TodoRepeat } from "@/lib/validation/todos";

export const metadata: Metadata = { title: "To-dos" };

const DONE_SHOWN = 30;
const isWeekend = (iso: string) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());
const dueOn = (repeat: TodoRepeat, day: string) => repeat === "daily" || (repeat === "weekdays" && !isWeekend(day));

async function TodosContent({ searchParams }: { searchParams: PageProps<"/todos">["searchParams"] }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const { today } = queryContext(viewer);
  const supabase = await createClient();

  // Lists are private: RLS returns only your own, except that admins can read anyone's.
  let ownerId = viewer.id;
  let picker: { current: string; options: { value: string; label: string }[] } | null = null;
  let ownerName = "";
  if (viewer.role === "admin") {
    const { data: members } = await supabase
      .from("workspace_members")
      .select("user_id, profiles!workspace_members_user_id_fkey(full_name, email)")
      .eq("workspace_id", viewer.workspaceId)
      .eq("is_active", true);
    const others = (members ?? [])
      .filter((m) => m.user_id !== viewer.id)
      .map((m) => ({ value: m.user_id, label: displayName(m.profiles) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const requested = typeof sp.person === "string" ? others.find((o) => o.value === sp.person) : undefined;
    if (requested) {
      ownerId = requested.value;
      ownerName = requested.label;
    }
    picker = { current: requested?.value ?? "me", options: [{ value: "me", label: "My list" }, ...others] };
  }

  const weekStart = addDaysIso(today, -6);
  const [{ data: todos, error }, { data: ticks, error: tickError }] = await Promise.all([
    supabase
      .from("todos")
      .select("id, title, repeat, due_date, completed_at, created_at")
      .eq("workspace_id", viewer.workspaceId)
      .eq("user_id", ownerId)
      .order("created_at"),
    supabase
      .from("todo_completions")
      .select("todo_id, day, todos!inner(user_id)")
      .eq("todos.user_id", ownerId)
      .gte("day", weekStart),
  ]);
  if (error || tickError) throw new Error(`Could not load to-dos: ${(error ?? tickError)!.message}`);

  const ticked = new Set((ticks ?? []).map((t) => `${t.todo_id}:${t.day}`));
  const week = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
  const items: TodoItem[] = (todos ?? []).map((t) =>
    t.repeat === "none"
      ? { ...t, done: t.completed_at !== null, dueToday: true, history: [] }
      : {
          ...t,
          done: ticked.has(`${t.id}:${today}`),
          dueToday: dueOn(t.repeat, today),
          history: week
            .filter((d) => d >= t.created_at.slice(0, 10))
            .map((d) => ({ day: d, done: ticked.has(`${t.id}:${d}`), due: dueOn(t.repeat, d) })),
        },
  );
  const open = items.filter((t) => !(t.repeat === "none" && t.done));
  const done = (todos ?? [])
    .filter((t) => t.repeat === "none" && t.completed_at)
    .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))
    .slice(0, DONE_SHOWN)
    .map((t) => items.find((i) => i.id === t.id)!);

  return (
    <>
      {picker ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <PersonPicker current={picker.current} options={picker.options} label="Whose to-do list to show" />
          {ownerName ? (
            <p className="text-sm text-muted-foreground">Viewing {ownerName}&apos;s list (read-only).</p>
          ) : null}
        </div>
      ) : null}
      <TodoBoard items={[...open, ...done]} readOnly={ownerId !== viewer.id} today={today} />
    </>
  );
}

export default function TodosPage({ searchParams }: PageProps<"/todos">) {
  return (
    <>
      <PageHeader
        title="To-dos"
        description="Your personal checklist. Only you can see it (admins can view it, but not change it)."
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <TodosContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
