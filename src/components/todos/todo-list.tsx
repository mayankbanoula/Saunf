"use client";

import { Loader2Icon, PlusIcon, RepeatIcon, Trash2Icon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { addTodo, deleteTodo, setTodoDone } from "@/actions/todos";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Checkbox } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";
import { TODO_REPEAT_LABEL, TODO_REPEATS, type TodoRepeat } from "@/lib/validation/todos";

export type TodoItem = {
  id: string;
  title: string;
  repeat: TodoRepeat;
  due_date: string | null;
  /** Done today (repeating) or done at all (one-off). */
  done: boolean;
  /** False for weekday-only items on a weekend. */
  dueToday: boolean;
  /** Repeating items: ticked on each of the last 7 days, oldest first. */
  history: { day: string; done: boolean; due: boolean }[];
};

function AddTodoForm() {
  const [title, setTitle] = React.useState("");
  const [repeat, setRepeat] = React.useState<TodoRepeat>("none");
  const [due, setDue] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await addTodo({ title, repeat, due_date: repeat === "none" ? due : null });
      if (!res.ok) return void toast.error(res.error);
      setTitle("");
      setDue("");
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <Input
        aria-label="New to-do"
        placeholder="Add a to-do…"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        className="min-w-48 flex-1"
      />
      <NativeSelect
        aria-label="Repeat"
        className="w-auto"
        value={repeat}
        onChange={(e) => setRepeat(e.target.value as TodoRepeat)}
      >
        {TODO_REPEATS.map((r) => (
          <option key={r} value={r}>
            {TODO_REPEAT_LABEL[r]}
          </option>
        ))}
      </NativeSelect>
      {repeat === "none" ? (
        <Input
          type="date"
          aria-label="Due date (optional)"
          className="w-auto"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      ) : null}
      <Button type="submit" disabled={pending || !title.trim()}>
        {pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
        Add
      </Button>
    </form>
  );
}

function Row({ item, readOnly, today }: { item: TodoItem; readOnly: boolean; today: string }) {
  const [pending, startTransition] = React.useTransition();
  const [optimistic, setOptimistic] = React.useOptimistic(item.done);
  const overdue = item.repeat === "none" && !item.done && item.due_date !== null && item.due_date < today;

  const toggle = (checked: boolean) =>
    startTransition(async () => {
      setOptimistic(checked);
      const res = await setTodoDone(item.id, checked);
      if (!res.ok) toast.error(res.error);
    });
  const remove = () => {
    if (!window.confirm(`Delete “${item.title}”?`)) return;
    startTransition(async () => {
      const res = await deleteTodo(item.id);
      if (!res.ok) toast.error(res.error);
    });
  };

  return (
    <li className={cn("group flex items-center gap-3 py-2", !item.dueToday && "opacity-60")}>
      <Checkbox
        aria-label={`Mark “${item.title}” ${optimistic ? "not done" : "done"}`}
        checked={optimistic}
        disabled={readOnly || pending || !item.dueToday}
        onCheckedChange={(v) => toggle(v === true)}
      />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm", optimistic && "text-muted-foreground line-through")}>{item.title}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          {item.repeat !== "none" ? (
            <span className="flex items-center gap-1">
              <RepeatIcon className="size-3" />
              {TODO_REPEAT_LABEL[item.repeat]}
              {!item.dueToday ? " · not today" : null}
            </span>
          ) : null}
          {item.due_date ? (
            <span className={cn(overdue && "text-destructive")}>
              {item.due_date === today ? "Due today" : `${overdue ? "Overdue · " : "Due "}${item.due_date}`}
            </span>
          ) : null}
        </div>
      </div>
      {item.history.length ? (
        <div
          className="hidden items-center gap-1 sm:flex"
          title={`${item.history.filter((h) => h.done).length} of ${item.history.filter((h) => h.due).length} days done this week`}
          aria-label="Last 7 days"
        >
          {item.history.map((h) => (
            <span
              key={h.day}
              title={h.day}
              className={cn(
                "size-2.5 rounded-full",
                h.done ? "bg-highlight" : h.due ? "border border-input bg-card" : "bg-muted",
              )}
            />
          ))}
        </div>
      ) : null}
      {readOnly ? null : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete “${item.title}”`}
          className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          disabled={pending}
          onClick={remove}
        >
          <Trash2Icon />
        </Button>
      )}
    </li>
  );
}

function Section({
  title,
  description,
  items,
  empty,
  readOnly,
  today,
}: {
  title: string;
  description: string;
  items: TodoItem[];
  empty: string;
  readOnly: boolean;
  today: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <ul className="divide-y">
            {items.map((t) => (
              <Row key={t.id} item={t} readOnly={readOnly} today={today} />
            ))}
          </ul>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function TodoBoard({ items, readOnly, today }: { items: TodoItem[]; readOnly: boolean; today: string }) {
  const repeating = items.filter((t) => t.repeat !== "none");
  const doneToday = repeating.filter((t) => t.dueToday && t.done).length;
  const dueToday = repeating.filter((t) => t.dueToday).length;
  const open = items.filter((t) => t.repeat === "none" && !t.done);
  const done = items.filter((t) => t.repeat === "none" && t.done);

  return (
    <div className="grid gap-5">
      {readOnly ? null : <AddTodoForm />}
      <Section
        title="Daily"
        description={
          dueToday
            ? `${doneToday} of ${dueToday} done today · resets every morning`
            : "Repeats every day or every weekday"
        }
        items={repeating}
        empty={
          readOnly
            ? "No repeating to-dos."
            : "Add something you do every day and choose “Every day” or “Every weekday”."
        }
        readOnly={readOnly}
        today={today}
      />
      <Section
        title="To do"
        description="One-off items"
        items={open}
        empty={readOnly ? "Nothing to do." : "Nothing on your list."}
        readOnly={readOnly}
        today={today}
      />
      {done.length ? (
        <details className="rounded-lg border bg-card px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">Completed ({done.length})</summary>
          <ul className="mt-2 divide-y">
            {done.map((t) => (
              <Row key={t.id} item={t} readOnly={readOnly} today={today} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
