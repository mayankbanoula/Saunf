"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { dbErrorMessage, fail, ok, runAction, validationFailure, type ActionResult } from "@/lib/actions";
import { viewerForAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { todoSchema, type TodoInput } from "@/lib/validation/todos";

// RLS only lets people change their own list; admins can read but not edit others'.

export async function addTodo(input: TodoInput): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    const parsed = todoSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const supabase = await createClient();
    const { error } = await supabase
      .from("todos")
      .insert({ workspace_id: viewer.workspaceId, user_id: viewer.id, ...parsed.data });
    if (error) return fail(dbErrorMessage(error));
    refresh();
    return ok(null);
  });
}

export async function setTodoDone(todoId: string, done: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    if (!z.uuid().safeParse(todoId).success) return fail("Invalid to-do.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_todo_done", { p_todo: todoId, p_done: done });
    if (error) return fail(dbErrorMessage(error));
    refresh();
    return ok(null);
  });
}

export async function deleteTodo(todoId: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    if (!z.uuid().safeParse(todoId).success) return fail("Invalid to-do.");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("todos")
      .delete()
      .eq("id", todoId)
      .eq("user_id", viewer.id)
      .select("id");
    if (error) return fail(dbErrorMessage(error));
    if (!data?.length) return fail("To-do not found.");
    refresh();
    return ok(null);
  });
}
