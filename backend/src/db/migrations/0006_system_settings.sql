-- Pause System (master spec) -- a single-row settings table. Personal-use,
-- single-owner app, so one global row is sufficient; no per-user settings.
create table system_settings (
  id boolean primary key default true check (id = true), -- enforces single row
  paused boolean not null default false,
  paused_reason text,
  updated_at timestamptz not null default now()
);
insert into system_settings (id, paused) values (true, false);
alter table system_settings enable row level security;
