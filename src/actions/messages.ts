"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { dbErrorMessage, fail, ok, runAction, type ActionResult } from "@/lib/actions";
import { viewerForAction } from "@/lib/auth/session";
import { directReadUpTo, groupReadUpTo } from "@/lib/chat";
import { createClient } from "@/lib/supabase/server";

// RLS limits conversations and messages to their two participants; there is no admin access.

export type ChatMessage = { id: string; sender_id: string; body: string; created_at: string };

/**
 * New messages plus read status for the ticks: your messages sent at or before
 * `readUpTo` have been read (by the other person, or by everyone else in a group).
 */
export type ThreadUpdate = { messages: ChatMessage[]; readUpTo: string | null };

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
): Promise<ActionResult<ThreadUpdate>> {
  return runAction(async () => {
    const viewer = await viewerForAction();
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
    return ok({ messages: data, readUpTo: await directReadUpTo(supabase, conversationId, viewer.id) });
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

// ---------------------------------------------------------------------------
// Groups. Only members can read or post (RLS); the creator manages membership.
// ---------------------------------------------------------------------------
const groupNameSchema = z.string().trim().min(1, "Name the group").max(80, "Group names can be up to 80 characters");
const userIdsSchema = z.array(z.uuid()).max(200);

export async function createGroup(name: string, memberIds: string[]): Promise<ActionResult<{ groupId: string }>> {
  return runAction(async () => {
    await viewerForAction();
    const parsedName = groupNameSchema.safeParse(name);
    if (!parsedName.success) return fail(parsedName.error.issues[0].message);
    const parsedIds = userIdsSchema.safeParse(memberIds);
    if (!parsedIds.success || parsedIds.data.length === 0) return fail("Add at least one person to the group.");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_chat_group", {
      p_name: parsedName.data,
      p_members: parsedIds.data,
    });
    if (error || !data) return fail(error ? dbErrorMessage(error) : "Could not create the group.");
    refresh();
    return ok({ groupId: data });
  });
}

export async function sendGroupMessage(groupId: string, body: string): Promise<ActionResult<ChatMessage>> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    if (!z.uuid().safeParse(groupId).success) return fail("Invalid group.");
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("group_messages")
      .insert({ group_id: groupId, sender_id: viewer.id, body: parsed.data })
      .select("id, sender_id, body, created_at")
      .single();
    if (error) return fail(dbErrorMessage(error));
    return ok(data);
  });
}

/** Group messages newer than `after` (for polling); also marks the group read. */
export async function fetchNewGroupMessages(
  groupId: string,
  after: string | null,
): Promise<ActionResult<ThreadUpdate>> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    if (!z.uuid().safeParse(groupId).success) return fail("Invalid group.");
    const supabase = await createClient();
    let query = supabase
      .from("group_messages")
      .select("id, sender_id, body, created_at")
      .eq("group_id", groupId)
      .order("created_at")
      .limit(200);
    if (after) query = query.gt("created_at", after);
    const { data, error } = await query;
    if (error) return fail(dbErrorMessage(error));
    if (data.length) await supabase.rpc("mark_chat_group_read", { p_group: groupId });
    return ok({ messages: data, readUpTo: await groupReadUpTo(supabase, groupId, viewer.id) });
  });
}

export async function markGroupRead(groupId: string): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    if (!z.uuid().safeParse(groupId).success) return fail("Invalid group.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("mark_chat_group_read", { p_group: groupId });
    if (error) return fail(dbErrorMessage(error));
    refresh();
    return ok(null);
  });
}

export async function addGroupMembers(groupId: string, memberIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    const parsedIds = userIdsSchema.safeParse(memberIds);
    if (!z.uuid().safeParse(groupId).success || !parsedIds.success) return fail("Invalid group or people.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("add_chat_group_members", { p_group: groupId, p_members: parsedIds.data });
    if (error) return fail(dbErrorMessage(error));
    refresh();
    return ok(null);
  });
}

/** Remove someone (group creator only), or pass your own id to leave. */
export async function removeGroupMember(groupId: string, userId: string): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    if (!z.uuid().safeParse(groupId).success || !z.uuid().safeParse(userId).success) return fail("Invalid request.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_chat_group_member", { p_group: groupId, p_user: userId });
    if (error) return fail(dbErrorMessage(error));
    refresh();
    return ok(null);
  });
}

export async function renameGroup(groupId: string, name: string): Promise<ActionResult> {
  return runAction(async () => {
    await viewerForAction();
    const parsedName = groupNameSchema.safeParse(name);
    if (!parsedName.success) return fail(parsedName.error.issues[0].message);
    if (!z.uuid().safeParse(groupId).success) return fail("Invalid group.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("rename_chat_group", { p_group: groupId, p_name: parsedName.data });
    if (error) return fail(dbErrorMessage(error));
    refresh();
    return ok(null);
  });
}

/**
 * Lightweight check used app-wide: how many chats are unread and when the latest
 * message from someone else arrived (to play a sound when it changes).
 */
export async function chatPulse(): Promise<ActionResult<{ unread: number; latestIncoming: string | null }>> {
  return runAction(async () => {
    const viewer = await viewerForAction();
    const supabase = await createClient();
    // RLS limits both message tables to chats the viewer is in.
    const [{ data: unread }, { data: direct }, { data: group }] = await Promise.all([
      supabase.rpc("unread_conversation_count"),
      supabase
        .from("messages")
        .select("created_at")
        .neq("sender_id", viewer.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("group_messages")
        .select("created_at")
        .neq("sender_id", viewer.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const latest = [direct?.created_at, group?.created_at]
      .filter((x): x is string => Boolean(x))
      .sort()
      .at(-1);
    return ok({ unread: unread ?? 0, latestIncoming: latest ?? null });
  });
}
