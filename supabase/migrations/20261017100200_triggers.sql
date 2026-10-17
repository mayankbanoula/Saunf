-- Triggers: server-derived fields, field-level permission guards, the
-- append-only activity log, assignment history and notifications.
--
-- All trigger functions are SECURITY DEFINER (owner: postgres) so they can write
-- audit/notification rows that ordinary users have no privileges on. They use
-- auth.uid() (from the verified JWT) as the actor; it is NULL for trusted system
-- contexts (service role, pg_cron, Supabase Auth).

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function private.log_event(
  p_ws uuid, p_task uuid, p_project uuid, p_actor uuid, p_type text,
  p_old jsonb default null, p_new jsonb default null, p_meta jsonb default '{}'::jsonb
)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.activity_events (workspace_id, task_id, project_id, actor_id, event_type, old_value, new_value, metadata)
  values (p_ws, p_task, p_project, p_actor, p_type, p_old, p_new, coalesce(p_meta, '{}'::jsonb));
$$;

-- Insert a notification unless the recipient is the actor, inactive, or can't see the task.
create or replace function private.notify(
  p_recipient uuid, p_ws uuid, p_actor uuid, p_type public.notification_type,
  p_task uuid, p_data jsonb default '{}'::jsonb, p_dedupe text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_recipient is null or p_recipient is not distinct from p_actor then
    return;
  end if;
  if not private.is_member(p_recipient, p_ws) then
    return;
  end if;
  if p_task is not null and not private.can_view_task(p_recipient, p_task) then
    return;
  end if;
  insert into public.notifications (workspace_id, recipient_id, actor_id, type, task_id, data, dedupe_key)
  values (p_ws, p_recipient, p_actor, p_type, p_task, coalesce(p_data, '{}'::jsonb), p_dedupe)
  on conflict (recipient_id, dedupe_key) do nothing;
end;
$$;

create or replace function private.change_note()
returns text
language sql stable set search_path = ''
as $$
  select nullif(left(btrim(coalesce(current_setting('saunf.change_note', true), '')), 500), '')
$$;

create or replace function private.profile_name(p_uid uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(nullif(full_name, ''), email) from public.profiles where id = p_uid
$$;

-- ---------------------------------------------------------------------------
-- Append-only audit tables
-- ---------------------------------------------------------------------------
create or replace function private.prevent_audit_mutation()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_people text[] := case tg_table_name
    when 'activity_events' then array['actor_id']
    else array['previous_assignee_id', 'new_assignee_id', 'changed_by'] end;
  k text;
begin
  if tg_op = 'DELETE' and current_setting('saunf.allow_audit_purge', true) = 'on' then
    return old;
  end if;
  -- The only permitted UPDATE: a deleted user's id becoming NULL (ON DELETE SET NULL),
  -- which pseudonymises history without changing what happened.
  if tg_op = 'UPDATE' and (to_jsonb(new) - v_people) = (to_jsonb(old) - v_people) then
    foreach k in array v_people loop
      if (to_jsonb(new) ->> k) is not null and (to_jsonb(new) ->> k) is distinct from (to_jsonb(old) ->> k) then
        raise exception '% is append-only', tg_table_name using errcode = '42501';
      end if;
    end loop;
    return new;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

create trigger activity_events_append_only
  before update or delete on public.activity_events
  for each row execute function private.prevent_audit_mutation();
create trigger task_assignments_append_only
  before update or delete on public.task_assignments
  for each row execute function private.prevent_audit_mutation();

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create or replace function private.tasks_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_num bigint;
  v_prefix text;
begin
  if v_uid is not null then
    new.creator_id := v_uid;
    if not private.can_create_task(v_uid, new.workspace_id) then
      raise exception 'You are not allowed to create tasks in this workspace' using errcode = '42501';
    end if;
    if not private.can_assign_to(v_uid, new.workspace_id, new.assignee_id) then
      raise exception 'You are not allowed to assign tasks to this person' using errcode = '42501';
    end if;
    if new.project_id is not null and not private.can_view_project(v_uid, new.project_id) then
      raise exception 'Project not found' using errcode = '42501';
    end if;
    if new.parent_id is not null and not private.can_view_task(v_uid, new.parent_id) then
      raise exception 'Parent task not found' using errcode = '42501';
    end if;
  end if;

  -- Concurrency-safe numbering: the row lock on the workspace serialises inserts.
  update public.workspaces
     set task_counter = task_counter + 1
   where id = new.workspace_id
  returning task_counter, task_prefix into v_num, v_prefix;
  if v_num is null then
    raise exception 'Workspace not found';
  end if;
  new.number := v_num;
  new.key := v_prefix || '-' || lpad(v_num::text, greatest(5, length(v_num::text)), '0');

  new.title := btrim(new.title);
  new.created_at := now();
  new.updated_at := now();
  new.updated_by := v_uid;
  new.archived_at := null;
  new.archived_by := null;

  if new.department_id is null then
    select department_id into new.department_id
    from public.workspace_members
    where workspace_id = new.workspace_id and user_id = coalesce(new.assignee_id, new.creator_id);
  end if;

  if new.assignee_id is not null then
    new.assigned_at := now();
    new.assigned_by := coalesce(v_uid, new.creator_id);
  else
    new.assigned_at := null;
    new.assigned_by := null;
  end if;

  if new.status = 'done' then
    new.completed_at := now();
    new.completed_by := coalesce(v_uid, new.creator_id);
    new.progress := 100;
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;

  if not new.is_blocked then
    new.blocker_description := null;
  end if;
  return new;
end;
$$;

create or replace function private.tasks_before_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_details boolean;
  v_work boolean;
  v_assign boolean;
  v_archive boolean;
begin
  -- Immutable columns.
  new.id := old.id;
  new.workspace_id := old.workspace_id;
  new.number := old.number;
  new.key := old.key;
  new.creator_id := old.creator_id;
  new.created_at := old.created_at;
  new.title := btrim(new.title);

  v_details := row(new.title, new.description, new.priority, new.project_id, new.department_id, new.parent_id,
                   new.start_date, new.due_date, new.due_time, new.estimate_hours)
    is distinct from row(old.title, old.description, old.priority, old.project_id, old.department_id, old.parent_id,
                         old.start_date, old.due_date, old.due_time, old.estimate_hours);
  v_work := row(new.status, new.progress, new.is_blocked, new.blocker_description)
    is distinct from row(old.status, old.progress, old.is_blocked, old.blocker_description);
  v_assign := new.assignee_id is distinct from old.assignee_id;
  v_archive := (new.archived_at is null) <> (old.archived_at is null);

  if old.archived_at is not null and new.archived_at is not null and (v_details or v_work or v_assign) then
    raise exception 'Archived tasks cannot be edited. Restore the task first.' using errcode = '42501';
  end if;

  if v_uid is not null then
    if (v_details or v_archive) and not private.can_edit_task(v_uid, old.id) then
      raise exception 'You do not have permission to edit this task' using errcode = '42501';
    end if;
    if v_work and not private.can_work_task(v_uid, old.id) then
      raise exception 'You do not have permission to update this task' using errcode = '42501';
    end if;
    if v_assign then
      if not (private.can_edit_task(v_uid, old.id) or old.assignee_id = v_uid) then
        raise exception 'You do not have permission to reassign this task' using errcode = '42501';
      end if;
      if not private.can_assign_to(v_uid, old.workspace_id, new.assignee_id) then
        raise exception 'You are not allowed to assign tasks to this person' using errcode = '42501';
      end if;
    end if;
    if new.project_id is distinct from old.project_id and new.project_id is not null
       and not private.can_view_project(v_uid, new.project_id) then
      raise exception 'Project not found' using errcode = '42501';
    end if;
  end if;

  if new.parent_id is distinct from old.parent_id and new.parent_id is not null then
    if v_uid is not null and not private.can_view_task(v_uid, new.parent_id) then
      raise exception 'Parent task not found' using errcode = '42501';
    end if;
    if exists (
      with recursive ancestors(id) as (
        select new.parent_id
        union
        select t.parent_id from public.tasks t join ancestors a on t.id = a.id where t.parent_id is not null
      )
      select 1 from ancestors where id = old.id
    ) then
      raise exception 'A task cannot be its own ancestor' using errcode = '23514';
    end if;
  end if;

  -- Derived fields.
  if v_assign then
    if new.assignee_id is null then
      new.assigned_at := null;
      new.assigned_by := null;
    else
      new.assigned_at := now();
      new.assigned_by := v_uid;
    end if;
  else
    new.assigned_at := old.assigned_at;
    new.assigned_by := old.assigned_by;
  end if;

  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := now();
    new.completed_by := v_uid;
    new.progress := 100;
  elsif new.status <> 'done' and old.status = 'done' then
    new.completed_at := null;
    new.completed_by := null;
    if new.progress = 100 and old.progress = 100 then
      new.progress := case when new.status = 'todo' then 0 else 90 end;
    end if;
  else
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  end if;

  if new.archived_at is not null and old.archived_at is null then
    new.archived_at := now();
    new.archived_by := v_uid;
  elsif new.archived_at is null then
    new.archived_by := null;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;

  if not new.is_blocked then
    new.blocker_description := null;
  end if;

  new.updated_at := now();
  new.updated_by := v_uid;
  return new;
end;
$$;

create or replace function private.tasks_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.creator_id);
begin
  perform private.log_event(new.workspace_id, new.id, new.project_id, v_actor, 'task_created', null,
    jsonb_build_object('title', new.title, 'status', new.status, 'priority', new.priority,
                       'assignee_id', new.assignee_id, 'due_date', new.due_date));

  if new.assignee_id is not null then
    insert into public.task_assignments (workspace_id, task_id, previous_assignee_id, new_assignee_id, changed_by, note)
    values (new.workspace_id, new.id, null, new.assignee_id, v_actor, private.change_note());
    perform private.log_event(new.workspace_id, new.id, new.project_id, v_actor, 'task_assigned', null,
      jsonb_build_object('assignee_id', new.assignee_id, 'assignee_name', private.profile_name(new.assignee_id)),
      jsonb_strip_nulls(jsonb_build_object('note', private.change_note())));
    perform private.notify(new.assignee_id, new.workspace_id, v_actor, 'task_assigned', new.id,
      jsonb_strip_nulls(jsonb_build_object('key', new.key, 'title', new.title, 'note', private.change_note())));
  end if;
  return null;
end;
$$;

create or replace function private.tasks_after_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_fields text[] := '{}';
  v_note text := private.change_note();
  v_data jsonb := jsonb_build_object('key', new.key, 'title', new.title);
  v_completion_change boolean := (new.status = 'done') <> (old.status = 'done');
  r record;
begin
  -- Assignment
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.task_assignments (workspace_id, task_id, previous_assignee_id, new_assignee_id, changed_by, note)
    values (new.workspace_id, new.id, old.assignee_id, new.assignee_id, v_actor, v_note);
    perform private.log_event(new.workspace_id, new.id, new.project_id, v_actor,
      case when new.assignee_id is null then 'task_unassigned'
           when old.assignee_id is null then 'task_assigned'
           else 'task_reassigned' end,
      jsonb_build_object('assignee_id', old.assignee_id, 'assignee_name', private.profile_name(old.assignee_id)),
      jsonb_build_object('assignee_id', new.assignee_id, 'assignee_name', private.profile_name(new.assignee_id)),
      jsonb_strip_nulls(jsonb_build_object('note', v_note)));
    perform private.notify(new.assignee_id, new.workspace_id, v_actor,
      case when old.assignee_id is null then 'task_assigned'::public.notification_type
           else 'task_reassigned'::public.notification_type end,
      new.id, jsonb_strip_nulls(v_data || jsonb_build_object('note', v_note)));
  end if;

  -- Status
  if new.status is distinct from old.status then
    if new.status = 'done' then
      perform private.log_event(new.workspace_id, new.id, new.project_id, v_actor, 'task_completed',
        jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
      for r in
        select distinct u from unnest(array[new.creator_id, new.assignee_id]
          || array(select user_id from public.task_collaborators where task_id = new.id)) u
      loop
        perform private.notify(r.u, new.workspace_id, v_actor, 'task_completed', new.id, v_data);
      end loop;
    elsif old.status = 'done' then
      perform private.log_event(new.workspace_id, new.id, new.project_id, v_actor, 'task_reopened',
        jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
      perform private.notify(new.assignee_id, new.workspace_id, v_actor, 'task_reopened', new.id, v_data);
      if new.creator_id is distinct from new.assignee_id then
        perform private.notify(new.creator_id, new.workspace_id, v_actor, 'task_reopened', new.id, v_data);
      end if;
    else
      perform private.log_event(new.workspace_id, new.id, new.project_id, v_actor, 'status_changed',
        jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
      if new.status = 'in_review' then
        perform private.notify(new.creator_id, new.workspace_id, v_actor, 'review_requested', new.id, v_data);
      end if;
    end if;
  end if;

  if new.priority is distinct from old.priority then
    perform private.log_event(new.workspace_id, new.id, new.project_id, v_actor, 'priority_changed',
      jsonb_build_object('priority', old.priority), jsonb_build_object('priority', new.priority));
  end if;

  if row(new.due_date, new.due_time) is distinct from row(old.due_date, old.due_time) then
    perform private.log_event(new.workspace_id, new.id, new.project_id, v_actor, 'deadline_changed',
      jsonb_build_object('due_date', old.due_date, 'due_time', old.due_time),
      jsonb_build_object('due_date', new.due_date, 'due_time', new.due_time));
  end if;

  if new.progress is distinct from old.progress and not v_completion_change then
    perform private.log_event(new.workspace_id, new.id, new.project_id, v_actor, 'progress_changed',
      jsonb_build_object('progress', old.progress), jsonb_build_object('progress', new.progress));
  end if;

  if new.is_blocked and not old.is_blocked then
    perform private.log_event(new.workspace_id, new.id, new.project_id, v_actor, 'task_blocked', null,
      jsonb_build_object('blocker_description', new.blocker_description));
  elsif old.is_blocked and not new.is_blocked then
    perform private.log_event(new.workspace_id, new.id, new.project_id, v_actor, 'task_unblocked',
      jsonb_build_object('blocker_description', old.blocker_description), null);
  end if;

  -- Other detail edits are grouped into one event.
  if new.title is distinct from old.title then
    v_fields := array_append(v_fields, 'title');
    v_old := v_old || jsonb_build_object('title', old.title);
    v_new := v_new || jsonb_build_object('title', new.title);
  end if;
  if new.description is distinct from old.description then
    v_fields := array_append(v_fields, 'description'); -- the text itself is not copied into the log
  end if;
  if new.project_id is distinct from old.project_id then
    v_fields := array_append(v_fields, 'project');
    v_old := v_old || jsonb_build_object('project', (select name from public.projects where id = old.project_id));
    v_new := v_new || jsonb_build_object('project', (select name from public.projects where id = new.project_id));
  end if;
  if new.department_id is distinct from old.department_id then
    v_fields := array_append(v_fields, 'department');
    v_old := v_old || jsonb_build_object('department', (select name from public.departments where id = old.department_id));
    v_new := v_new || jsonb_build_object('department', (select name from public.departments where id = new.department_id));
  end if;
  if new.parent_id is distinct from old.parent_id then
    v_fields := array_append(v_fields, 'parent');
    v_old := v_old || jsonb_build_object('parent', (select key from public.tasks where id = old.parent_id));
    v_new := v_new || jsonb_build_object('parent', (select key from public.tasks where id = new.parent_id));
  end if;
  if new.start_date is distinct from old.start_date then
    v_fields := array_append(v_fields, 'start_date');
    v_old := v_old || jsonb_build_object('start_date', old.start_date);
    v_new := v_new || jsonb_build_object('start_date', new.start_date);
  end if;
  if new.estimate_hours is distinct from old.estimate_hours then
    v_fields := array_append(v_fields, 'estimate');
    v_old := v_old || jsonb_build_object('estimate_hours', old.estimate_hours);
    v_new := v_new || jsonb_build_object('estimate_hours', new.estimate_hours);
  end if;
  if cardinality(v_fields) > 0 then
    perform private.log_event(new.workspace_id, new.id, new.project_id, v_actor, 'task_edited',
      v_old, v_new, jsonb_build_object('fields', to_jsonb(v_fields)));
  end if;

  if new.archived_at is not null and old.archived_at is null then
    perform private.log_event(new.workspace_id, new.id, new.project_id, v_actor, 'task_archived');
  elsif new.archived_at is null and old.archived_at is not null then
    perform private.log_event(new.workspace_id, new.id, new.project_id, v_actor, 'task_restored');
  end if;
  return null;
end;
$$;

create trigger tasks_before_insert before insert on public.tasks
  for each row execute function private.tasks_before_insert();
create trigger tasks_before_update before update on public.tasks
  for each row execute function private.tasks_before_update();
create trigger tasks_after_insert after insert on public.tasks
  for each row execute function private.tasks_after_insert();
create trigger tasks_after_update after update on public.tasks
  for each row execute function private.tasks_after_update();

-- ---------------------------------------------------------------------------
-- Collaborators, labels, dependencies
-- ---------------------------------------------------------------------------
create or replace function private.task_children_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'task_collaborators' then
    new.added_by := coalesce(auth.uid(), new.added_by);
    new.added_at := now();
  elsif tg_table_name = 'task_dependencies' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    if exists (
      with recursive chain(id) as (
        select new.depends_on_task_id
        union
        select d.depends_on_task_id from public.task_dependencies d join chain c on d.task_id = c.id
      )
      select 1 from chain where id = new.task_id
    ) then
      raise exception 'This dependency would create a cycle' using errcode = '23514';
    end if;
  elsif tg_table_name = 'task_labels' then
    new.added_at := now();
  end if;
  return new;
end;
$$;

create or replace function private.task_children_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_row record;
  v_task record;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  select id, workspace_id, project_id, key, title into v_task from public.tasks where id = v_row.task_id;
  if not found then
    return null; -- parent task is being deleted
  end if;

  if tg_table_name = 'task_collaborators' then
    perform private.log_event(v_task.workspace_id, v_task.id, v_task.project_id, v_actor,
      case when tg_op = 'INSERT' then 'collaborator_added' else 'collaborator_removed' end, null, null,
      jsonb_build_object('user_id', v_row.user_id, 'name', private.profile_name(v_row.user_id)));
    if tg_op = 'INSERT' then
      perform private.notify(v_row.user_id, v_task.workspace_id, v_actor, 'collaborator_added', v_task.id,
        jsonb_build_object('key', v_task.key, 'title', v_task.title));
    end if;
  elsif tg_table_name = 'task_labels' then
    perform private.log_event(v_task.workspace_id, v_task.id, v_task.project_id, v_actor,
      case when tg_op = 'INSERT' then 'label_added' else 'label_removed' end, null, null,
      jsonb_build_object('label_id', v_row.label_id,
                         'name', (select name from public.labels where id = v_row.label_id)));
  elsif tg_table_name = 'task_dependencies' then
    perform private.log_event(v_task.workspace_id, v_task.id, v_task.project_id, v_actor,
      case when tg_op = 'INSERT' then 'dependency_added' else 'dependency_removed' end, null, null,
      jsonb_build_object('depends_on_task_id', v_row.depends_on_task_id,
                         'key', (select key from public.tasks where id = v_row.depends_on_task_id)));
  end if;
  return null;
end;
$$;

create trigger task_collaborators_before_insert before insert on public.task_collaborators
  for each row execute function private.task_children_before_insert();
create trigger task_dependencies_before_insert before insert on public.task_dependencies
  for each row execute function private.task_children_before_insert();
create trigger task_labels_before_insert before insert on public.task_labels
  for each row execute function private.task_children_before_insert();

create trigger task_collaborators_audit after insert or delete on public.task_collaborators
  for each row execute function private.task_children_audit();
create trigger task_labels_audit after insert or delete on public.task_labels
  for each row execute function private.task_children_audit();
create trigger task_dependencies_audit after insert or delete on public.task_dependencies
  for each row execute function private.task_children_audit();

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
create or replace function private.comments_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.author_id := coalesce(auth.uid(), new.author_id);
  new.body := btrim(new.body);
  new.created_at := now();
  new.updated_at := now();
  new.edited_at := null;
  new.deleted_at := null;
  new.deleted_by := null;
  -- Keep only mentions of active members who can see the task.
  select coalesce(array_agg(distinct u), '{}') into new.mentioned_user_ids
  from unnest(coalesce(new.mentioned_user_ids, '{}')) u
  where u is distinct from new.author_id
    and private.is_member(u, new.workspace_id)
    and private.can_view_task(u, new.task_id);
  return new;
end;
$$;

create or replace function private.comments_before_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if old.deleted_at is not null then
    raise exception 'Deleted comments cannot be changed' using errcode = '42501';
  end if;
  new.id := old.id;
  new.task_id := old.task_id;
  new.workspace_id := old.workspace_id;
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  new.mentioned_user_ids := old.mentioned_user_ids;
  new.body := btrim(new.body);

  if new.body is distinct from old.body then
    if v_uid is not null and v_uid is distinct from old.author_id then
      raise exception 'Only the author can edit a comment' using errcode = '42501';
    end if;
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;

  if new.deleted_at is not null then
    new.deleted_at := now();
    new.deleted_by := v_uid;
  else
    new.deleted_by := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.comments_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.author_id);
  v_task record;
  v_data jsonb;
  r record;
begin
  select id, workspace_id, project_id, key, title, creator_id, assignee_id into v_task
  from public.tasks where id = new.task_id;

  if tg_op = 'INSERT' then
    perform private.log_event(v_task.workspace_id, v_task.id, v_task.project_id, v_actor, 'comment_added',
      null, null, jsonb_build_object('comment_id', new.id));
    v_data := jsonb_build_object('key', v_task.key, 'title', v_task.title, 'comment_id', new.id,
                                 'excerpt', left(new.body, 140));
    for r in select unnest(new.mentioned_user_ids) as u loop
      perform private.notify(r.u, v_task.workspace_id, v_actor, 'mentioned', v_task.id, v_data);
    end loop;
    for r in
      select distinct u from unnest(array[v_task.creator_id, v_task.assignee_id]
        || array(select user_id from public.task_collaborators where task_id = v_task.id)) u
      where u is not null and not (u = any (new.mentioned_user_ids))
    loop
      perform private.notify(r.u, v_task.workspace_id, v_actor, 'comment_added', v_task.id, v_data);
    end loop;
  elsif new.deleted_at is not null and old.deleted_at is null then
    perform private.log_event(v_task.workspace_id, v_task.id, v_task.project_id, auth.uid(), 'comment_deleted',
      null, null, jsonb_build_object('comment_id', new.id, 'author_id', new.author_id));
  elsif new.body is distinct from old.body then
    perform private.log_event(v_task.workspace_id, v_task.id, v_task.project_id, auth.uid(), 'comment_edited',
      null, null, jsonb_build_object('comment_id', new.id));
  end if;
  return null;
end;
$$;

create trigger task_comments_before_insert before insert on public.task_comments
  for each row execute function private.comments_before_insert();
create trigger task_comments_before_update before update on public.task_comments
  for each row execute function private.comments_before_update();
create trigger task_comments_after_write after insert or update on public.task_comments
  for each row execute function private.comments_after_write();

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------
create or replace function private.attachments_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  new.created_at := now();
  return new;
end;
$$;

create or replace function private.attachments_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row record;
  v_task record;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  select id, workspace_id, project_id into v_task from public.tasks where id = v_row.task_id;
  if not found then
    return null;
  end if;
  perform private.log_event(v_task.workspace_id, v_task.id, v_task.project_id, coalesce(auth.uid(), v_row.uploaded_by),
    case when tg_op = 'INSERT' then 'attachment_added' else 'attachment_removed' end, null, null,
    jsonb_build_object('attachment_id', v_row.id, 'file_name', v_row.file_name, 'size_bytes', v_row.size_bytes));
  return null;
end;
$$;

create trigger task_attachments_before_insert before insert on public.task_attachments
  for each row execute function private.attachments_before_insert();
create trigger task_attachments_audit after insert or delete on public.task_attachments
  for each row execute function private.attachments_audit();

-- ---------------------------------------------------------------------------
-- Members, departments, invitations, settings, projects, profiles
-- ---------------------------------------------------------------------------
create or replace function private.members_before_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  new.workspace_id := old.workspace_id;
  new.user_id := old.user_id;
  new.joined_at := old.joined_at;

  if v_uid is not null and old.user_id = v_uid
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'You cannot change your own role or deactivate your own account' using errcode = '42501';
  end if;

  if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active)
     and not exists (
       select 1 from public.workspace_members
       where workspace_id = old.workspace_id and role = 'admin' and is_active and user_id <> old.user_id
     ) then
    raise exception 'The workspace must keep at least one active admin' using errcode = '42501';
  end if;

  if new.is_active and not old.is_active then
    new.deactivated_at := null;
    new.deactivated_by := null;
  elsif not new.is_active and old.is_active then
    new.deactivated_at := now();
    new.deactivated_by := v_uid;
  else
    new.deactivated_at := old.deactivated_at;
    new.deactivated_by := old.deactivated_by;
  end if;
  return new;
end;
$$;

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
  if new.is_active is distinct from old.is_active then
    perform private.log_event(new.workspace_id, null, null, v_actor,
      case when new.is_active then 'member_reactivated' else 'member_deactivated' end, null, null, v_meta);
  end if;
  return null;
end;
$$;

create trigger workspace_members_before_update before update on public.workspace_members
  for each row execute function private.members_before_update();
create trigger workspace_members_audit after insert or update on public.workspace_members
  for each row execute function private.members_audit();

create or replace function private.departments_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row record;
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  if tg_when = 'BEFORE' then
    return new;
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;
  if not exists (select 1 from public.workspaces where id = v_row.workspace_id) then
    return null;
  end if;
  perform private.log_event(v_row.workspace_id, null, null, auth.uid(),
    case tg_op when 'INSERT' then 'department_created' when 'UPDATE' then 'department_updated' else 'department_deleted' end,
    case when tg_op = 'INSERT' then null else jsonb_build_object('name', old.name, 'manager_id', old.manager_id) end,
    case when tg_op = 'DELETE' then null else jsonb_build_object('name', new.name, 'manager_id', new.manager_id) end,
    jsonb_build_object('department_id', v_row.id));
  return null;
end;
$$;

create trigger departments_before_update before update on public.departments
  for each row execute function private.departments_audit();
create trigger departments_audit after insert or update or delete on public.departments
  for each row execute function private.departments_audit();

create or replace function private.invitations_trigger()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_when = 'BEFORE' then
    if tg_op = 'INSERT' then
      new.invited_by := coalesce(auth.uid(), new.invited_by);
      new.email := lower(btrim(new.email));
      new.created_at := now();
      new.accepted_at := null;
      new.accepted_user_id := null;
    else
      new.workspace_id := old.workspace_id;
      new.email := old.email;
      if old.status <> 'pending' and new.status is distinct from old.status then
        raise exception 'Only pending invitations can be changed' using errcode = '42501';
      end if;
      if new.status = 'accepted' and old.status <> 'accepted' then
        new.accepted_at := now();
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform private.log_event(new.workspace_id, null, null, auth.uid(), 'invitation_sent', null,
      jsonb_build_object('email', new.email, 'role', new.role), jsonb_build_object('invitation_id', new.id));
  elsif new.status = 'revoked' and old.status <> 'revoked' then
    perform private.log_event(new.workspace_id, null, null, auth.uid(), 'invitation_revoked', null, null,
      jsonb_build_object('invitation_id', new.id, 'email', new.email));
  end if;
  return null;
end;
$$;

create trigger invitations_before before insert or update on public.invitations
  for each row execute function private.invitations_trigger();
create trigger invitations_after after insert or update on public.invitations
  for each row execute function private.invitations_trigger();

create or replace function private.settings_trigger()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  k text;
  v_diff_old jsonb := '{}'::jsonb;
  v_diff_new jsonb := '{}'::jsonb;
begin
  if tg_when = 'BEFORE' then
    if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
      raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
    end if;
    new.workspace_id := old.workspace_id;
    new.updated_at := now();
    new.updated_by := auth.uid();
    return new;
  end if;
  v_old := to_jsonb(old) - 'updated_at' - 'updated_by';
  v_new := to_jsonb(new) - 'updated_at' - 'updated_by';
  for k in select jsonb_object_keys(v_new) loop
    if v_new -> k is distinct from v_old -> k then
      v_diff_old := v_diff_old || jsonb_build_object(k, v_old -> k);
      v_diff_new := v_diff_new || jsonb_build_object(k, v_new -> k);
    end if;
  end loop;
  if v_diff_new <> '{}'::jsonb then
    perform private.log_event(new.workspace_id, null, null, auth.uid(), 'settings_updated', v_diff_old, v_diff_new);
  end if;
  return null;
end;
$$;

create trigger workspace_settings_before before update on public.workspace_settings
  for each row execute function private.settings_trigger();
create trigger workspace_settings_after after update on public.workspace_settings
  for each row execute function private.settings_trigger();

create or replace function private.projects_trigger()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_fields text[] := '{}';
begin
  if tg_when = 'BEFORE' then
    if tg_op = 'INSERT' then
      new.created_by := coalesce(v_uid, new.created_by);
      new.owner_id := coalesce(new.owner_id, new.created_by);
      new.created_at := now();
      new.updated_at := now();
      new.archived_at := null;
    else
      new.id := old.id;
      new.workspace_id := old.workspace_id;
      new.created_by := old.created_by;
      new.created_at := old.created_at;
      new.updated_at := now();
      if new.archived_at is not null and old.archived_at is null then
        new.archived_at := now();
      elsif new.archived_at is not null then
        new.archived_at := old.archived_at;
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform private.log_event(new.workspace_id, null, new.id, v_uid, 'project_created', null,
      jsonb_build_object('name', new.name, 'is_private', new.is_private));
  else
    if new.name is distinct from old.name then v_fields := array_append(v_fields, 'name'); end if;
    if new.description is distinct from old.description then v_fields := array_append(v_fields, 'description'); end if;
    if new.owner_id is distinct from old.owner_id then v_fields := array_append(v_fields, 'owner'); end if;
    if new.status is distinct from old.status then v_fields := array_append(v_fields, 'status'); end if;
    if row(new.start_date, new.target_date) is distinct from row(old.start_date, old.target_date) then
      v_fields := array_append(v_fields, 'dates');
    end if;
    if new.is_private is distinct from old.is_private then v_fields := array_append(v_fields, 'visibility'); end if;
    if (new.archived_at is null) <> (old.archived_at is null) then v_fields := array_append(v_fields, 'archived'); end if;
    if cardinality(v_fields) > 0 then
      perform private.log_event(new.workspace_id, null, new.id, v_uid, 'project_updated',
        jsonb_build_object('name', old.name, 'status', old.status, 'is_private', old.is_private),
        jsonb_build_object('name', new.name, 'status', new.status, 'is_private', new.is_private),
        jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
  end if;
  return null;
end;
$$;

create trigger projects_before before insert or update on public.projects
  for each row execute function private.projects_trigger();
create trigger projects_after after insert or update on public.projects
  for each row execute function private.projects_trigger();

create or replace function private.project_members_trigger()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row record;
begin
  if tg_when = 'BEFORE' then
    new.added_by := coalesce(auth.uid(), new.added_by);
    new.added_at := now();
    return new;
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;
  if not exists (select 1 from public.projects where id = v_row.project_id) then
    return null;
  end if;
  perform private.log_event(v_row.workspace_id, null, v_row.project_id, auth.uid(),
    case when tg_op = 'INSERT' then 'project_member_added' else 'project_member_removed' end, null, null,
    jsonb_build_object('user_id', v_row.user_id, 'name', private.profile_name(v_row.user_id), 'role', v_row.role));
  return null;
end;
$$;

create trigger project_members_before before insert on public.project_members
  for each row execute function private.project_members_trigger();
create trigger project_members_after after insert or delete on public.project_members
  for each row execute function private.project_members_trigger();

create or replace function private.labels_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.name := btrim(new.name);
  new.created_at := now();
  return new;
end;
$$;
create trigger labels_before_insert before insert on public.labels
  for each row execute function private.labels_before_insert();

create or replace function private.profiles_before_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.full_name := btrim(new.full_name);
  new.updated_at := now();
  return new;
end;
$$;
create trigger profiles_before_update before update on public.profiles
  for each row execute function private.profiles_before_update();

-- ---------------------------------------------------------------------------
-- auth.users → profiles + membership from a pending invitation
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  inv record;
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  for inv in
    select * from public.invitations
    where email = lower(new.email) and status = 'pending' and expires_at > now()
    order by created_at desc
    limit 1
  loop
    insert into public.workspace_members (workspace_id, user_id, role, department_id)
    values (inv.workspace_id, new.id, inv.role, inv.department_id)
    on conflict (workspace_id, user_id) do nothing;

    update public.invitations set accepted_user_id = new.id where id = inv.id;

    update public.profiles set full_name = inv.full_name
    where id = new.id and full_name = '' and inv.full_name <> '';
  end loop;
  return new;
end;
$$;

create or replace function private.handle_user_email_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function private.handle_user_email_change();
