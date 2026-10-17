-- Employee self sign-up, controlled per workspace by admins.
--
-- * self_signup_enabled       — off by default; admins turn it on in Workspace settings.
-- * signup_allowed_domains    — e.g. {acme.com}; empty means any email address may join.
-- * signup_requires_approval  — new sign-ups start inactive until an admin activates them.
--
-- Self sign-ups always join as 'employee'. Invitations still take precedence (they carry
-- the role and department the admin chose). Auth users that match neither an invitation
-- nor an open workspace are rejected, so no orphan accounts can be created.

alter table public.workspace_settings
  add column self_signup_enabled boolean not null default false,
  add column signup_allowed_domains text[] not null default '{}',
  add column signup_requires_approval boolean not null default false;

grant update (self_signup_enabled, signup_allowed_domains, signup_requires_approval)
  on public.workspace_settings to authenticated;

-- Normalise and validate the domain list ("@Acme.com " → "acme.com").
create or replace function private.settings_normalise_domains()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  d text;
begin
  select coalesce(array_agg(distinct x order by x), '{}')
    into new.signup_allowed_domains
  from (
    select lower(btrim(ltrim(btrim(v), '@'))) as x
    from unnest(coalesce(new.signup_allowed_domains, '{}')) as v
  ) s
  where x <> '';
  foreach d in array new.signup_allowed_domains loop
    if d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
      raise exception 'Invalid email domain: %', d using errcode = '22023';
    end if;
  end loop;
  if cardinality(new.signup_allowed_domains) > 50 then
    raise exception 'Too many sign-up domains (max 50)' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger workspace_settings_domains before insert or update on public.workspace_settings
  for each row execute function private.settings_normalise_domains();

-- New auth user → profile + membership (from an invitation, or by self sign-up).
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

  -- Self sign-up: the oldest workspace that is open to this email's domain.
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

revoke execute on function private.settings_normalise_domains() from public, anon, authenticated;
