-- Dashboard, reports and calendar: count every task a person is involved in
-- (assignee, creator or collaborator), not only tasks assigned to them.
--
-- Scope is unchanged: employees see their own tasks, managers their own plus their
-- reportees', admins everyone's. p_member narrows to one person and never widens.

-- People whose tasks a view covers: NULL means everyone (admins with no filter).
create or replace function private.view_people(p_uid uuid, p_ws uuid, p_member uuid)
returns uuid[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_scope uuid[] := private.people_scope(p_uid, p_ws);
begin
  if p_member is null then
    return v_scope;
  end if;
  if v_scope is null or p_member = any (v_scope) then
    return array[p_member];
  end if;
  return '{}';
end;
$$;

-- Is one of p_people the task's assignee, creator or a collaborator? NULL people = any task.
create or replace function private.task_involves(p_people uuid[], p_task uuid, p_assignee uuid, p_creator uuid)
returns boolean
language sql stable set search_path = ''
as $$
  select p_people is null
      or p_assignee = any (p_people)
      or p_creator = any (p_people)
      or exists (select 1 from public.task_collaborators c where c.task_id = p_task and c.user_id = any (p_people))
$$;

-- Tasks in the caller's view (RLS still applies). Usable with PostgREST filters and embeds.
create or replace function public.tasks_in_view(p_member uuid default null)
returns setof public.tasks
language sql stable security invoker set search_path = ''
as $$
  with v as (
    select private.view_people((select auth.uid()), private.current_workspace_id(), p_member) as people
  )
  select t.* from public.tasks t
  where t.workspace_id = private.current_workspace_id()
    and private.task_involves((select people from v), t.id, t.assignee_id, t.creator_id)
$$;

-- Activity on tasks in view, plus the people's own actions outside tasks (e.g. projects).
create or replace function public.activity_in_view(p_member uuid default null)
returns setof public.activity_events
language sql stable security invoker set search_path = ''
as $$
  with v as (
    select private.view_people((select auth.uid()), private.current_workspace_id(), p_member) as people
  )
  select e.* from public.activity_events e
  where e.workspace_id = private.current_workspace_id()
    and (
      (select people from v) is null
      or e.task_id in (select id from public.tasks_in_view(p_member))
      or (e.task_id is null and e.actor_id = any ((select people from v)::uuid[]))
    )
$$;

create or replace function public.dashboard_summary(
  p_from timestamptz default null, p_to timestamptz default null, p_member uuid default null
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_ws uuid := private.current_workspace_id();
  v_uid uuid := (select auth.uid());
  v_people uuid[];
  v_tz text;
  v_today date;
  v_now_time time;
  v_result jsonb;
begin
  if v_ws is null then
    raise exception 'You are not an active member of a workspace' using errcode = '42501';
  end if;
  v_people := private.view_people(v_uid, v_ws, p_member);
  select coalesce(s.timezone, 'UTC') into v_tz from public.workspace_settings s where s.workspace_id = v_ws;
  v_today := (now() at time zone v_tz)::date;
  v_now_time := (now() at time zone v_tz)::time;

  select jsonb_build_object(
    'today', v_today,
    'open', count(*) filter (where t.status <> 'done'),
    'assigned_to_me', count(*) filter (where t.status <> 'done' and t.assignee_id = v_uid),
    'todo', count(*) filter (where t.status = 'todo'),
    'in_progress', count(*) filter (where t.status = 'in_progress'),
    'in_review', count(*) filter (where t.status = 'in_review'),
    'blocked', count(*) filter (where t.status <> 'done' and t.is_blocked),
    'unassigned', count(*) filter (where t.status <> 'done' and t.assignee_id is null),
    'overdue', count(*) filter (where t.status <> 'done' and (t.due_date < v_today
                                  or (t.due_date = v_today and t.due_time is not null and t.due_time < v_now_time))),
    'due_today', count(*) filter (where t.status <> 'done' and t.due_date = v_today),
    'completed', count(*) filter (where t.status = 'done'
                                    and (p_from is null or t.completed_at >= p_from)
                                    and (p_to is null or t.completed_at < p_to)),
    'created', count(*) filter (where (p_from is null or t.created_at >= p_from)
                                  and (p_to is null or t.created_at < p_to)),
    'avg_cycle_hours', round((extract(epoch from avg(t.completed_at - t.created_at) filter (
                                where t.status = 'done'
                                  and (p_from is null or t.completed_at >= p_from)
                                  and (p_to is null or t.completed_at < p_to))) / 3600)::numeric, 1),
    'open_by_priority', jsonb_build_object(
      'urgent', count(*) filter (where t.status <> 'done' and t.priority = 'urgent'),
      'high', count(*) filter (where t.status <> 'done' and t.priority = 'high'),
      'medium', count(*) filter (where t.status <> 'done' and t.priority = 'medium'),
      'low', count(*) filter (where t.status <> 'done' and t.priority = 'low'))
  ) into v_result
  from public.tasks t
  where t.workspace_id = v_ws and t.archived_at is null
    and private.task_involves(v_people, t.id, t.assignee_id, t.creator_id);
  return v_result;
end;
$$;

create or replace function public.project_progress(p_member uuid default null)
returns table (
  project_id uuid, name text, status public.project_status, is_private boolean, target_date date,
  total bigint, done bigint, overdue bigint
)
language sql stable security invoker set search_path = ''
as $$
  with v as (
    select private.view_people((select auth.uid()), private.current_workspace_id(), p_member) as people
  )
  select pr.id, pr.name, pr.status, pr.is_private, pr.target_date,
    count(t.id),
    count(t.id) filter (where t.status = 'done'),
    count(t.id) filter (where t.status <> 'done' and t.due_date < public.workspace_today())
  from public.projects pr
  left join public.tasks t on t.project_id = pr.id and t.archived_at is null
    and private.task_involves((select people from v), t.id, t.assignee_id, t.creator_id)
  where pr.workspace_id = private.current_workspace_id() and pr.archived_at is null
  group by pr.id
  order by pr.name
$$;

create or replace function public.task_throughput(p_from date, p_to date, p_member uuid default null)
returns table (day date, created bigint, completed bigint)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_ws uuid := private.current_workspace_id();
  v_people uuid[];
  v_tz text;
begin
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  v_people := private.view_people((select auth.uid()), v_ws, p_member);
  select coalesce(s.timezone, 'UTC') into v_tz from public.workspace_settings s where s.workspace_id = v_ws;
  return query
  select d::date,
    (select count(*) from public.tasks t
      where t.workspace_id = v_ws and (t.created_at at time zone v_tz)::date = d::date
        and private.task_involves(v_people, t.id, t.assignee_id, t.creator_id)),
    (select count(*) from public.tasks t
      where t.workspace_id = v_ws and t.completed_at is not null and (t.completed_at at time zone v_tz)::date = d::date
        and private.task_involves(v_people, t.id, t.assignee_id, t.creator_id))
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
  order by 1;
end;
$$;

revoke execute on function
  private.view_people(uuid, uuid, uuid),
  private.task_involves(uuid[], uuid, uuid, uuid)
from public, anon;
grant execute on function
  private.view_people(uuid, uuid, uuid),
  private.task_involves(uuid[], uuid, uuid, uuid)
to authenticated, service_role;

revoke execute on function public.tasks_in_view(uuid), public.activity_in_view(uuid) from public, anon;
grant execute on function public.tasks_in_view(uuid), public.activity_in_view(uuid) to authenticated;
