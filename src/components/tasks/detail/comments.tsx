"use client";

import { Loader2Icon, MessageSquareIcon, MoreHorizontalIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { addComment, deleteComment, editComment } from "@/actions/tasks";
import { LocalDateTime } from "@/components/time";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/primitives";
import { cn, displayName } from "@/lib/utils";

export type CommentRow = {
  id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  mentioned_user_ids: string[];
  author: { id: string; full_name: string; email: string } | null;
};

type Member = { id: string; full_name: string };

/** Render text, highlighting "@Name" for users actually mentioned. */
function CommentBody({ body, mentioned, members }: { body: string; mentioned: string[]; members: Member[] }) {
  const names = members.filter((m) => mentioned.includes(m.id)).map((m) => m.full_name).sort((a, b) => b.length - a.length);
  if (!names.length) return <p className="text-sm whitespace-pre-wrap">{body}</p>;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = body.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g"));
  return (
    <p className="text-sm whitespace-pre-wrap">
      {parts.map((p, i) =>
        p.startsWith("@") && names.includes(p.slice(1)) ? (
          <span key={i} className="rounded bg-accent px-0.5 font-medium text-accent-foreground">
            {p}
          </span>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </p>
  );
}

export function Comments({
  taskId,
  comments,
  members,
  viewerId,
  isAdmin,
  canComment,
}: {
  taskId: string;
  comments: CommentRow[];
  members: Member[];
  viewerId: string;
  isAdmin: boolean;
  canComment: boolean;
}) {
  return (
    <section id="comments" aria-labelledby="comments-heading" className="scroll-mt-20">
      <h2 id="comments-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <MessageSquareIcon className="size-4 text-muted-foreground" /> Comments
        <span className="text-muted-foreground">{comments.filter((c) => !c.deleted_at).length}</span>
      </h2>
      <ul className="mb-4 grid gap-3">
        {comments.map((c) => (
          <CommentItem key={c.id} comment={c} members={members} canEdit={c.author?.id === viewerId} canDelete={c.author?.id === viewerId || isAdmin} />
        ))}
      </ul>
      {canComment ? (
        <Composer taskId={taskId} members={members.filter((m) => m.id !== viewerId)} />
      ) : (
        <p className="text-sm text-muted-foreground">Comments are closed on archived tasks.</p>
      )}
    </section>
  );
}

function CommentItem({
  comment,
  members,
  canEdit,
  canDelete,
}: {
  comment: CommentRow;
  members: Member[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(comment.body);
  const [pending, startTransition] = React.useTransition();

  if (comment.deleted_at) {
    return (
      <li className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground italic">
        Comment deleted · <LocalDateTime iso={comment.deleted_at} />
      </li>
    );
  }

  return (
    <li className="flex gap-3">
      <UserAvatar name={displayName(comment.author)} id={comment.author?.id} size="md" />
      <div className="min-w-0 flex-1 rounded-md border bg-card px-3 py-2">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{displayName(comment.author)}</span>
          <LocalDateTime iso={comment.created_at} />
          {comment.edited_at ? <span title={comment.edited_at}>(edited)</span> : null}
          {canEdit || canDelete ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="ml-auto size-6" aria-label="Comment actions">
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit ? <DropdownMenuItem onSelect={() => setEditing(true)}>Edit</DropdownMenuItem> : null}
                {canDelete ? (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() =>
                      startTransition(async () => {
                        const res = await deleteComment(comment.id);
                        if (!res.ok) toast.error(res.error);
                      })
                    }
                  >
                    Delete
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {editing ? (
          <div className="grid gap-2">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={10000} aria-label="Edit comment" />
            <div className="flex justify-end gap-2">
              <Button size="xs" variant="outline" onClick={() => (setEditing(false), setText(comment.body))}>
                Cancel
              </Button>
              <Button
                size="xs"
                disabled={pending || !text.trim()}
                onClick={() =>
                  startTransition(async () => {
                    const res = await editComment(comment.id, text);
                    if (res.ok) setEditing(false);
                    else toast.error(res.error);
                  })
                }
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <CommentBody body={comment.body} mentioned={comment.mentioned_user_ids} members={members} />
        )}
      </div>
    </li>
  );
}

function Composer({ taskId, members }: { taskId: string; members: Member[] }) {
  const [body, setBody] = React.useState("");
  const [mentions, setMentions] = React.useState<Member[]>([]);
  const [query, setQuery] = React.useState<string | null>(null);
  const [highlight, setHighlight] = React.useState(0);
  const [pending, startTransition] = React.useTransition();
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const suggestions =
    query === null ? [] : members.filter((m) => m.full_name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setBody(value);
    const caret = e.target.selectionStart ?? value.length;
    const match = /(^|\s)@([\p{L}\p{N} .'-]{0,30})$/u.exec(value.slice(0, caret));
    setQuery(match ? match[2] : null);
    setHighlight(0);
  }

  function pick(m: Member) {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([\p{L}\p{N} .'-]{0,30})$/u, `@${m.full_name} `);
    const next = before + body.slice(caret);
    setBody(next);
    setMentions((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  }

  function submit() {
    const text = body.trim();
    if (!text) return;
    const mentionedIds = mentions.filter((m) => text.includes(`@${m.full_name}`)).map((m) => m.id);
    startTransition(async () => {
      const res = await addComment({ task_id: taskId, body: text, mentioned_user_ids: mentionedIds });
      if (!res.ok) return void toast.error(res.error);
      setBody("");
      setMentions([]);
    });
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={body}
        onChange={onChange}
        rows={3}
        maxLength={10000}
        placeholder="Write a comment… Type @ to mention someone."
        aria-label="New comment"
        onKeyDown={(e) => {
          if (suggestions.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => (h + 1) % suggestions.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(suggestions[highlight]);
              return;
            }
            if (e.key === "Escape") {
              setQuery(null);
              return;
            }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      {suggestions.length ? (
        <ul role="listbox" aria-label="Mention someone" className="absolute bottom-full left-0 z-20 mb-1 w-64 rounded-md border bg-popover p-1 shadow-md">
          {suggestions.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm", i === highlight && "bg-muted")}
              >
                <UserAvatar size="xs" name={m.full_name} id={m.id} /> {m.full_name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Ctrl/⌘ + Enter to send</span>
        <Button size="sm" onClick={submit} disabled={pending || !body.trim()}>
          {pending ? <Loader2Icon className="animate-spin" /> : null} Comment
        </Button>
      </div>
    </div>
  );
}
