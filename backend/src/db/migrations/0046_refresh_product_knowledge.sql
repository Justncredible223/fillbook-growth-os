-- Refresh the verified product knowledge from docs/distribution/PRODUCT_FACTS.md in the fillbook repo (verified
-- 2026-09-25 against the working code and live site).
--
--   pricing   The live entry (2026-09-21) says breach alerts and NinjaTrader sync need a paid plan even during the
--             trial. Not so: the trial is Core-level access plus one supported auto-sync connection.
--   scale     The live entry quotes 2026-08-31 user and trade counts. Counts are no longer quoted anywhere.
--   how_rule_tracking_works   New. Nothing described how tracking works, so the writer invented timing claims.
--
-- Old entries are marked 'deprecated' and point at their replacement (superseded_by); nothing is deleted. The
-- knowledge loader only reads trust_level = 'verified', so each swap happens in one statement.

with old_pricing as (
  select id from knowledge_documents where topic = 'pricing' and trust_level = 'verified' and superseded_by is null
), new_pricing as (
  insert into knowledge_documents (topic, title, content, source_doc, trust_level, effective_at)
  select 'pricing', 'Fillbook pricing plans (verified 2026-09-25)',
    $$Every new account gets a 14-day free trial, no card required, with Core-level access plus one supported auto-sync connection. AI features (the AI coach and chat, the weekly AI email review), the Discord recap and Trade Replay are not part of the trial. There is no free plan: if the trial ends without a subscription, the account becomes read-only (data can still be viewed and exported, but no new trades can be added). Plans are month to month and can be cancelled anytime. Starter, $12.99/month: manual entry and CSV import, unlimited trades, dashboard, calendar, equity curve, R-multiple tracking, daily notes, 1 trading account. Core, $24.99/month: everything in Starter, plus up to 5 accounts, prop-firm rule tracking (daily loss limit, trailing and static drawdown, consistency, profit target) with breach alerts, broker auto-sync, behavioral flags, playbooks, Account Health, Daily Brief and payout tracking. Elite, $39.99/month: everything in Core, plus the AI coach and chat, the weekly AI email review, Behavior Replay and up to 50 accounts. The old free plan and the $14.99 Pro plan are retired. Do not mention annual billing or annual discounts.$$,
    'fillbook:docs/distribution/PRODUCT_FACTS.md (section 3, verified 2026-09-25)', 'verified', now()
  where exists (select 1 from old_pricing)
  returning id
)
update knowledge_documents k
   set trust_level = 'deprecated', superseded_by = (select id from new_pricing)
  from old_pricing
 where k.id = old_pricing.id;

with old_scale as (
  select id from knowledge_documents where topic = 'scale' and trust_level = 'verified' and superseded_by is null
), new_scale as (
  insert into knowledge_documents (topic, title, content, source_doc, trust_level, effective_at)
  select 'scale', 'Fillbook scale: do not quote numbers (verified 2026-09-25)',
    $$Do not quote user counts, trade counts, revenue, growth or activity figures for Fillbook in any content. It is an early-stage product: never imply a larger user base than exists. No reviews, ratings or testimonials exist to cite. Any content that states or implies a number of users or trades is unsupported.$$,
    'fillbook:docs/distribution/PRODUCT_FACTS.md (section 8, verified 2026-09-25)', 'verified', now()
  where exists (select 1 from old_scale)
  returning id
)
update knowledge_documents k
   set trust_level = 'deprecated', superseded_by = (select id from new_scale)
  from old_scale
 where k.id = old_scale.id;

insert into knowledge_documents (topic, title, content, source_doc, trust_level, effective_at)
select 'how_rule_tracking_works', 'How Fillbook tracks prop-firm rules (verified 2026-09-25)',
  $$Fillbook does NOT track rules in real time. It computes drawdown, daily-loss, consistency and profit-target buffers from the trades a trader has imported or synced, using closed trades only. It cannot see open positions or intraday unrealized peaks, so intraday-trailing accounts show an approximate warning. How trades arrive: Tradovate syncs on a schedule plus a manual "Sync now" (its fill list can omit very recent fills, so a scheduled sync does not guarantee every fill is caught). NinjaTrader 8 sends each fill through an add-on as fills happen, but only while NinjaTrader is running, and it does not backfill history (use a CSV import once). Beta connectors: Interactive Brokers (Flex), ProjectX/TopstepX, PropReports and Sierra Chart. Every other platform uses CSV import. Alerts warn when a buffer is getting close; they do not block orders, do not enforce limits at the broker, and cannot protect an account. Correct wording: "tracks your rule buffers from your synced trades and warns you when you're getting close." Never claim real-time or live tracking, live alerts, protection, prevention of account failure, tracking of every rule, support for any broker, warnings before a breach, or a guarantee of passing an evaluation or getting paid.$$,
  'fillbook:docs/distribution/PRODUCT_FACTS.md (sections 4 and 6, verified 2026-09-25)', 'verified', now()
where not exists (select 1 from knowledge_documents where topic = 'how_rule_tracking_works' and trust_level = 'verified');
