-- Public RPCs called by the app (exposed through the Data API).
-- Task RPCs are SECURITY INVOKER: RLS and the task triggers still apply inside
-- them; they exist so multi-row writes happen in a single transaction.

-- ---------------------------------------------------------------------------
-- create_task: task + labels + collaborators atomically
-- ---------------------------------------------------------------------------
create or replace function public.create_task(
  p_task jsonb,
  p_label_ids uuid[] default '{}',
  p_collaborator_ids uuid[] default '{}',
  p_note text default null
)
returns table (id uuid, key text)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_ws uuid := private.current_workspace_id();
  v_settings public.workspace_settings;
  v_id uuid;
  v_key text;
begin
  if v_ws is null then
    raise exception 'You are not an active member of a workspace' using errcode = '42501';
  end if;
  select * into v_settings from public.workspace_settings s where s.workspace_id = v_ws;

  perform set_config('saunf.change_note', coalesce(p_note, ''), true);

  insert into public.tasks (
    workspace_id, creator_id, title, description, status, priority, progress,
    project_id, department_id, parent_id, assignee_id,
    start_date, due_date, due_time, estimate_hours, is_blocked, blocker_description
  ) values (
    v_ws,
    (select auth.uid()),
    p_task ->> 'title',
    coalesce(p_task ->> 'description', ''),
    coalesce((p_task ->> 'status')::public.task_status, v_settings.default_status, 'todo'),
    coalesce((p_task ->> 'priority')::public.task_priority, v_settings.default_priority, 'medium'),
    coalesce((p_task ->> 'progress')::smallint, 0),
    (p_task ->> 'project_id')::uuid,
    (p_task ->> 'department_id')::uuid,
    (p_task ->> 'parent_id')::uuid,
    (p_task ->> 'assignee_id')::uuid,
    (p_task ->> 'start_date')::date,
    (p_task ->> 'due_date')::date,
    (p_task ->> 'due_time')::time,
    (p_task ->> 'estimate_hours')::numeric,
    coalesce((p_task ->> 'is_blocked')::boolean, false),
    p_task ->> 'blocker_description'
  )
  returning tasks.id, tasks.key into v_id, v_key;

  perform set_config('saunf.change_note', '', true);

  insert into public.task_labels (task_id, label_id, workspace_id)
  select v_id, l, v_ws from unnest(coalesce(p_label_ids, '{}')) as l
  on conflict do nothing;

  insert into public.task_collaborators (task_id, user_id, workspace_id)
  select v_id, u, v_ws from unnest(coalesce(p_collaborator_ids, '{}')) as u
  on conflict do nothing;

  return query select v_id, v_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_task: patch fields (only keys present in p_patch change), and
-- optionally replace labels / collaborators, atomically.
-- p_patch may contain "archived": true|false to archive or restore.
-- ---------------------------------------------------------------------------
create or replace function public.update_task(
  p_task_id uuid,
  p_patch jsonb default '{}'::jsonb,
  p_label_ids uuid[] default null,
  p_collaborator_ids uuid[] default null,
  p_note text default null
)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ws uuid;
begin
  select t.workspace_id into v_ws from public.tasks t where t.id = p_task_id;
  if v_ws is null then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  perform set_config('saunf.change_note', coalesce(p_note, ''), true);

  if coalesce(p_patch, '{}'::jsonb) <> '{}'::jsonb then
    update public.tasks t set
      title = case when p_patch ? 'title' then p_patch ->> 'title' else t.title end,
      description = case when p_patch ? 'description' then coalesce(p_patch ->> 'description', '') else t.description end,
      status = case when p_patch ? 'status' then (p_patch ->> 'status')::public.task_status else t.status end,
      priority = case when p_patch ? 'priority' then (p_patch ->> 'priority')::public.task_priority else t.priority end,
      progress = case when p_patch ? 'progress' then (p_patch ->> 'progress')::smallint else t.progress end,
      project_id = case when p_patch ? 'project_id' then (p_patch ->> 'project_id')::uuid else t.project_id end,
      department_id = case when p_patch ? 'department_id' then (p_patch ->> 'department_id')::uuid else t.department_id end,
      parent_id = case when p_patch ? 'parent_id' then (p_patch ->> 'parent_id')::uuid else t.parent_id end,
      assignee_id = case when p_patch ? 'assignee_id' then (p_patch ->> 'assignee_id')::uuid else t.assignee_id end,
      start_date = case when p_patch ? 'start_date' then (p_patch ->> 'start_date')::date else t.start_date end,
      due_date = case when p_patch ? 'due_date' then (p_patch ->> 'due_date')::date else t.due_date end,
      due_time = case when p_patch ? 'due_time' then (p_patch ->> 'due_time')::time else t.due_time end,
      estimate_hours = case when p_patch ? 'estimate_hours' then (p_patch ->> 'estimate_hours')::numeric else t.estimate_hours end,
      is_blocked = case when p_patch ? 'is_blocked' then (p_patch ->> 'is_blocked')::boolean else t.is_blocked end,
      blocker_description = case when p_patch ? 'blocker_description' then p_patch ->> 'blocker_description' else t.blocker_description end,
      archived_at = case when p_patch ? 'archived'
                         then case when (p_patch ->> 'archived')::boolean then now() else null end
                         else t.archived_at end
    where t.id = p_task_id;
    if not found then
      raise exception 'You do not have permission to update this task' using errcode = '42501';
    end if;
  end if;

  perform set_config('saunf.change_note', '', true);

  if p_label_ids is not null or p_collaborator_ids is not null then
    if not private.can_edit_task(v_uid, p_task_id) then
      raise exception 'You do not have permission to edit this task' using errcode = '42501';
    end if;
  end if;

  if p_label_ids is not null then
    delete from public.task_labels tl where tl.task_id = p_task_id and not (tl.label_id = any (p_label_ids));
    insert into public.task_labels (task_id, label_id, workspace_id)
    select p_task_id, l, v_ws from unnest(p_label_ids) as l
    on conflict do nothing;
  end if;

  if p_collaborator_ids is not null then
    delete from public.task_collaborators tc where tc.task_id = p_task_id and not (tc.user_id = any (p_collaborator_ids));
    insert into public.task_collaborators (task_id, user_id, workspace_id)
    select p_task_id, u, v_ws from unnest(p_collaborator_ids) as u
    on conflict do nothing;
  end if;
