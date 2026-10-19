import "server-only";

import type { ServerSupabase } from "@/lib/supabase/server";

// Read status for the ticks on your own chat messages.

/** When the other person last read a direct conversation. */
export async function directReadUpTo(
  supabase: ServerSupabase,
  conversationId: string,
  viewerId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("conversations")
    .select("user_a, last_read_a, last_read_b")
    .eq("id", conversationId)
    .maybeSingle();
  if (!data) return null;
  return data.user_a === viewerId ? data.last_read_b : data.last_read_a;
}

/** The point up to which everyone else in a group has read (null if someone hasn't read anything). */
export async function groupReadUpTo(
  supabase: ServerSupabase,
  groupId: string,
  viewerId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("chat_group_members")
    .select("last_read_at")
    .eq("group_id", groupId)
    .neq("user_id", viewerId);
  if (!data?.length || data.some((m) => !m.last_read_at)) return null;
  return data.map((m) => m.last_read_at!).sort()[0];
}
