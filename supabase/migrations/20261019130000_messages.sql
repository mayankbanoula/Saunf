-- Private one-to-one messages.
--
-- * A conversation is between exactly two members of the same workspace.
-- * Only those two people can read it or write to it. There is deliberately no
--   admin exception: workspace admins cannot read other people's messages.
-- * Messages are never written to the activity log or audit trail.
-- See docs/SECURITY.md.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_a uuid not null,
  user_b uuid not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_read_a timestamptz,
  last_read_b timestamptz,
  check (user_a < user_b),
  unique (workspace_id, user_a, user_b),
  foreign key (workspace_id, user_a) references public.workspace_members (workspace_id, user_id) on delete cascade,
  foreign key (workspace_id, user_b) references public.workspace_members (workspace_id, user_id) on delete cascade
);
create index conversations_user_a_idx on public.conversations (user_a, last_message_at desc);
create index conversations_user_b_idx on public.conversations (user_b, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- p_uid is one of the two people in the conversation and still an active member.
create or replace function private.in_conversation(p_uid uuid, p_conversation uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation
      and p_uid in (c.user_a, c.user_b)
      and private.is_member(p_uid, c.workspace_id)
  )
$$;

create or replace function private.messages_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

create or replace function private.messages_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Sending a message also marks the conversation read for the sender.
  update public.conversations
  set last_message_at = new.created_at,
      last_read_a = case when user_a = new.sender_id then new.created_at else last_read_a end,
      last_read_b = case when user_b = new.sender_id then new.created_at else last_read_b end
  where id = new.conversation_id;
  return null;
end;
$$;

create trigger messages_before_insert before insert on public.messages
  for each row execute function private.messages_before_insert();
create trigger messages_after_insert after insert on public.messages
  for each row execute function private.messages_after_insert();

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
revoke all on public.conversations, public.messages from anon, authenticated;
grant select on public.conversations to authenticated;
grant insert (workspace_id, user_a, user_b) on public.conversations to authenticated;
grant select on public.messages to authenticated;
grant insert (conversation_id, sender_id, body) on public.messages to authenticated;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "participants read conversations" on public.conversations
  for select to authenticated
  using ((select auth.uid()) in (user_a, user_b) and private.is_member((select auth.uid()), workspace_id));
create policy "members start conversations" on public.conversations
  for insert to authenticated
  with check (
    (select auth.uid()) in (user_a, user_b)
    and private.is_member(user_a, workspace_id)
    and private.is_member(user_b, workspace_id)
  );

create policy "participants read messages" on public.messages
  for select to authenticated using (private.in_conversation((select auth.uid()), conversation_id));
create policy "participants send messages" on public.messages
  for insert to authenticated
  with check (sender_id = (select auth.uid()) and private.in_conversation((select auth.uid()), conversation_id));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- The conversation between the caller and p_other, created if needed.
create or replace function public.open_conversation(p_other uuid)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ws uuid := private.current_workspace_id();
  v_a uuid := least(v_uid, p_other);
  v_b uuid := greatest(v_uid, p_other);
  v_id uuid;
begin
  if v_ws is null or p_other is null or p_other = v_uid or not private.is_member(p_other, v_ws) then
    raise exception 'You can only message active members of your workspace' using errcode = '22023';
  end if;
  select id into v_id from public.conversations where workspace_id = v_ws and user_a = v_a and user_b = v_b;
  if v_id is null then
    insert into public.conversations (workspace_id, user_a, user_b) values (v_ws, v_a, v_b)
    on conflict (workspace_id, user_a, user_b) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.conversations where workspace_id = v_ws and user_a = v_a and user_b = v_b;
    end if;
  end if;
  return v_id;
end;
$$;

-- Marks the caller's side of a conversation as read up to now.
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not private.in_conversation(v_uid, p_conversation) then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;
  update public.conversations
  set last_read_a = case when user_a = v_uid then now() else last_read_a end,
      last_read_b = case when user_b = v_uid then now() else last_read_b end
  where id = p_conversation;
end;
$$;

-- Number of conversations with messages the caller hasn't read.
create or replace function public.unread_conversation_count()
returns integer
language sql stable security invoker set search_path = ''
as $$
  select count(*)::integer
  from public.conversations c
  where c.last_message_at is not null
    and (
      (c.user_a = (select auth.uid()) and (c.last_read_a is null or c.last_read_a < c.last_message_at))
      or (c.user_b = (select auth.uid()) and (c.last_read_b is null or c.last_read_b < c.last_message_at))
    )
$$;

revoke execute on function
  private.in_conversation(uuid, uuid),
  private.messages_before_insert(),
  private.messages_after_insert()
from public, anon, authenticated;
grant execute on function private.in_conversation(uuid, uuid) to authenticated;
grant execute on all functions in schema private to service_role;

revoke execute on function public.open_conversation(uuid) from public, anon;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
revoke execute on function public.unread_conversation_count() from public, anon;
grant execute on function
  public.open_conversation(uuid),
  public.mark_conversation_read(uuid),
  public.unread_conversation_count()
to authenticated;
