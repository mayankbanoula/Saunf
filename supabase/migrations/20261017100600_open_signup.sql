-- Make sign-up work like a normal app:
--   * Self sign-up is ON by default (open to any email address, no approval).
--     Admins can still restrict domains or require approval in Workspace settings.
--   * The first person to sign up on a fresh installation creates the workspace and
--     becomes its admin, so no manual SQL is needed to get started.

alter table public.workspace_settings alter column self_signup_enabled set default true;
update public.workspace_settings set self_signup_enabled = true where not self_signup_enabled;

create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  inv record;
  v_email text := lower(new.email);
  v_domain text := split_part(lower(new.email), '@', 2);
  v_ws uuid;
  v_needs_approval boolean;
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, v_email, left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120))
  on conflict (id) do nothing;

  -- 1) A pending invitation decides the workspace, role and department.
  select * into inv
  from public.invitations
  where email = v_email and status = 'pending' and expires_at > now()
  order by created_at desc
  limit 1;

  if found then
    insert into public.workspace_members (workspace_id, user_id, role, department_id)
    values (inv.workspace_id, new.id, inv.role, inv.department_id)
    on conflict (workspace_id, user_id) do nothing;

    update public.invitations set accepted_user_id = new.id where id = inv.id;

    update public.profiles set full_name = inv.full_name
    where id = new.id and full_name = '' and inv.full_name <> '';
    return new;
  end if;

  -- 2) Fresh installation: the first person creates the workspace and becomes its admin.
  if not exists (select 1 from public.workspaces) then
    insert into public.workspaces (name, slug, task_prefix)
    values ('My Company', 'workspace', 'SAU')
    on conflict (slug) do nothing
    returning id into v_ws;

    if v_ws is not null then
      insert into public.workspace_settings (workspace_id) values (v_ws);
      insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, new.id, 'admin');
      return new;
    end if;
    -- Someone else created it at the same moment: fall through and join as an employee.
  end if;

  -- 3) Self sign-up: the oldest workspace open to this email's domain, as an employee.
  select s.workspace_id, s.signup_requires_approval
    into v_ws, v_needs_approval
  from public.workspace_settings s
  join public.workspaces w on w.id = s.workspace_id
  where s.self_signup_enabled
    and (cardinality(s.signup_allowed_domains) = 0 or v_domain = any (s.signup_allowed_domains))
  order by w.created_at
  limit 1;

  if v_ws is null then
    raise exception 'Sign-up is not open for this email address' using errcode = '42501';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, is_active)
  values (v_ws, new.id, 'employee', not v_needs_approval);
  return new;
end;
$$;