end;
$$;

-- Bulk status/priority/assignee/archive changes. Each task goes through the same
-- RLS + trigger checks; returns how many tasks were updated.
create or replace function public.bulk_update_tasks(p_task_ids uuid[], p_patch jsonb)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  if cardinality(p_task_ids) > 200 then
    raise exception 'Too many tasks in one request' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('status', 'priority', 'assignee_id', 'archived')) then
    raise exception 'Unsupported bulk field' using errcode = '22023';
  end if;
  foreach v_id in array p_task_ids loop
    perform public.update_task(v_id, p_patch);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Called after an invited user sets their password.
create or replace function public.accept_invitation()
returns void
language sql security definer set search_path = ''
as $$
  update public.invitations
     set status = 'accepted'
   where accepted_user_id = (select auth.uid()) and status = 'pending';
$$;

-- ---------------------------------------------------------------------------
-- Reporting (SECURITY INVOKER → numbers only include tasks the caller can see)
-- ---------------------------------------------------------------------------
create or replace function public.workspace_today()
returns date
language sql stable security invoker set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select s.timezone from public.workspace_settings s where s.workspace_id = private.current_workspace_id()),
    'UTC'))::date
$$;

create or replace function public.dashboard_summary(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_ws uuid := private.current_workspace_id();
  v_uid uuid := (select auth.uid());
  v_tz text;
  v_today date;
  v_now_time time;
  v_result jsonb;
begin
  if v_ws is null then
    raise exception 'You are not an active member of a workspace' using errcode = '42501';
  end if;
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
  where t.workspace_id = v_ws and t.archived_at is null;
  return v_result;
end;
$$;

create or replace function public.workload_by_member(p_from timestamptz default null, p_to timestamptz default null)
returns table (
  user_id uuid, full_name text, email text, department_id uuid,
  open_count bigint, in_progress_count bigint, in_review_count bigint,
  overdue_count bigint, urgent_count bigint, completed_count bigint
)
language sql stable security invoker set search_path = ''
as $$
  with ws as (
    select private.current_workspace_id() as id, public.workspace_today() as today
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
  group by m.user_id, p.full_name, p.email, m.department_id
  order by count(t.id) filter (where t.status <> 'done') desc, p.full_name
$$;

create or replace function public.project_progress()
returns table (
  project_id uuid, name text, status public.project_status, is_private boolean, target_date date,
  total bigint, done bigint, overdue bigint
)
language sql stable security invoker set search_path = ''
as $$
  select pr.id, pr.name, pr.status, pr.is_private, pr.target_date,
    count(t.id),
    count(t.id) filter (where t.status = 'done'),
    count(t.id) filter (where t.status <> 'done' and t.due_date < public.workspace_today())
  from public.projects pr
  left join public.tasks t on t.project_id = pr.id and t.archived_at is null
  where pr.workspace_id = private.current_workspace_id() and pr.archived_at is null
  group by pr.id
  order by pr.name
$$;

-- Daily created/completed counts between two dates (workspace timezone, inclusive).
create or replace function public.task_throughput(p_from date, p_to date)
returns table (day date, created bigint, completed bigint)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_ws uuid := private.current_workspace_id();
  v_tz text;
begin
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  select coalesce(s.timezone, 'UTC') into v_tz from public.workspace_settings s where s.workspace_id = v_ws;
  return query
  select d::date,
    (select count(*) from public.tasks t
      where t.workspace_id = v_ws and (t.created_at at time zone v_tz)::date = d::date),
    (select count(*) from public.tasks t
      where t.workspace_id = v_ws and t.completed_at is not null and (t.completed_at at time zone v_tz)::date = d::date)
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
  order by 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduled jobs (pg_cron) — not callable by API users
-- ---------------------------------------------------------------------------
create or replace function private.generate_due_notifications()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
  v_data jsonb;
begin
  for r in
    select t.id, t.workspace_id, t.key, t.title, t.assignee_id, t.creator_id, t.due_date, t.due_time,
           ((t.due_date + coalesce(t.due_time, time '23:59:59'))::timestamp at time zone s.timezone) as due_at,
           s.due_soon_hours
    from public.tasks t
    join public.workspace_settings s on s.workspace_id = t.workspace_id
    where s.due_reminders_enabled
      and t.archived_at is null
      and t.status <> 'done'
      and t.due_date is not null
      and t.due_date <= (now() at time zone s.timezone)::date + 8
  loop
    v_data := jsonb_build_object('key', r.key, 'title', r.title, 'due_date', r.due_date, 'due_time', r.due_time);
    if r.due_at < now() then
      perform private.notify(r.assignee_id, r.workspace_id, null, 'task_overdue', r.id, v_data,
        'overdue:' || r.id || ':' || r.due_at);
      if r.creator_id is distinct from r.assignee_id then
        perform private.notify(r.creator_id, r.workspace_id, null, 'task_overdue', r.id, v_data,
          'overdue:' || r.id || ':' || r.due_at);
      end if;
      v_count := v_count + 1;
    elsif r.due_at <= now() + make_interval(hours => r.due_soon_hours) then
      perform private.notify(r.assignee_id, r.workspace_id, null, 'task_due_soon', r.id, v_data,
        'due_soon:' || r.id || ':' || r.due_at);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function private.auto_archive_done_tasks()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.tasks t
     set archived_at = now()
    from public.workspace_settings s
   where s.workspace_id = t.workspace_id
     and s.auto_archive_done_after_days is not null
     and t.status = 'done'
     and t.archived_at is null
     and t.completed_at < now() - make_interval(days => s.auto_archive_done_after_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function private.run_scheduled_jobs()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  return jsonb_build_object(
    'due_notifications', private.generate_due_notifications(),
    'auto_archived', private.auto_archive_done_tasks()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing in `private` is callable except the predicates
-- that RLS policies and invoker RPCs need.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.member_role(uuid, uuid),
  private.is_member(uuid, uuid),
  private.is_admin(uuid, uuid),
  private.is_manager_or_admin(uuid, uuid),
  private.current_workspace_id(),
  private.shares_workspace(uuid, uuid),
  private.can_view_project(uuid, uuid),
  private.can_view_project_row(uuid, uuid, uuid, boolean, uuid),
  private.can_manage_project(uuid, uuid),
  private.can_view_task_row(uuid, uuid, uuid, uuid, uuid, uuid, uuid),
  private.can_view_task(uuid, uuid),
  private.can_edit_task(uuid, uuid),
  private.can_work_task(uuid, uuid),
  private.task_is_archived(uuid),
  private.can_create_task(uuid, uuid),
  private.can_assign_to(uuid, uuid, uuid),
  private.storage_path_task_id(text),
  private.storage_path_matches_task(text)
to authenticated;
grant execute on all functions in schema private to service_role;

revoke execute on function public.create_task(jsonb, uuid[], uuid[], text) from public, anon;
revoke execute on function public.update_task(uuid, jsonb, uuid[], uuid[], text) from public, anon;
revoke execute on function public.bulk_update_tasks(uuid[], jsonb) from public, anon;
revoke execute on function public.accept_invitation() from public, anon;
revoke execute on function public.workspace_today() from public, anon;
revoke execute on function public.dashboard_summary(timestamptz, timestamptz) from public, anon;
revoke execute on function public.workload_by_member(timestamptz, timestamptz) from public, anon;
revoke execute on function public.project_progress() from public, anon;
revoke execute on function public.task_throughput(date, date) from public, anon;
grant execute on function
  public.create_task(jsonb, uuid[], uuid[], text),
  public.update_task(uuid, jsonb, uuid[], uuid[], text),
  public.bulk_update_tasks(uuid[], jsonb),
  public.accept_invitation(),
  public.workspace_today(),
  public.dashboard_summary(timestamptz, timestamptz),
  public.workload_by_member(timestamptz, timestamptz),
  public.project_progress(),
  public.task_throughput(date, date)
to authenticated;
