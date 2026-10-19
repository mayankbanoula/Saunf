-- Personal to-do lists.
--
-- * Each member has their own list. Only the owner can read or change it; admins
--   can read everyone's lists (read-only). Managers and other members cannot.
-- * An item either happens once (`repeat = 'none'`, done when `completed_at` is set)
--   or repeats every day / every weekday. Repeating items are ticked off per day in
--   `todo_completions`, so they come back unticked the next day and keep a history.
-- See docs/SECURITY.md.

create type public.todo_repeat as enum ('none', 'daily', 'weekdays');

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  repeat public.todo_repeat not null default 'none',
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, user_id) references public.workspace_members (workspace_id, user_id) on delete cascade
);
create index todos_owner_idx on public.todos (workspace_id, user_id, created_at);

create table public.todo_completions (
  todo_id uuid not null references public.todos (id) on delete cascade,
  day date not null,
  completed_at timestamptz not null default now(),
  primary key (todo_id, day)
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.owns_todo(p_uid uuid, p_todo uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.todos t
    where t.id = p_todo and t.user_id = p_uid and private.is_member(p_uid, t.workspace_id)
  )
$$;

create or replace function private.can_read_todo(p_uid uuid, p_todo uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.todos t
    where t.id = p_todo
      and ((t.user_id = p_uid and private.is_member(p_uid, t.workspace_id)) or private.is_admin(p_uid, t.workspace_id))
  )
$$;

-- Server-owned fields; one-off state is meaningless on a repeating item.
create or replace function private.todos_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.id := old.id;
    new.workspace_id := old.workspace_id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  if new.repeat <> 'none' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger todos_before_write before insert or update on public.todos
  for each row execute function private.todos_before_write();

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
revoke all on public.todos, public.todo_completions from anon, authenticated;
grant select, delete on public.todos to authenticated;
grant insert (workspace_id, user_id, title, repeat, due_date) on public.todos to authenticated;
grant update (title, repeat, due_date, completed_at) on public.todos to authenticated;
grant select, insert, delete on public.todo_completions to authenticated;

alter table public.todos enable row level security;
alter table public.todo_completions enable row level security;

create policy "owners and admins read todos" on public.todos
  for select to authenticated
  using (
    (user_id = (select auth.uid()) and private.is_member((select auth.uid()), workspace_id))
    or private.is_admin((select auth.uid()), workspace_id)
  );
create policy "owners add todos" on public.todos
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_member((select auth.uid()), workspace_id));
create policy "owners update todos" on public.todos
  for update to authenticated
  using (user_id = (select auth.uid()) and private.is_member((select auth.uid()), workspace_id))
  with check (user_id = (select auth.uid()));
create policy "owners delete todos" on public.todos
  for delete to authenticated
  using (user_id = (select auth.uid()) and private.is_member((select auth.uid()), workspace_id));

create policy "owners and admins read completions" on public.todo_completions
  for select to authenticated using (private.can_read_todo((select auth.uid()), todo_id));
create policy "owners tick todos" on public.todo_completions
  for insert to authenticated with check (private.owns_todo((select auth.uid()), todo_id));
create policy "owners untick todos" on public.todo_completions
  for delete to authenticated using (private.owns_todo((select auth.uid()), todo_id));

-- ---------------------------------------------------------------------------
-- Tick or untick an item for today (workspace timezone).
-- ---------------------------------------------------------------------------
create or replace function public.set_todo_done(p_todo uuid, p_done boolean)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_repeat public.todo_repeat;
  v_today date := public.workspace_today();
begin
  select repeat into v_repeat from public.todos where id = p_todo and user_id = (select auth.uid());
  if not found then
    raise exception 'To-do not found' using errcode = 'P0002';
  end if;
  if v_repeat = 'none' then
    update public.todos set completed_at = case when p_done then now() end where id = p_todo;
  elsif p_done then
    insert into public.todo_completions (todo_id, day) values (p_todo, v_today) on conflict do nothing;
  else
    delete from public.todo_completions where todo_id = p_todo and day = v_today;
  end if;
end;
$$;

revoke execute on function
  private.owns_todo(uuid, uuid),
  private.can_read_todo(uuid, uuid),
  private.todos_before_write()
from public, anon, authenticated;
grant execute on function private.owns_todo(uuid, uuid), private.can_read_todo(uuid, uuid) to authenticated;
grant execute on all functions in schema private to service_role;

revoke execute on function public.set_todo_done(uuid, boolean) from public, anon;
grant execute on function public.set_todo_done(uuid, boolean) to authenticated;
