-- Storage for OAuth tokens that rotate at runtime (X's OAuth 2.0 refresh
-- flow issues a new access token -- and sometimes a new refresh token --
-- on every refresh). Env vars are a fine bootstrap source but can't be
-- updated by the running app, so the first real adapter (X) needs
-- somewhere to persist the latest tokens between invocations. One row
-- per platform; personal-use, single-owner app, same reasoning as
-- system_settings.

create table platform_oauth_credentials (
  platform text primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table platform_oauth_credentials enable row level security;
