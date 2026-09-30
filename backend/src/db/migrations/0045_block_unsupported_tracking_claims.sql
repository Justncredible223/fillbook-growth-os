-- Fillbook does not track rules in real time. It computes drawdown, daily-loss and consistency buffers from the trades
-- a user has imported or synced (closed trades only); Tradovate syncs on a schedule plus a manual "Sync now",
-- NinjaTrader sends fills through an add-on while it is running, and alerts warn but never block an order.
-- On 2026-09-29 three live @FillbookHQ posts saying otherwise had to be deleted. brand_rules had nothing that
-- forbade those claims, so the writer filled the gap.
--
-- Three claim_prohibited rules. BrandConstitution.checkVocabulary (src/knowledge/brandConstitution.ts) blocks the
-- phrases listed in each rule, and only when the candidate mentions Fillbook (a firm's own real-time rules are fine).
-- The rule text must match BUILT_IN_CLAIM_RULES in that file word for word: a table rule with the same text replaces
-- the built-in copy, and a test checks that this file and the code agree.
--
-- Additive only: existing rules are untouched. Idempotent: a rule that is already present is not inserted twice.

insert into brand_rules (version, rule_type, content, source_doc, is_active)
select v.version, v.rule_type, v.content, v.source_doc, true
from (values
  (2, 'claim_prohibited',
   $$Never say Fillbook tracks rules or drawdown "in real time" or "live" (real time, real-time, realtime, live drawdown, live tracking, live alerts). Fillbook computes buffers from imported or synced closed trades.$$,
   'fillbook:docs/distribution/PRODUCT_FACTS.md'),
  (2, 'claim_prohibited',
   $$Never say Fillbook "tracks every rule", works with "any broker", or alerts "before a breach" / "before you breach". Alerts warn when a buffer is getting close; they do not block orders or protect an account.$$,
   'fillbook:docs/distribution/PRODUCT_FACTS.md'),
  (2, 'claim_prohibited',
   $$Never promise outcomes for Fillbook: no "guarantee" wording and no "never blow an account".$$,
   'fillbook:docs/distribution/PRODUCT_FACTS.md')
) as v(version, rule_type, content, source_doc)
where not exists (select 1 from brand_rules b where b.content = v.content);
