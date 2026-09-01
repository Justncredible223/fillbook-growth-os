-- Phase 3: Knowledge Brain seed data -- real FillbookHQ product facts,
-- so content generation can never invent functionality. See
-- docs/SEED_DATA_SOURCES.md for citations. All effective_at 2026-08-31 --
-- re-verify time-sensitive facts (pricing, scale) before treating as
-- current in later sessions.

insert into knowledge_documents (topic, title, content, source_doc, trust_level, effective_at) values
  ('product_overview', 'What Fillbook is',
   'Fillbook is a trading journal built specifically for futures day traders and prop-firm funded accounts. It supports broker/platform import, futures-native P&L math, prop-firm drawdown/rule tracking, and an AI coach. It is positioned against TradeZella/TradesViz, which are broker-agnostic/stock-first. It is a broad futures product, not MNQ/NQ-only.',
   'fillbookhq:README.md', 'verified', '2026-08-31T00:00:00Z'),
  ('pricing', 'Fillbook pricing plans',
   'Free plan: 50 trades, 1 account. Pro: $14.99/month. Elite: $24.99/month. 7-day trial via Stripe Checkout (card collected upfront).',
   'fillbookhq:README.md', 'verified', '2026-08-31T00:00:00Z'),
  ('tech_stack', 'Fillbook technical architecture',
   'React + TypeScript + Tailwind frontend. Vercel serverless functions proxy Claude API calls for the AI coach. Supabase (Postgres + Auth + Storage) for the database, with row-level security per trader. A deprecated standalone Express backend exists but is unused in normal deployment. Hosted on Vercel Hobby plan (has hit the 12-serverless-function cap once; functions were consolidated).',
   'fillbookhq:README.md', 'verified', '2026-08-31T00:00:00Z'),
  ('scale', 'Fillbook real usage as of 2026-08-31',
   '8 total Supabase users; only 3 are real external signups; only 1 has ever paid (Elite/Subscribed). 828 trades logged, 967 analytics events since 2026-08-25. This is an early-stage product -- content and claims must not imply a larger user base than this.',
   'fillbookhq:docs/CLAUDE_HANDOFF.md', 'verified', '2026-08-31T00:00:00Z'),
  ('positioning', 'What Fillbook is not',
   'Fillbook is not primarily a copy-trading product, though it offers functionality useful to multi-account/copy traders. It must never be repositioned as a copy-trading product. It must never be shown or described as if it personally trades -- no fake personal trading story, ever.',
   'master_prompt + fillbookhq:docs/social/MASTER_SOCIAL_STRATEGY.md', 'verified', '2026-08-31T00:00:00Z'),
  ('social_accounts', 'Fillbook official social accounts',
   'X: @FillbookHQ (x.com/FillbookHQ). YouTube: @FillbookHQ. TikTok: @fillbookhq. Contact email: Developer@fillbookHQ.com (Zoho Mail, not Gmail/Thunderbird).',
   'fillbookhq:docs/CLAUDE_HANDOFF.md', 'verified', '2026-08-31T00:00:00Z'),
  ('known_issues', 'Known open product issues as of 2026-08-31',
   'UTM attribution gap: FillbookHQ''s own dashboard shows zero attributed TikTok/X visitors despite real traffic; suspected cause is social in-app browsers stripping UTM params, unconfirmed. Dashboard SIGNUPS/ACTIVATED counts include internal/test accounts (unfixed P2) -- raw signup_completed event count is closer to the truth. No formal user_activated event exists yet (proposed definition: 5-trade Edge Score threshold, not implemented).',
   'fillbookhq:docs/CLAUDE_HANDOFF.md', 'needs_review', '2026-08-31T00:00:00Z');
