"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { fail, ok, runAction, type ActionResult } from "@/lib/actions";
import { viewerForAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { NotificationType } from "@/lib/tasks/constants";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  created_at: string;
  read_at: string | null;
  data: { key?: string; title?: string; excerpt?: string; note?: string; due_date?: string; changes?: string[] };
  actor: { id: string; full_name: string; email: string } | null;
  task: { key: string } | null;
};

const SELECT =
  "id, type, created_at, read_at, data, actor:profiles!notifications_actor_id_fkey(id, full_name, email), task:tasks(key)";

export async function listNotifications(
  limit = 15,
): Promise<ActionResult<{ items: NotificationItem[]; unread: number }>> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    const supabase = await createClient();
    // RLS limits rows to the caller's own notifications; the filter keeps intent explicit.
    const [{ data, error }, { count }] = await Promise.all([
      supabase
        .from("notifications")
        .select(SELECT)
        .eq("recipient_id", viewer.id)
        .order("created_at", { ascending: false })
        .limit(Math.min(Math.max(limit, 1), 50)),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", viewer.id)
        .is("read_at", null),
    ]);
    if (error) return fail("Could not load notifications.");
    return ok({ items: (data ?? []) as unknown as NotificationItem[], unread: count ?? 0 });
  });
}

export async function getUnreadCount(): Promise<number> {
  const viewer = await viewerForAction().catch(() => null);
  if (!viewer) return 0;
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", viewer.id)
    .is("read_at", null);
  return count ?? 0;
}

export async function markNotificationsRead(ids: string[] | "all"): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    const parsed = ids === "all" ? ids : z.array(z.uuid()).max(100).safeParse(ids);
    if (parsed !== "all" && !parsed.success) return fail("Invalid notification.");
    const supabase = await createClient();
    let query = supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", viewer.id)
      .is("read_at", null);
    if (parsed !== "all") query = query.in("id", parsed.data);
    const { error } = await query;
    if (error) return fail("Could not update notifications.");
    refresh();
    return ok(null);
  });
}
