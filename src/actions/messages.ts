"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { dbErrorMessage, fail, ok, runAction, type ActionResult } from "@/lib/actions";
import { viewerForAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// RLS limits conversations and messages to their two participants; there is no admin access.

export type ChatMessage = { id: string; sender_id: string; body: string; created_at: string };

const bodySchema = z.string().trim().min(1, "Write a message").max(4000, "Messages can be up to 4,000 characters");

export async function sendMessage(
  otherUserId: string,
  body: string,
): Promise<ActionResult<{ conversationId: string; message: ChatMessage }>> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    if (!z.uuid().safeParse(otherUserId).success) return fail("Invalid recipient.");
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const supabase = await createClient();
    const { data: conversationId, error: convError } = await supabase.rpc("open_conversation", {
      p_other: otherUserId,
    });
    if (convError || !conversationId) return fail(convError ? dbErrorMessage(convError) : "Could not start the chat.");
    const { data, error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, sender_id: viewer.id, body: parsed.data })
      .select("id, sender_id, body, created_at")
      .single();
    if (error) return fail(dbErrorMessage(error));
    return ok({ conversationId, message: data });
  });
}

/** Messages newer than `after` (for polling); also marks the conversation read. */
export async function fetchNewMessages(
  conversationId: string,
  after: string | null,
): Promise<ActionResult<ChatMessage[]>> {
  return runAction(async () => {
    await viewerForAction();
    if (!z.uuid().safeParse(conversationId).success) return fail("Invalid conversation.");
    const supabase = await createClient();
    let query = supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at")
      .limit(200);
    if (after) query = query.gt("created_at", after);
    const { data, error } = await query;
    if (error) return fail(dbErrorMessage(error));
    if (data.length) await supabase.rpc("mark_conversation_read", { p_conversation: conversationId });
    return ok(data);
  });
}

/** Refreshes the sidebar badge and conversation list after reading. */
export async function markConversationRead(conversationId: string): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    if (!z.uuid().safeParse(conversationId).success) return fail("Invalid conversation.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("mark_conversation_read", { p_conversation: conversationId });
    if (error) return fail(dbErrorMessage(error));
    refresh();
    return ok(null);
  });
}
