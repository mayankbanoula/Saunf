-- Notification type for edits to a task the recipient is involved in. Added in
-- its own migration so the new enum value is committed before it is used.
alter type public.notification_type add value if not exists 'task_updated';
