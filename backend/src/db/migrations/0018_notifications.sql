-- Notification System (master spec) -- real, meaningful events only, per
-- backend/src/notifications/notificationEngine.ts's own "avoid spam"
-- discipline. In-app feed for now, not OS-level push: that needs Firebase
-- Cloud Messaging (a new external service the owner would need to set
-- up -- a Firebase project + service account key), not attempted without
-- that owner action. See docs/PROGRESS_LEDGER.md.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  title text not null,
  body text not null,
  severity text not null check (severity in ('info', 'warning', 'urgent')),
  related_id text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_created_at_idx on notifications (created_at desc);
create index notifications_unread_idx on notifications (read_at) where read_at is null;
alter table notifications enable row level security;
