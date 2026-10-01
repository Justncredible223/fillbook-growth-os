-- How a trader sets up prop-firm rules in Fillbook, as a verified knowledge entry.
--
-- The "how to set up drawdown and daily-loss tracking" post type asks for step-by-step instructions, but until now
-- no verified knowledge said where or how rules are set up. The writer filled the gap with an invented path
-- ("on the Accounts page, click your account, scroll to Rules, toggle on Trailing Drawdown...") and a post went
-- out with it on 2026-09-30. It has been deleted.
--
-- Source: the product's own Prop firm rules page (frontend/src/pages/Rules.tsx and the rules.* strings in
-- frontend/src/locales/en/common.json in the fillbook repo), verified 2026-09-30. Additive and idempotent:
-- nothing is updated or deleted.

insert into knowledge_documents (topic, title, content, source_doc, trust_level, effective_at)
select 'how_to_set_up_rules', 'How a trader sets up prop-firm rules in Fillbook (verified 2026-09-30)',
  $$Rules are set up on the "Prop firm rules" page. The steps are: (1) open the Prop firm rules page; (2) click "Add account"; (3) pick your firm and account size (25K, 50K, 100K or 150K, depending on what that firm offers) to quick-fill the numbers, or choose "Custom" and type in your own account size, daily loss limit, drawdown and profit target from your firm's rules; (4) choose trailing or static drawdown for that account (trailing means the floor rises with peak equity, static means the floor stays at account size minus the drawdown), and for trailing, whether it moves at end of day or intraday. After that, Fillbook computes the buffers from the trades the trader has imported or synced; nothing more has to be entered by hand. Prop-firm rule tracking is part of the Core and Elite plans, and the 14-day free trial includes it. Do not describe any other page, button, toggle or step. In particular there is no step where you click an account and scroll to a "Rules" section, and no toggle named "Trailing Drawdown" or "Daily Loss Limit". Never describe the tracking as real time: see the entry on how rule tracking works.$$,
  'fillbook:frontend/src/pages/Rules.tsx + frontend/src/locales/en/common.json rules.* (verified 2026-09-30)', 'verified', now()
where not exists (select 1 from knowledge_documents where topic = 'how_to_set_up_rules' and trust_level = 'verified');
