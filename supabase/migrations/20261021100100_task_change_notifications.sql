-- Tell the people on a task (creator, assignee, collaborators) when someone else
-- changes it. Assignment, completion, reopening and review already send their
-- own notifications, so they are left out here; archiving is not a work change.
create or replace function private.tasks_notify_changes()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_changes text[] := '{}';
  v_data jsonb;
  r record;
begin
  if v_actor is null then
    return null; -- system updates (scheduler, service role) don't notify
  end if;

  if new.status is distinct from old.status
     and new.status <> 'done' and old.status <> 'done' and new.status <> 'in_review' then
    v_changes := array_append(v_changes, 'status');
  end if;
  if new.priority is distinct from old.priority then
    v_changes := array_append(v_changes, 'priority');
  end if;
  if row(new.due_date, new.due_time) is distinct from row(old.due_date, old.due_time) then
    v_changes := array_append(v_changes, 'due date');
  end if;
  if new.start_date is distinct from old.start_date then
    v_changes := array_append(v_changes, 'start date');
  end if;
  if new.progress is distinct from old.progress and (new.status = 'done') = (old.status = 'done') then
    v_changes := array_append(v_changes, 'progress');
  end if;
  if new.is_blocked is distinct from old.is_blocked then
    v_changes := array_append(v_changes, case when new.is_blocked then 'blocked' else 'unblocked' end);
  end if;
  if new.title is distinct from old.title then
    v_changes := array_append(v_changes, 'title');
  end if;
  if new.description is distinct from old.description then
    v_changes := array_append(v_changes, 'description');
  end if;
  if new.project_id is distinct from old.project_id then
    v_changes := array_append(v_changes, 'project');
  end if;
  if new.estimate_hours is distinct from old.estimate_hours then
    v_changes := array_append(v_changes, 'estimate');
  end if;

  if cardinality(v_changes) = 0 then
    return null;
  end if;

  v_data := jsonb_build_object('key', new.key, 'title', new.title, 'changes', to_jsonb(v_changes));
  for r in
    select distinct u from unnest(array[new.creator_id, new.assignee_id]
      || array(select user_id from public.task_collaborators where task_id = new.id)) u
    where u is not null
      -- A newly assigned person already gets "assigned to you"; don't double up.
      and not (new.assignee_id is distinct from old.assignee_id and u = new.assignee_id)
  loop
    perform private.notify(r.u, new.workspace_id, v_actor, 'task_updated', new.id, v_data);
  end loop;
  return null;
end;
$$;

create trigger tasks_notify_changes after update on public.tasks
  for each row execute function private.tasks_notify_changes();
