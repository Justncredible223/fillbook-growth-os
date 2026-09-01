-- Seed data derived from FillbookHQ's real, existing growth practice.
-- See docs/SEED_DATA_SOURCES.md for full citations. Ready to apply the
-- moment the target Supabase project is confirmed (see PROGRESS_LEDGER.md
-- Phase 1 blocker) — do not treat this as speculative content.

insert into brand_rules (version, rule_type, content, source_doc) values
  (1, 'positioning', 'Broad futures product, not MNQ/NQ-only -- every piece of content is checked against this misreading.', 'fillbookhq:docs/CLAUDE_HANDOFF.md'),
  (1, 'positioning', 'Fillbook is a trading journal / analytics / futures / prop-firm-oriented product, not primarily a copy-trading product, though it offers functionality useful to multi-account/copy traders.', 'master_prompt'),
  (1, 'voice', 'Concise, intelligent, relatable, trader-aware, slightly sharp when appropriate, useful.', 'fillbookhq:docs/social/MASTER_SOCIAL_STRATEGY.md'),
  (1, 'vocabulary_prohibited', 'Corporate SaaS language, excessive em dashes, generic motivation, AI cliches, engagement bait, forced controversy.', 'fillbookhq:docs/social/MASTER_SOCIAL_STRATEGY.md'),
  (1, 'claim_prohibited', 'Fillbook must never speak or be shown as if it personally trades -- no fake personal trading story, ever.', 'fillbookhq:docs/social/MASTER_SOCIAL_STRATEGY.md'),
  (1, 'claim_prohibited', 'Any trading data shown must be labeled example/demo data unless it is real, consenting-user data.', 'fillbookhq:docs/social/MASTER_SOCIAL_STRATEGY.md'),
  (1, 'cta_philosophy', 'Product shown must reveal a mechanism, never a feature list. Product is evidence, not an advertisement.', 'fillbookhq:docs/social/MASTER_SOCIAL_STRATEGY.md'),
  (1, 'competitor_rule', 'A creator having competitive association (e.g. promoting TradeZella) does not automatically disqualify them from outreach -- goal is ecosystem understanding, not purity-testing. Explicit affiliate-code pushing is a hard rejection reason.', 'fillbookhq:docs/social/CREATOR_NETWORK.md'),
  (1, 'disclosure_rule', 'Never assert an account is "shadowbanned" without evidence.', 'fillbookhq:docs/social/MASTER_SOCIAL_STRATEGY.md'),
  (1, 'financial_claim_restriction', 'Every claim is classified VERIFIED FACT / EVIDENCE-SUPPORTED OBSERVATION / REASONABLE HYPOTHESIS / OPINION. Never promote a hypothesis or opinion into a fact.', 'fillbookhq:docs/social/MASTER_SOCIAL_STRATEGY.md');

insert into platform_capabilities
  (platform, capability, read_allowed, automated_processing_allowed, browser_automation_allowed,
   official_api_available, human_publish_required, oauth_scopes, rate_limits,
   developer_review_required, source_url, verified_at, implementation_status, notes)
values
  ('tiktok', 'promote_ads', true, true, false, true, true, '{}', null, true,
   'internal:fillbookhq/docs/CLAUDE_HANDOFF.md', '2026-08-31T00:00:00Z', 'blocked',
   'Account-level "Prohibited Industry - Financial Opportunity" rejection confirmed via two separate test videos, one with all $ amounts/%/trading hashtags stripped. Not fixable by wording. Business verification already on. Re-verify against TikTok''s current official ads policy before Phase 12.'),
  ('tiktok', 'organic_post', true, true, false, true, true, '{}', null, false,
   'internal:fillbookhq/docs/CLAUDE_HANDOFF.md', '2026-08-31T00:00:00Z', 'implemented',
   '7 videos live (~500 combined views) on @fillbookhq, uploaded manually. Growth OS should stage rendered video + caption for owner upload, never auto-upload. Re-verify against TikTok''s current official developer docs before Phase 12 builds any handoff mechanism.'),
  ('tiktok', 'profile_scan_logged_out', true, false, false, false, true, '{}', null, false,
   'internal:fillbookhq/docs/CLAUDE_HANDOFF.md', '2026-08-31T00:00:00Z', 'not_started',
   'Logged-out profile view is unreliable (shows suggested-accounts wall, not real video grid) -- previously caused a false "0 videos" read. Any monitoring must use an authenticated read path.'),
  ('x', 'organic_post', true, true, false, true, true, '{}', null, false,
   'internal:fillbookhq/docs/CLAUDE_HANDOFF.md', '2026-08-31T00:00:00Z', 'implemented',
   '@FillbookHQ, 46 posts. ~1 post/day + 1-2 replies/day is directional cadence, not a quota. Re-verify against X''s current official API docs before Phase 9.'),
  ('youtube', 'shorts_upload', true, true, false, true, true, '{}', null, false,
   'internal:fillbookhq/docs/CLAUDE_HANDOFF.md', '2026-08-31T00:00:00Z', 'implemented',
   '@FillbookHQ, 6 Shorts live. Re-verify against YouTube''s current official API docs before Phase 11.'),
  ('discord', 'join_new_account', true, false, false, false, true, '{}', null, false,
   'internal:fillbookhq/docs/CLAUDE_HANDOFF.md', '2026-08-31T00:00:00Z', 'blocked',
   'A brand-new Fillbook Discord account is silently blocked from joining a target server (hCaptcha clears, join still fails); attributed to anti-spam trust flagging a same-day account. Decision: wait it out, not currently pursued further.')
on conflict (platform, capability) do nothing;
