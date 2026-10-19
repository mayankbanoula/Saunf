import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildWorld, cleanup, sql } from "./helpers";

let w: Awaited<ReturnType<typeof buildWorld>>;

beforeAll(async () => {
  w = await buildWorld();
});
afterAll(cleanup);

async function addTodo(who: typeof w.emp1, title: string, repeat: "none" | "daily" | "weekdays" = "none") {
  const { data, error } = await who.client
    .from("todos")
    .insert({ workspace_id: w.ws, user_id: who.id, title, repeat })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

describe("personal to-do lists", () => {
  it("only the owner and admins can see a list", async () => {
    const id = await addTodo(w.emp1, "Call the bank");
    const sees = async (who: typeof w.emp1) =>
      (await who.client.from("todos").select("id").eq("id", id)).data?.length ?? 0;
    expect(await sees(w.emp1)).toBe(1);
    expect(await sees(w.admin)).toBe(1);
    expect(await sees(w.emp2)).toBe(0);
    expect(await sees(w.manager)).toBe(0); // managers don't see their team's to-dos
    expect(await sees(w.outsider)).toBe(0);
  });

  it("nobody can add, change or tick items on someone else's list, not even admins", async () => {
    const id = await addTodo(w.emp1, "Private item");
    const forged = await w.admin.client
      .from("todos")
      .insert({ workspace_id: w.ws, user_id: w.emp1.id, title: "Planted" });
    expect(forged.error).not.toBeNull();

    await w.admin.client.from("todos").update({ title: "Changed" }).eq("id", id);
    await w.emp2.client.from("todos").delete().eq("id", id);
    expect((await w.admin.client.rpc("set_todo_done", { p_todo: id, p_done: true })).error).not.toBeNull();
    expect(
      (await w.emp2.client.from("todo_completions").insert({ todo_id: id, day: "2026-01-01" })).error,
    ).not.toBeNull();

    const { data } = await w.emp1.client.from("todos").select("title, completed_at").eq("id", id).single();
    expect(data).toEqual({ title: "Private item", completed_at: null });
  });

  it("one-off items are done once; repeating items are ticked per day", async () => {
    const once = await addTodo(w.emp1, "Submit expenses");
    const daily = await addTodo(w.emp1, "Check support inbox", "daily");

    expect((await w.emp1.client.rpc("set_todo_done", { p_todo: once, p_done: true })).error).toBeNull();
    expect((await w.emp1.client.rpc("set_todo_done", { p_todo: daily, p_done: true })).error).toBeNull();

    const { data: o } = await w.emp1.client.from("todos").select("completed_at").eq("id", once).single();
    expect(o!.completed_at).not.toBeNull();
    const { data: today } = await w.emp1.client.rpc("workspace_today");
    const ticks = async () =>
      ((await w.emp1.client.from("todo_completions").select("day").eq("todo_id", daily)).data ?? []).map((r) => r.day);
    expect(await ticks()).toEqual([today]);
    // Admins can see the history.
    expect((await w.admin.client.from("todo_completions").select("day").eq("todo_id", daily)).data).toHaveLength(1);

    // Yesterday's tick doesn't count for today: the item comes back unticked.
    await sql("update public.todo_completions set day = day - 1 where todo_id = $1", [daily]);
    expect(await ticks()).not.toContain(today);

    // Unticking today's leaves earlier days alone.
    await w.emp1.client.rpc("set_todo_done", { p_todo: daily, p_done: true });
    await w.emp1.client.rpc("set_todo_done", { p_todo: daily, p_done: false });
    expect(await ticks()).toHaveLength(1);
  });
});
