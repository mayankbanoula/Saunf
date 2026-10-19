import { LockIcon, MessageSquareIcon, UsersIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import type { ChatMessage } from "@/actions/messages";
import { ChatThread, GroupMembersButton, NewChatPicker, NewGroupButton, type ChatTarget } from "@/components/chat/chat";
import { PageHeader } from "@/components/layout/page-header";
import { RelativeTime } from "@/components/time";
import { Card, Skeleton, UserAvatar } from "@/components/ui/primitives";
import { requireViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { cn, displayName } from "@/lib/utils";

export const metadata: Metadata = { title: "Chat" };

const MAX_CONVERSATIONS = 100;
const THREAD_LIMIT = 200;

type Row = {
  key: string;
  href: string;
  name: string;
  avatarId: string;
  isGroup: boolean;
  lastMessageAt: string | null;
  unread: boolean;
  preview: string;
};

function ChatList({
  title,
  rows,
  selectedKey,
  empty,
}: {
  title: string;
  rows: Row[];
  selectedKey: string | null;
  empty: string;
}) {
  return (
    <section>
      <h2 className="px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.key}>
              <Link
                href={r.href}
                aria-current={r.key === selectedKey ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 border-b px-3 py-2.5 hover:bg-muted",
                  r.key === selectedKey && "bg-sidebar-accent",
                )}
              >
                {r.isGroup ? (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <UsersIcon className="size-4" />
                  </span>
                ) : (
                  <UserAvatar name={r.name} id={r.avatarId} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className={cn("truncate text-sm", r.unread && "font-semibold")}>{r.name}</span>
                    {r.lastMessageAt ? (
                      <RelativeTime iso={r.lastMessageAt} className="shrink-0 text-[11px] text-muted-foreground" />
                    ) : null}
                  </span>
                  <span className={cn("block truncate text-xs text-muted-foreground", r.unread && "text-foreground")}>
                    {r.preview}
                  </span>
                </span>
                {r.unread ? <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function ChatContent({ searchParams }: { searchParams: PageProps<"/chat">["searchParams"] }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const uuid = (v: unknown) => (typeof v === "string" && z.uuid().safeParse(v).success ? v : null);
  const withId = uuid(sp.with);
  const groupParam = uuid(sp.group);
  const supabase = await createClient();

  // RLS: only chats the viewer is part of. Admins have no access to other people's chats.
  const [{ data: conversations, error }, { data: groups, error: groupError }, { data: members }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, user_a, user_b, last_message_at, last_read_a, last_read_b")
      .not("last_message_at", "is", null)
      .order("last_message_at", { ascending: false })
      .limit(MAX_CONVERSATIONS),
    supabase
      .from("chat_groups")
      .select("id, name, created_by, created_at, last_message_at, chat_group_members(user_id, last_read_at)")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(MAX_CONVERSATIONS),
    supabase
      .from("workspace_members")
      .select("user_id, profiles!workspace_members_user_id_fkey(full_name, email)")
      .eq("workspace_id", viewer.workspaceId)
      .eq("is_active", true),
  ]);
  if (error || groupError) throw new Error(`Could not load chats: ${(error ?? groupError)!.message}`);

  const names = new Map((members ?? []).map((m) => [m.user_id, displayName(m.profiles)]));
  const people = [...names.entries()]
    .filter(([id]) => id !== viewer.id)
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Latest message per chat for the previews.
  const conversationIds = (conversations ?? []).map((c) => c.id);
  const groupIds = (groups ?? []).map((g) => g.id);
  const [{ data: recentDirect }, { data: recentGroup }] = await Promise.all([
    conversationIds.length
      ? supabase
          .from("messages")
          .select("conversation_id, sender_id, body")
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: false })
          .limit(conversationIds.length * 5)
      : Promise.resolve({ data: [] }),
    groupIds.length
      ? supabase
          .from("group_messages")
          .select("group_id, sender_id, body")
          .in("group_id", groupIds)
          .order("created_at", { ascending: false })
          .limit(groupIds.length * 5)
      : Promise.resolve({ data: [] }),
  ]);
  const preview = new Map<string, string>();
  for (const m of recentDirect ?? []) {
    if (!preview.has(m.conversation_id))
      preview.set(m.conversation_id, `${m.sender_id === viewer.id ? "You: " : ""}${m.body}`);
  }
  for (const m of recentGroup ?? []) {
    if (!preview.has(m.group_id)) {
      const who = m.sender_id === viewer.id ? "You" : (names.get(m.sender_id) ?? "Former member").split(" ")[0];
      preview.set(m.group_id, `${who}: ${m.body}`);
    }
  }

  const directRows: (Row & { otherId: string; conversationId: string })[] = (conversations ?? []).map((c) => {
    const mineIsA = c.user_a === viewer.id;
    const otherId = mineIsA ? c.user_b : c.user_a;
    const lastRead = mineIsA ? c.last_read_a : c.last_read_b;
    return {
      key: `dm:${otherId}`,
      href: `/chat?with=${otherId}`,
      name: names.get(otherId) ?? "Former member",
      avatarId: otherId,
      isGroup: false,
      lastMessageAt: c.last_message_at,
      unread: !lastRead || lastRead < c.last_message_at!,
      preview: preview.get(c.id) ?? "",
      otherId,
      conversationId: c.id,
    };
  });
  const groupRows: (Row & { groupId: string; createdBy: string | null; memberIds: string[] })[] = (groups ?? []).map(
    (g) => {
      const me = g.chat_group_members.find((m) => m.user_id === viewer.id);
      return {
        key: `group:${g.id}`,
        href: `/chat?group=${g.id}`,
        name: g.name,
        avatarId: g.id,
        isGroup: true,
        lastMessageAt: g.last_message_at,
        unread: g.last_message_at !== null && (!me?.last_read_at || me.last_read_at < g.last_message_at),
        preview: preview.get(g.id) ?? `${g.chat_group_members.length} members`,
        groupId: g.id,
        createdBy: g.created_by,
        memberIds: g.chat_group_members.map((m) => m.user_id),
      };
    },
  );

  // What's open: a group, or a direct chat with someone.
  const group = groupParam ? groupRows.find((g) => g.groupId === groupParam) : undefined;
  const directWith = !group && withId && withId !== viewer.id && names.has(withId) ? withId : null;
  const directRow = directRows.find((r) => r.otherId === directWith);

  let target: ChatTarget | null = null;
  let hasUnread = false;
  let thread: ChatMessage[] = [];
  if (group) {
    target = { kind: "group", groupId: group.groupId, name: group.name };
    hasUnread = group.unread;
    const { data } = await supabase
      .from("group_messages")
      .select("id, sender_id, body, created_at")
      .eq("group_id", group.groupId)
      .order("created_at", { ascending: false })
      .limit(THREAD_LIMIT);
    thread = (data ?? []).reverse();
  } else if (directWith) {
    let conversationId = directRow?.conversationId ?? null;
    if (!conversationId) {
      // A chat with no messages yet isn't in the list above.
      const [a, b] = [viewer.id, directWith].sort();
      const { data } = await supabase.from("conversations").select("id").eq("user_a", a).eq("user_b", b).maybeSingle();
      conversationId = data?.id ?? null;
    }
    target = { kind: "direct", otherId: directWith, name: names.get(directWith)!, conversationId };
    hasUnread = directRow?.unread ?? false;
    if (conversationId) {
      const { data } = await supabase
        .from("messages")
        .select("id, sender_id, body, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(THREAD_LIMIT);
      thread = (data ?? []).reverse();
    }
  }
  const selectedKey = group ? group.key : directWith ? `dm:${directWith}` : null;

  return (
    <Card className="grid h-[calc(100dvh-11rem)] min-h-[420px] grid-cols-1 overflow-hidden p-0 md:grid-cols-[300px_1fr]">
      <aside className={cn("flex min-h-0 flex-col border-r", target && "hidden md:flex")}>
        <div className="grid gap-2 border-b p-3">
          <NewChatPicker people={people} />
          <NewGroupButton people={people} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChatList
            title="Direct messages"
            rows={directRows}
            selectedKey={selectedKey}
            empty="No conversations yet. Pick someone above to start one."
          />
          <ChatList
            title="Groups"
            rows={groupRows}
            selectedKey={selectedKey}
            empty="No groups yet. Create one to chat with several people."
          />
        </div>
      </aside>
      <section className={cn("flex min-h-0 flex-col", !target && "hidden md:flex")}>
        {target ? (
          <>
            <div className="flex items-center gap-3 border-b px-4 py-2.5">
              <Link href="/chat" className="text-sm text-primary md:hidden">
                ← Back
              </Link>
              {target.kind === "group" ? (
                <span className="flex size-7 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <UsersIcon className="size-3.5" />
                </span>
              ) : (
                <UserAvatar name={target.name} id={target.otherId} size="sm" />
              )}
              <span className="truncate font-medium">{target.name}</span>
              {group ? (
                <GroupMembersButton
                  groupId={group.groupId}
                  groupName={group.name}
                  viewerId={viewer.id}
                  isCreator={group.createdBy === viewer.id}
                  members={group.memberIds
                    .map((id) => ({
                      id,
                      name: id === viewer.id ? viewer.fullName : (names.get(id) ?? "Former member"),
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name))}
                  people={people}
                />
              ) : null}
              <span className="ml-auto hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
                <LockIcon className="size-3" />
                {target.kind === "group" ? "Only members can see this" : "Only you two can see this"}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <ChatThread
                key={selectedKey}
                viewerId={viewer.id}
                target={target}
                names={Object.fromEntries(names)}
                initialMessages={thread}
                hasUnread={hasUnread}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <MessageSquareIcon className="size-8" />
            Choose a chat, start a new one, or create a group.
            <span className="flex items-center gap-1 text-xs">
              <LockIcon className="size-3" /> Chats are private to the people in them. Admins can&apos;t read them.
            </span>
          </div>
        )}
      </section>
    </Card>
  );
}

export default function ChatPage({ searchParams }: PageProps<"/chat">) {
  return (
    <>
      <PageHeader title="Chat" description="Private chats and groups with people in your workspace." />
      <Suspense fallback={<Skeleton className="h-[500px]" />}>
        <ChatContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
