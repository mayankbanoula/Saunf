-- Private attachment bucket, storage RLS, and the pg_cron schedule.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments', 'task-attachments', false, 26214400,
  array[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain', 'text/csv', 'text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path layout: <workspace_id>/<task_id>/<random>-<file name>
create policy "saunf attachments: upload to visible, active tasks" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-attachments'
    and private.storage_path_matches_task(name)
    and private.can_view_task((select auth.uid()), private.storage_path_task_id(name))
    and not private.task_is_archived(private.storage_path_task_id(name))
  );

create policy "saunf attachments: read on visible tasks" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-attachments'
    and private.can_view_task((select auth.uid()), private.storage_path_task_id(name))
  );

create policy "saunf attachments: uploader or task editor deletes" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task-attachments'
    and (
      owner_id = (select auth.uid())::text
      or private.can_edit_task((select auth.uid()), private.storage_path_task_id(name))
    )
  );

-- Scheduler: due-soon / overdue notifications and auto-archive, every 15 minutes.
create extension if not exists pg_cron;

select cron.schedule(
  'saunf-scheduled-jobs',
  '*/15 * * * *',
  $$select private.run_scheduled_jobs()$$
);
