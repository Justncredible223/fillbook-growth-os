-- Security hardening: RLS was left disabled on all tables created in
-- migration 0001, which meant the anon key alone could read/write every
-- table via Supabase's PostgREST API. Enabling RLS with NO policies is
-- intentional default-deny: only the service_role key (server-side only,
-- in Vercel's encrypted env vars, never in the Android app or any client
-- bundle) bypasses RLS. There is no owner-facing multi-user auth model
-- yet (personal-use, single-owner app), so no policies are needed today
-- -- add them if/when a real auth model is introduced.

alter table platform_capabilities enable row level security;
alter table brand_rules enable row level security;
alter table knowledge_documents enable row level security;
alter table signals enable row level security;
alter table opportunities enable row level security;
alter table campaigns enable row level security;
alter table campaign_assets enable row level security;
alter table content_versions enable row level security;
alter table content_scores enable row level security;
alter table content_sources enable row level security;
alter table approvals enable row level security;
alter table audit_logs enable row level security;
alter table system_jobs enable row level security;
alter table dead_letter_jobs enable row level security;
alter table integration_health enable row level security;
