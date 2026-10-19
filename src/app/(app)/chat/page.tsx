import { LockIcon, MessageSquareIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import type { ChatMessage } from "@/actions/messages";
import { PageHeader } from "@/components/layout/page-header";
import { ChatThread, NewChatPicker } from "@/components/chat/chat";
import { RelativeTime } from "@/components/time";
import { Card, Skeleton, UserAvatar } from "@/components/ui/primitives";
import { requireViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { cn, displayName } from "@/lib/utils";

export const metadata: Metadata = { title: "Chat" };

const MAX_CONVERSATIONS = 100;
const THREAD_LIMIT = 200;

async function ChatContent({ searchParams }: { searchParams: PageProps<"/chat">["searchParams"] }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const withId = typeof sp.with === "string" && z.uuid().safeParse(sp.with).success ? sp.with : null;
  const supabase = await createClient();

  // RLS: only conversations the viewer is part of. Admins have no access to others' chats.
  const [{ data: conversations, error }, { data: members }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, user_a, user_b, last_message_at, last_read_a, last_read_b")
      .not("last_message_at", "is", null)
      .order("last_message_at", { ascending: false })
      .limit(MAX_CONVERSATIONS),
    supabase
      .from("workspace_members")
      .select("user_id, profiles!workspace_members_user_id_fkey(full_name, email)")
      .eq("workspace_id", viewer.workspaceId)
      .eq("is_active", true),
  ]);
  if (error) throw new Error(`Could not load chats: ${error.message}`);

  const names = new Map((members ?? []).map((m) => [m.user_id, displayName(m.profiles)]));
  const people = [...names.entries()]
    .filter(([id]) => id !== viewer.id)
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const rows = (conversations ?? []).map((c) => {
    const mineIsA = c.user_a === viewer.id;
    const otherId = mineIsA ? c.user_b : c.user_a;
    const lastRead = mineIsA ? c.last_read_a : c.last_read_b;
    return {
      id: c.id,
      otherId,
      name: names.get(otherId) ?? "Former member",
      lastMessageAt: c.last_message_at!,
      unread: !lastRead || lastRead < c.last_message_at!,
    };
  });

  // Latest message per conversation for the previews.
  const { data: recent } = rows.length
    ? await supabase
        .from("messages")
        .select("conversation_id, sender_id, body, created_at")
        .in(
          "conversation_id",
          rows.map((r) => r.id),
        )
        .order("created_at", { ascending: false })
        .limit(rows.length * 5)
    : { data: [] };
  const preview = new Map<string, { body: string; mine: boolean }>();
  for (const m of recent ?? []) {
    if (!preview.has(m.conversation_id))
      preview.set(m.conversation_id, { body: m.body, mine: m.sender_id === viewer.id });
  }

  const selected = withId && withId !== viewer.id && names.has(withId) ? withId : null;
  const selectedRow = rows.find((r) => r.otherId === selected);
  let thread: ChatMessage[] = [];
  let conversationId = selectedRow?.id ?? null;
  if (selected && !conversationId) {
    // A chat with no messages yet isn't in the list above.
    const [a, b] = [viewer.id, selected].sort();
    const { data } = await supabase.from("conversations").select("id").eq("user_a", a).eq("user_b", b).maybeSingle();
    conversationId = data?.id ?? null;
  }
  if (conversationId) {
    const { data } = await supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(THREAD_LIMIT);
    thread = (data ?? []).reverse();
  }

  return (
    <Card className="grid h-[calc(100dvh-11rem)] min-h-[420px] grid-cols-1 overflow-hidden p-0 md:grid-cols-[300px_1fr]">
      <aside className={cn("flex min-h-0 flex-col border-r", selected && "hidden md:flex")}>
        <div className="border-b p-3">
          <NewChatPicker people={people} />
        </div>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No conversations yet. Pick someone above to start one.
          </p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {rows.map((r) => {
              const p = preview.get(r.id);
              return (
                <li key={r.id}>
                  <Link
                    href={`/chat?with=${r.otherId}`}
                    aria-current={r.otherId === selected ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 border-b px-3 py-2.5 hover:bg-muted",
                      r.otherId === selected && "bg-sidebar-accent",
                    )}
                  >
                    <UserAvatar name={r.name} id={r.otherId} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={cn("truncate text-sm", r.unread && "font-semibold")}>{r.name}</span>
                        <RelativeTime iso={r.lastMessageAt} className="shrink-0 text-[11px] text-muted-foreground" />
                      </span>
                      <span
                        className={cn("block truncate text-xs text-muted-foreground", r.unread && "text-foreground")}
                      >
                        {p ? `${p.mine ? "You: " : ""}${p.body}` : ""}
                      </span>
                    </span>
                    {r.unread ? <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
      <section className={cn("flex min-h-0 flex-col", !selected && "hidden md:flex")}>
        {selected ? (
          <>
            <div className="flex items-center gap-3 border-b px-4 py-2.5">
              <Link href="/chat" className="text-sm text-primary md:hidden">
                ← Back
              </Link>
              <UserAvatar name={names.get(selected)!} id={selected} size="sm" />
              <span className="font-medium">{names.get(selected)}</span>
              <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                <LockIcon className="size-3" /> Only you two can see this
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <ChatThread
                key={selected}
                viewerId={viewer.id}
                other={{ id: selected, name: names.get(selected)! }}
                conversationId={conversationId}
                initialMessages={thread}
                hasUnread={selectedRow?.unread ?? false}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <MessageSquareIcon className="size-8" />
            Choose a conversation, or start a new one.
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
      <PageHeader title="Chat" description="Private one-to-one chats with people in your workspace." />
      <Suspense fallback={<Skeleton className="h-[500px]" />}>
        <ChatContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
