"use client";

import { format, isToday, isYesterday } from "date-fns";
import { CheckCheckIcon, CheckIcon, Loader2Icon, LogOutIcon, PlusIcon, SendIcon, UsersIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import {
  addGroupMembers,
  createGroup,
  fetchNewGroupMessages,
  fetchNewMessages,
  markConversationRead,
  markGroupRead,
  removeGroupMember,
  renameGroup,
  sendGroupMessage,
  sendMessage,
  type ChatMessage,
} from "@/actions/messages";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/form";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { UserAvatar } from "@/components/ui/primitives";
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
      onChange={(e) => e.target.value && router.push(`/chat?with=${e.target.value}`)}
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

/** A direct chat with one person, or a group chat. */
export type ChatTarget =
  | { kind: "direct"; otherId: string; name: string; conversationId: string | null }
  | { kind: "group"; groupId: string; name: string };

export function ChatThread({
  viewerId,
  target,
  names,
  initialMessages,
  hasUnread,
  initialReadUpTo,
}: {
  viewerId: string;
  target: ChatTarget;
  /** Sender names, shown above messages in group chats. */
  names: Record<string, string>;
  initialMessages: ChatMessage[];
  hasUnread: boolean;
  /** Your messages sent at or before this time have been read (see ThreadUpdate). */
  initialReadUpTo: string | null;
}) {
  const router = useRouter();
  const [readUpTo, setReadUpTo] = React.useState(initialReadUpTo);
  const isGroup = target.kind === "group";
  // The id to poll: the group, or the direct conversation once it exists.
  const [threadId, setThreadId] = React.useState(isGroup ? target.groupId : target.conversationId);
  const [messages, setMessages] = React.useState(initialMessages);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const lastAt = messages.at(-1)?.created_at ?? null;

  // Clear the unread badge for this chat once it's open.
  const initialThreadId = target.kind === "group" ? target.groupId : target.conversationId;
  React.useEffect(() => {
    if (!initialThreadId || !hasUnread) return;
    void (isGroup ? markGroupRead(initialThreadId) : markConversationRead(initialThreadId));
  }, [initialThreadId, hasUnread, isGroup]);

  // Poll for new messages while the tab is visible.
  React.useEffect(() => {
    if (!threadId) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const res = await (isGroup ? fetchNewGroupMessages(threadId, lastAt) : fetchNewMessages(threadId, lastAt));
      if (!res.ok) return;
      setReadUpTo(res.data.readUpTo);
      if (res.data.messages.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...res.data.messages.filter((m) => !seen.has(m.id))];
        });
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [threadId, lastAt, isGroup]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    if (target.kind === "group") {
      const res = await sendGroupMessage(target.groupId, body);
      setSending(false);
      if (!res.ok) return void toast.error(res.error);
      setDraft("");
      setMessages((prev) => [...prev, res.data]);
      return;
    }
    const res = await sendMessage(target.otherId, body);
    setSending(false);
    if (!res.ok) return void toast.error(res.error);
    setDraft("");
    setMessages((prev) => [...prev, res.data.message]);
    if (!threadId) {
      setThreadId(res.data.conversationId);
      router.refresh(); // show the new chat in the list
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {isGroup
              ? `Say hello to ${target.name}. Only members of this group can see it.`
              : `Say hello to ${target.name}. Only the two of you can see this chat.`}
          </p>
        ) : (
          <ol className="grid gap-1.5">
            {messages.map((m, i) => {
              const mine = m.sender_id === viewerId;
              const newDay = i === 0 || dayLabel(messages[i - 1].created_at) !== dayLabel(m.created_at);
              // In groups, name the sender at the start of each run of their messages.
              const showSender = isGroup && !mine && (newDay || messages[i - 1].sender_id !== m.sender_id);
              return (
                <React.Fragment key={m.id}>
                  {newDay ? (
                    <li className="my-2 text-center text-[11px] text-muted-foreground">{dayLabel(m.created_at)}</li>
                  ) : null}
                  {showSender ? (
                    <li className="mt-1 px-1 text-[11px] font-medium text-muted-foreground">
                      {names[m.sender_id] ?? "Former member"}
                    </li>
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
                      <span className="ml-2 inline-flex items-center gap-0.5 align-baseline text-[10px]">
                        <span className="opacity-70">{format(new Date(m.created_at), "HH:mm")}</span>
                        {mine ? (
                          readUpTo && Date.parse(readUpTo) >= Date.parse(m.created_at) ? (
                            <span role="img" aria-label="Read" title="Read">
                              <CheckCheckIcon className="size-3.5 text-sky-300 dark:text-sky-800" />
                            </span>
                          ) : (
                            <span role="img" aria-label="Sent" title="Sent" className="opacity-70">
                              <CheckIcon className="size-3.5" />
                            </span>
                          )
                        ) : null}
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
          aria-label={`Message ${target.name}`}
          placeholder={`Message ${target.name}…`}
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

type Person = { id: string; name: string };

export function NewGroupButton({ people }: { people: Person[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [members, setMembers] = React.useState<string[]>([]);
  const [pending, startTransition] = React.useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await createGroup(name, members);
      if (!res.ok) return void toast.error(res.error);
      setOpen(false);
      setName("");
      setMembers([]);
      router.push(`/chat?group=${res.data.groupId}`);
    });
  };

  return (
    <>
      <Button size="sm" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <PlusIcon /> New group
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>New group</DialogTitle>
              <DialogDescription>Only the people in the group can read it. Admins can&apos;t.</DialogDescription>
            </DialogHeader>
            <Field label="Group name" htmlFor="group-name">
              <Input id="group-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field label="People" htmlFor="group-members">
              <MultiSelect
                id="group-members"
                options={people.map((p) => ({ value: p.id, label: p.name }))}
                value={members}
                onChange={setMembers}
                placeholder="Choose people…"
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim() || members.length === 0}>
                {pending ? <Loader2Icon className="animate-spin" /> : null}
                Create group
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function GroupMembersButton({
  groupId,
  groupName,
  viewerId,
  isCreator,
  members,
  people,
}: {
  groupId: string;
  groupName: string;
  viewerId: string;
  isCreator: boolean;
  members: Person[];
  /** Everyone in the workspace, for adding people. */
  people: Person[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(groupName);
  const [adding, setAdding] = React.useState<string[]>([]);
  const [pending, startTransition] = React.useTransition();
  const memberIds = new Set(members.map((m) => m.id));
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      toast.success(done);
      after?.();
    });

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <UsersIcon /> {members.length}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{groupName}</DialogTitle>
            <DialogDescription>
              {members.length} {members.length === 1 ? "member" : "members"}.{" "}
              {isCreator ? "You created this group." : "Only the person who created the group can change it."}
            </DialogDescription>
          </DialogHeader>
          {isCreator ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => renameGroup(groupId, name), "Group renamed");
              }}
            >
              <Input aria-label="Group name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" variant="outline" disabled={pending || !name.trim() || name === groupName}>
                Rename
              </Button>
            </form>
          ) : null}
          <ul className="grid max-h-64 gap-1 overflow-y-auto">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-md px-1 py-1">
                <UserAvatar name={m.name} id={m.id} size="sm" />
                <span className="flex-1 truncate text-sm">
                  {m.name}
                  {m.id === viewerId ? " (you)" : ""}
                </span>
                {isCreator && m.id !== viewerId ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${m.name}`}
                    disabled={pending}
                    onClick={() => run(() => removeGroupMember(groupId, m.id), `${m.name} removed`)}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {isCreator ? (
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <MultiSelect
                  options={people.filter((p) => !memberIds.has(p.id)).map((p) => ({ value: p.id, label: p.name }))}
                  value={adding}
                  onChange={setAdding}
                  placeholder="Add people…"
                />
              </div>
              <Button
                variant="outline"
                disabled={pending || adding.length === 0}
                onClick={() =>
                  run(
                    () => addGroupMembers(groupId, adding),
                    "People added",
                    () => setAdding([]),
                  )
                }
              >
                Add
              </Button>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(`Leave ${groupName}? You won't see its messages any more.`)) return;
                run(
                  () => removeGroupMember(groupId, viewerId),
                  "You left the group",
                  () => router.push("/chat"),
                );
              }}
            >
              <LogOutIcon /> Leave group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
