-- Group chats.
--
-- * Any member can create a group with other active members of their workspace.
-- * Only current group members can read or post. There is deliberately no admin
--   exception: workspace admins can't read groups they aren't in.
-- * The creator manages the group (rename, add and remove people); anyone can leave.
--   New members see the group's earlier messages; people who leave lose access.
-- * Group messages are never written to the activity log or audit trail.

create table public.chat_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);
create index chat_groups_workspace_idx on public.chat_groups (workspace_id, last_message_at desc);

create table public.chat_group_members (
  group_id uuid not null references public.chat_groups (id) on delete cascade,
  workspace_id uuid not null,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (group_id, user_id),
  foreign key (workspace_id, user_id) references public.workspace_members (workspace_id, user_id) on delete cascade
);
create index chat_group_members_user_idx on public.chat_group_members (user_id);

create table public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.chat_groups (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index group_messages_group_idx on public.group_messages (group_id, created_at);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.in_chat_group(p_uid uuid, p_group uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.chat_group_members gm
    where gm.group_id = p_group and gm.user_id = p_uid and private.is_member(p_uid, gm.workspace_id)
  )
$$;

create or replace function private.group_messages_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

create or replace function private.group_messages_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.chat_groups set last_message_at = new.created_at where id = new.group_id;
  update public.chat_group_members set last_read_at = new.created_at
  where group_id = new.group_id and user_id = new.sender_id;
  return null;
end;
$$;

create trigger group_messages_before_insert before insert on public.group_messages
  for each row execute function private.group_messages_before_insert();
create trigger group_messages_after_insert after insert on public.group_messages
  for each row execute function private.group_messages_after_insert();

-- ---------------------------------------------------------------------------
-- Grants and RLS: reads and posting go through RLS; group changes go through RPCs.
-- ---------------------------------------------------------------------------
revoke all on public.chat_groups, public.chat_group_members, public.group_messages from anon, authenticated;
grant select on public.chat_groups, public.chat_group_members, public.group_messages to authenticated;
grant insert (group_id, sender_id, body) on public.group_messages to authenticated;

alter table public.chat_groups enable row level security;
alter table public.chat_group_members enable row level security;
alter table public.group_messages enable row level security;

create policy "members read groups" on public.chat_groups
  for select to authenticated using (private.in_chat_group((select auth.uid()), id));
create policy "members read group membership" on public.chat_group_members
  for select to authenticated using (private.in_chat_group((select auth.uid()), group_id));
create policy "members read group messages" on public.group_messages
  for select to authenticated using (private.in_chat_group((select auth.uid()), group_id));
create policy "members post group messages" on public.group_messages
  for insert to authenticated
  with check (sender_id = (select auth.uid()) and private.in_chat_group((select auth.uid()), group_id));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function private.require_group_creator(p_group uuid)
returns public.chat_groups
language plpgsql stable security definer set search_path = ''
as $$
declare
  g public.chat_groups;
begin
  select * into g from public.chat_groups where id = p_group;
  if not found or not private.in_chat_group(auth.uid(), p_group) then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  if g.created_by is distinct from auth.uid() then
    raise exception 'Only the person who created the group can change it' using errcode = '42501';
  end if;
  return g;
end;
$$;

-- Adds active workspace members to a group (skipping anyone already in it).
create or replace function private.add_group_members(p_group uuid, p_ws uuid, p_users uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from unnest(p_users) u where not private.is_member(u, p_ws)) then
    raise exception 'You can only add active members of your workspace' using errcode = '22023';
  end if;
  insert into public.chat_group_members (group_id, workspace_id, user_id)
  select p_group, p_ws, u from unnest(p_users) u
  on conflict do nothing;
end;
$$;

create or replace function public.create_chat_group(p_name text, p_members uuid[])
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ws uuid := private.current_workspace_id();
  v_id uuid;
begin
  if v_ws is null then
    raise exception 'You are not an active member of a workspace' using errcode = '42501';
  end if;
  if coalesce(cardinality(array_remove(p_members, v_uid)), 0) = 0 then
    raise exception 'Add at least one other person to the group' using errcode = '22023';
  end if;
  insert into public.chat_groups (workspace_id, name, created_by) values (v_ws, btrim(p_name), v_uid)
  returning id into v_id;
  perform private.add_group_members(v_id, v_ws, array_append(array_remove(p_members, v_uid), v_uid));
  return v_id;
end;
$$;

create or replace function public.add_chat_group_members(p_group uuid, p_members uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  g public.chat_groups := private.require_group_creator(p_group);
begin
  perform private.add_group_members(p_group, g.workspace_id, coalesce(p_members, '{}'));
end;
$$;

create or replace function public.rename_chat_group(p_group uuid, p_name text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_group_creator(p_group);
  update public.chat_groups set name = btrim(p_name) where id = p_group;
end;
$$;

-- The creator can remove anyone; everyone can remove themselves (leave).
create or replace function public.remove_chat_group_member(p_group uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_user is distinct from auth.uid() then
    perform private.require_group_creator(p_group);
  elsif not private.in_chat_group(auth.uid(), p_group) then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  delete from public.chat_group_members where group_id = p_group and user_id = p_user;
  -- A group nobody is in any more is deleted with its messages.
  delete from public.chat_groups g
  where g.id = p_group and not exists (select 1 from public.chat_group_members m where m.group_id = g.id);
end;
$$;

create or replace function public.mark_chat_group_read(p_group uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.chat_group_members set last_read_at = now()
  where group_id = p_group and user_id = auth.uid();
end;
$$;

-- Direct conversations plus groups with messages the caller hasn't read.
create or replace function public.unread_conversation_count()
returns integer
language sql stable security invoker set search_path = ''
as $$
  select (
    select count(*)::integer
    from public.conversations c
    where c.last_message_at is not null
      and (
        (c.user_a = (select auth.uid()) and (c.last_read_a is null or c.last_read_a < c.last_message_at))
        or (c.user_b = (select auth.uid()) and (c.last_read_b is null or c.last_read_b < c.last_message_at))
      )
  ) + (
    select count(*)::integer
    from public.chat_groups g
    join public.chat_group_members gm on gm.group_id = g.id and gm.user_id = (select auth.uid())
    where g.last_message_at is not null and (gm.last_read_at is null or gm.last_read_at < g.last_message_at)
  )
$$;

revoke execute on function
  private.in_chat_group(uuid, uuid),
  private.group_messages_before_insert(),
  private.group_messages_after_insert(),
  private.require_group_creator(uuid),
  private.add_group_members(uuid, uuid, uuid[])
from public, anon, authenticated;
grant execute on function private.in_chat_group(uuid, uuid) to authenticated;
grant execute on all functions in schema private to service_role;

revoke execute on function
  public.create_chat_group(text, uuid[]),
  public.add_chat_group_members(uuid, uuid[]),
  public.rename_chat_group(uuid, text),
  public.remove_chat_group_member(uuid, uuid),
  public.mark_chat_group_read(uuid)
from public, anon;
grant execute on function
  public.create_chat_group(text, uuid[]),
  public.add_chat_group_members(uuid, uuid[]),
  public.rename_chat_group(uuid, text),
  public.remove_chat_group_member(uuid, uuid),
  public.mark_chat_group_read(uuid)
to authenticated;
