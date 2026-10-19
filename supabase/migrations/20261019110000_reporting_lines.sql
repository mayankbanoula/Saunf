-- Reporting lines and person-scoped views.
--
-- * Admins set who each member reports to (`workspace_members.reports_to`).
--   Only a manager or admin can have reportees.
-- * "People scope" of a user: admins see everyone; a manager sees themselves plus
--   everyone below them in the reporting line (any depth); an employee sees only
--   themselves.
-- * The activity log, dashboard, reports and calendar numbers are limited to the
--   viewer's people scope. Managers can also see and edit their reportees' tasks.
-- See docs/SECURITY.md.

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------
alter table public.workspace_members add column reports_to uuid;
alter table public.workspace_members
  add constraint workspace_members_reports_to_fkey foreign key (workspace_id, reports_to)
  references public.workspace_members (workspace_id, user_id) on delete set null (reports_to);
create index workspace_members_reports_to_idx on public.workspace_members (workspace_id, reports_to);

grant update (reports_to) on public.workspace_members to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Everyone below p_uid in the reporting line, at any depth.
create or replace function private.reportee_ids(p_uid uuid, p_ws uuid)
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  with recursive r (user_id) as (
    select m.user_id from public.workspace_members m
    where m.workspace_id = p_ws and m.reports_to = p_uid
    union
    select m.user_id from public.workspace_members m
    join r on m.reports_to = r.user_id
    where m.workspace_id = p_ws
  )
  select coalesce(array_agg(user_id), '{}') from r where user_id <> p_uid
$$;

