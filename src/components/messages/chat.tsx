"use client";

import { format, isToday, isYesterday } from "date-fns";
import { Loader2Icon, SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { fetchNewMessages, markConversationRead, sendMessage, type ChatMessage } from "@/actions/messages";
import { Button } from "@/components/ui/button";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const POLL_MS = 4000;

/** Start a chat with any active member of the workspace. */
export function NewChatPicker({ people }: { people: { id: string; name: string }[] }) {
  const router = useRouter();
  return (
    <NativeSelect
      aria-label="Start a new chat"
      className="h-8 w-full text-sm"
      value=""
      onChange={(e) => e.target.value && router.push(`/messages?with=${e.target.value}`)}
    >
      <option value="">New message…</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </NativeSelect>
  );
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE d MMM yyyy");
}

export function ChatThread({
  viewerId,
  other,
  conversationId: initialConversationId,
  initialMessages,
  hasUnread,
}: {
  viewerId: string;
  other: { id: string; name: string };
  conversationId: string | null;
  initialMessages: ChatMessage[];
  hasUnread: boolean;
}) {
  const router = useRouter();
  const [conversationId, setConversationId] = React.useState(initialConversationId);
  const [messages, setMessages] = React.useState(initialMessages);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const lastAt = messages.at(-1)?.created_at ?? null;

  // Clear the unread badge for this chat once it's open.
  React.useEffect(() => {
    if (initialConversationId && hasUnread) void markConversationRead(initialConversationId);
  }, [initialConversationId, hasUnread]);

  // Poll for new messages while the tab is visible.
  React.useEffect(() => {
    if (!conversationId) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetchNewMessages(conversationId, lastAt);
      if (res.ok && res.data.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...res.data.filter((m) => !seen.has(m.id))];
        });
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [conversationId, lastAt]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await sendMessage(other.id, body);
    setSending(false);
    if (!res.ok) return void toast.error(res.error);
    setDraft("");
    setMessages((prev) => [...prev, res.data.message]);
    if (!conversationId) {
      setConversationId(res.data.conversationId);
      router.refresh(); // show the new chat in the list
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Say hello to {other.name}. Only the two of you can see this chat.
          </p>
        ) : (
          <ol className="grid gap-1.5">
            {messages.map((m, i) => {
              const mine = m.sender_id === viewerId;
              const newDay = i === 0 || dayLabel(messages[i - 1].created_at) !== dayLabel(m.created_at);
              return (
                <React.Fragment key={m.id}>
                  {newDay ? (
                    <li className="my-2 text-center text-[11px] text-muted-foreground">{dayLabel(m.created_at)}</li>
                  ) : null}
                  <li className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[75%] rounded-2xl px-3 py-1.5 text-sm break-words whitespace-pre-wrap",
                        mine
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm bg-accent text-accent-foreground",
                      )}
                    >
                      {m.body}
                      <span className={cn("ml-2 text-[10px] opacity-70")}>
                        {format(new Date(m.created_at), "HH:mm")}
                      </span>
                    </div>
                  </li>
                </React.Fragment>
              );
            })}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>
      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Textarea
          aria-label={`Message ${other.name}`}
          placeholder={`Message ${other.name}…`}
          rows={1}
          maxLength={4000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          className="max-h-40 min-h-9 resize-none"
        />
        <Button type="submit" size="icon" aria-label="Send" disabled={sending || !draft.trim()}>
          {sending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
        </Button>
      </form>
    </div>
  );
}