-- People whose tasks and activity p_uid may see: NULL means everyone (admins).
create or replace function private.people_scope(p_uid uuid, p_ws uuid)
returns uuid[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role public.workspace_role := private.member_role(p_uid, p_ws);
begin
  if v_role is null then
    return '{}';
  elsif v_role = 'admin' then
    return null;
  elsif v_role = 'manager' then
    return array[p_uid] || private.reportee_ids(p_uid, p_ws);
  end if;
  return array[p_uid];
end;
$$;

create or replace function private.in_people_scope(p_uid uuid, p_ws uuid, p_target uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_scope uuid[];
begin
  if p_target is not null and p_target = p_uid and private.is_member(p_uid, p_ws) then
    return true;
  end if;
  v_scope := private.people_scope(p_uid, p_ws);
  if v_scope is null then
    return private.is_member(p_uid, p_ws);
  end if;
  return p_target is not null and p_target = any (v_scope);
end;
$$;

-- Managers: tasks in their departments (as before) or created by / assigned to a reportee.
create or replace function private.in_manager_scope(
  p_uid uuid, p_ws uuid, p_department uuid, p_creator uuid, p_assignee uuid
)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_depts uuid[];
  v_reportees uuid[];
begin
  if private.member_role(p_uid, p_ws) is distinct from 'manager' then
    return false;
  end if;
  v_reportees := private.reportee_ids(p_uid, p_ws);
  if p_creator = any (v_reportees) or p_assignee = any (v_reportees) then
    return true;
  end if;
  v_depts := private.managed_department_ids(p_uid, p_ws);
  if cardinality(v_depts) = 0 then
    return false;
  end if;
  return (p_department is not null and p_department = any (v_depts))
      or exists (
        select 1 from public.workspace_members m
        where m.workspace_id = p_ws
          and m.user_id in (p_creator, p_assignee)
          and m.department_id = any (v_depts)
      );
end;
$$;

-- ---------------------------------------------------------------------------
-- Validation and audit for reports_to
-- ---------------------------------------------------------------------------
create or replace function private.members_check_reports_to()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.reports_to is null or (tg_op = 'UPDATE' and new.reports_to is not distinct from old.reports_to) then
    return new;
  end if;
  if new.reports_to = new.user_id then
    raise exception 'A member cannot report to themselves' using errcode = '22023';
  end if;
  if not coalesce(private.member_role(new.reports_to, new.workspace_id) in ('admin', 'manager'), false) then
    raise exception 'Members can only report to an active manager or admin' using errcode = '22023';
  end if;
  -- Loop: the member is already above the new manager in the reporting line.
  if new.user_id in (
    with recursive up (user_id, reports_to) as (
      select m.user_id, m.reports_to from public.workspace_members m
      where m.workspace_id = new.workspace_id and m.user_id = new.reports_to
      union
      select m.user_id, m.reports_to from public.workspace_members m
      join up on m.user_id = up.reports_to
      where m.workspace_id = new.workspace_id
    )
    select user_id from up
  ) then
    raise exception 'That would create a loop in the reporting line' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger workspace_members_check_reports_to before insert or update of reports_to on public.workspace_members
  for each row execute function private.members_check_reports_to();

-- Someone who stops being a manager or admin no longer has reportees.
create or replace function private.members_release_reportees()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (new.role = 'employee' and old.role <> 'employee') or (old.is_active and not new.is_active) then
    update public.workspace_members set reports_to = null
    where workspace_id = new.workspace_id and reports_to = new.user_id;
  end if;
  return null;
end;
$$;

create trigger workspace_members_release_reportees after update of role, is_active on public.workspace_members
  for each row execute function private.members_release_reportees();

alter table public.activity_events drop constraint activity_events_event_type_check;
alter table public.activity_events add constraint activity_events_event_type_check check (event_type in (
  'task_created', 'task_edited', 'task_assigned', 'task_reassigned', 'task_unassigned',
  'status_changed', 'priority_changed', 'deadline_changed', 'progress_changed',
  'task_blocked', 'task_unblocked', 'task_completed', 'task_reopened',
  'task_archived', 'task_restored',
  'collaborator_added', 'collaborator_removed', 'label_added', 'label_removed',
  'dependency_added', 'dependency_removed',
  'comment_added', 'comment_edited', 'comment_deleted',
  'attachment_added', 'attachment_removed',
  'project_created', 'project_updated', 'project_member_added', 'project_member_removed',
  'member_joined', 'member_role_changed', 'member_department_changed', 'member_manager_changed',
  'member_deactivated', 'member_reactivated',
  'invitation_sent', 'invitation_revoked',
  'department_created', 'department_updated', 'department_deleted',
  'settings_updated'
));

create or replace function private.members_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_meta jsonb := jsonb_build_object('user_id', new.user_id, 'name', private.profile_name(new.user_id));
begin
  if tg_op = 'INSERT' then
    perform private.log_event(new.workspace_id, null, null, v_actor, 'member_joined', null,
      jsonb_build_object('role', new.role), v_meta);
    return null;
  end if;
  if new.role is distinct from old.role then
    perform private.log_event(new.workspace_id, null, null, v_actor, 'member_role_changed',
      jsonb_build_object('role', old.role), jsonb_build_object('role', new.role), v_meta);
  end if;
  if new.department_id is distinct from old.department_id then
    perform private.log_event(new.workspace_id, null, null, v_actor, 'member_department_changed',
      jsonb_build_object('department', (select name from public.departments where id = old.department_id)),
      jsonb_build_object('department', (select name from public.departments where id = new.department_id)),
      v_meta);
  end if;
  if new.reports_to is distinct from old.reports_to then
    perform private.log_event(new.workspace_id, null, null, v_actor, 'member_manager_changed',
      jsonb_build_object('manager', private.profile_name(old.reports_to)),
      jsonb_build_object('manager', private.profile_name(new.reports_to)),
      v_meta);
  end if;
  if new.is_active is distinct from old.is_active then
    perform private.log_event(new.workspace_id, null, null, v_actor,
      case when new.is_active then 'member_reactivated' else 'member_deactivated' end, null, null, v_meta);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Activity: your own actions, your reportees' actions, and the history of tasks
-- you work on. Workspace-level events stay admin-only.
-- ---------------------------------------------------------------------------
drop policy "read activity" on public.activity_events;
create policy "read activity" on public.activity_events
  for select to authenticated
  using (
    case
      when task_id is not null then
        private.can_view_task((select auth.uid()), task_id)
        and (private.in_people_scope((select auth.uid()), workspace_id, actor_id)
             or private.can_work_task((select auth.uid()), task_id))
      when project_id is not null then
        private.can_view_project((select auth.uid()), project_id)
        and (private.in_people_scope((select auth.uid()), workspace_id, actor_id)
             or private.can_manage_project((select auth.uid()), project_id))
      else private.is_admin((select auth.uid()), workspace_id)
    end
  );

-- ---------------------------------------------------------------------------
-- Reporting RPCs: only tasks assigned to people in the caller's scope (admins:
-- every task). p_member narrows to one person; it never widens the scope.
-- ---------------------------------------------------------------------------
drop function public.dashboard_summary(timestamptz, timestamptz);
drop function public.workload_by_member(timestamptz, timestamptz);
drop function public.project_progress();
drop function public.task_throughput(date, date);

create or replace function private.task_in_view(p_scope uuid[], p_member uuid, p_assignee uuid)
returns boolean
language sql immutable set search_path = ''
as $$
  select (p_scope is null or p_assignee = any (p_scope))
     and (p_member is null or p_assignee = p_member)
$$;

create function public.dashboard_summary(
  p_from timestamptz default null, p_to timestamptz default null, p_member uuid default null
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_ws uuid := private.current_workspace_id();
  v_uid uuid := (select auth.uid());
  v_scope uuid[];
  v_tz text;
  v_today date;
  v_now_time time;
  v_result jsonb;
begin
  if v_ws is null then
    raise exception 'You are not an active member of a workspace' using errcode = '42501';
  end if;
  v_scope := private.people_scope(v_uid, v_ws);
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
    and private.task_in_view(v_scope, p_member, t.assignee_id);
  return v_result;
end;
$$;

create function public.workload_by_member(
  p_from timestamptz default null, p_to timestamptz default null, p_member uuid default null
)
returns table (
  user_id uuid, full_name text, email text, department_id uuid,
  open_count bigint, in_progress_count bigint, in_review_count bigint,
  overdue_count bigint, urgent_count bigint, completed_count bigint
)
language sql stable security invoker set search_path = ''
as $$
  with ws as (
    select private.current_workspace_id() as id, public.workspace_today() as today
  ), sc as (
    select private.people_scope((select auth.uid()), (select id from ws)) as scope
  )
  select m.user_id, p.full_name, p.email, m.department_id,
    count(t.id) filter (where t.status <> 'done'),
    count(t.id) filter (where t.status = 'in_progress'),
    count(t.id) filter (where t.status = 'in_review'),
    count(t.id) filter (where t.status <> 'done' and t.due_date < (select today from ws)),
    count(t.id) filter (where t.status <> 'done' and t.priority = 'urgent'),
    count(t.id) filter (where t.status = 'done'
                          and (p_from is null or t.completed_at >= p_from)
                          and (p_to is null or t.completed_at < p_to))
  from public.workspace_members m
  join public.profiles p on p.id = m.user_id
  left join public.tasks t on t.assignee_id = m.user_id and t.workspace_id = m.workspace_id and t.archived_at is null
  where m.workspace_id = (select id from ws) and m.is_active
    and private.task_in_view((select scope from sc), p_member, m.user_id)
  group by m.user_id, p.full_name, p.email, m.department_id
  order by count(t.id) filter (where t.status <> 'done') desc, p.full_name
$$;

create function public.project_progress(p_member uuid default null)
returns table (
  project_id uuid, name text, status public.project_status, is_private boolean, target_date date,
  total bigint, done bigint, overdue bigint
)
language sql stable security invoker set search_path = ''
as $$
  with sc as (
    select private.people_scope((select auth.uid()), private.current_workspace_id()) as scope
  )
  select pr.id, pr.name, pr.status, pr.is_private, pr.target_date,
    count(t.id),
    count(t.id) filter (where t.status = 'done'),
    count(t.id) filter (where t.status <> 'done' and t.due_date < public.workspace_today())
  from public.projects pr
  left join public.tasks t on t.project_id = pr.id and t.archived_at is null
    and private.task_in_view((select scope from sc), p_member, t.assignee_id)
  where pr.workspace_id = private.current_workspace_id() and pr.archived_at is null
  group by pr.id
  order by pr.name
$$;

create function public.task_throughput(p_from date, p_to date, p_member uuid default null)
returns table (day date, created bigint, completed bigint)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_ws uuid := private.current_workspace_id();
  v_scope uuid[];
  v_tz text;
begin
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  v_scope := private.people_scope((select auth.uid()), v_ws);
  select coalesce(s.timezone, 'UTC') into v_tz from public.workspace_settings s where s.workspace_id = v_ws;
  return query
  select d::date,
    (select count(*) from public.tasks t
      where t.workspace_id = v_ws and (t.created_at at time zone v_tz)::date = d::date
        and private.task_in_view(v_scope, p_member, t.assignee_id)),
    (select count(*) from public.tasks t
      where t.workspace_id = v_ws and t.completed_at is not null and (t.completed_at at time zone v_tz)::date = d::date
        and private.task_in_view(v_scope, p_member, t.assignee_id))
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
  order by 1;
end;
$$;

-- People the caller can pick in person filters: themselves plus their scope.
create function public.people_in_scope()
returns table (user_id uuid, full_name text, email text, reports_to uuid)
language sql stable security invoker set search_path = ''
as $$
  with ws as (select private.current_workspace_id() as id), sc as (
    select private.people_scope((select auth.uid()), (select id from ws)) as scope
  )
  select m.user_id, p.full_name, p.email, m.reports_to
  from public.workspace_members m
  join public.profiles p on p.id = m.user_id
  where m.workspace_id = (select id from ws) and m.is_active
    and private.task_in_view((select scope from sc), null, m.user_id)
  order by m.user_id <> (select auth.uid()), p.full_name, p.email
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  private.reportee_ids(uuid, uuid),
  private.people_scope(uuid, uuid),
  private.in_people_scope(uuid, uuid, uuid),
  private.task_in_view(uuid[], uuid, uuid),
  private.members_check_reports_to(),
  private.members_release_reportees()
from public, anon, authenticated;
grant execute on function
  private.people_scope(uuid, uuid),
  private.in_people_scope(uuid, uuid, uuid),
  private.task_in_view(uuid[], uuid, uuid)
to authenticated;
grant execute on all functions in schema private to service_role;

revoke execute on function public.dashboard_summary(timestamptz, timestamptz, uuid) from public, anon;
revoke execute on function public.workload_by_member(timestamptz, timestamptz, uuid) from public, anon;
revoke execute on function public.project_progress(uuid) from public, anon;
revoke execute on function public.task_throughput(date, date, uuid) from public, anon;
revoke execute on function public.people_in_scope() from public, anon;
grant execute on function
  public.dashboard_summary(timestamptz, timestamptz, uuid),
  public.workload_by_member(timestamptz, timestamptz, uuid),
  public.project_progress(uuid),
  public.task_throughput(date, date, uuid),
  public.people_in_scope()
to authenticated;
