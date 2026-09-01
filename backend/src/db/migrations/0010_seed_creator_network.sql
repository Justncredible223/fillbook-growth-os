-- Seed the real creator network from fillbookhq/docs/social/CREATOR_NETWORK.md
-- (captured 2026-09-01), per docs/SEED_DATA_SOURCES.md's instruction to
-- "import verbatim when Phase 14 schema exists, don't re-derive." Follower
-- counts and readiness scores are as of that doc's last update
-- (2026-08-31) -- re-verify before relying on them much later. A few
-- Research Next entries (God of Finance, AbduTrades, retiredby30) have no
-- platform/handle/audience data in the source doc at all; seeded as
-- platform 'other' with everything else null rather than guessed.

-- ---------------------------------------------------------------------
-- Tier B -- vetted, active relationships
-- ---------------------------------------------------------------------
insert into creators (handle, display_name, platform, category, readiness_score, follower_count, creator_product_moment, notes, source_doc) values
  ('@RisenTrade', 'Coach R', 'x', 'tier_b', 1, 981,
   'Trader-longevity / discipline / performance-reflection commentary (quote-tweet style).',
   'Performance Coach / Trading Psychology, works with @PropLeague. No pitching at current stage -- monitor for genuinely relevant fresh content only.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@MSroad2millions', 'Your NQ Edge', 'x', 'tier_b', 2, null,
   null,
   'NQ-focused algo trading account, strong organic reach relative to follower count. Creator Product Moment not yet defined -- revisit after more interaction.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@wannabechamp', 'Dan Cheung', 'x', 'tier_b', 2, 40100,
   'Journaling / journal-review discussions -- directly the product''s core format.',
   'Trading-journal/risk-management educator.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@fxgolfer', 'Ron Mitch', 'x', 'tier_b', 2, 286,
   'Plan-vs-actual review -- a "here''s what actually happened vs. the plan" angle.',
   'Self-described funded trader ($NQ/$ES/$GC), recurring theme of pre-trade planning/discipline. Don''t re-engage again too soon per the interaction-frequency rule.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@Saint4423898285', 'Sushantradesss', 'x', 'tier_b', 2, 4,
   null,
   'Very small/new account at vetting, posted about breaching ~10 eval accounts, self-diagnosed revenge trading. Don''t re-engage too soon; don''t recommend following yet.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@StructureXTime', null, 'x', 'tier_b', 1, null,
   'Day-count / journey-progress content -- a natural fit for a running progress/consistency view.',
   'Small, genuine account, "Documenting the journey -- wins, losses, lessons," new to futures specifically. A separate giveaway-distribution campaign staged an unrelated reply Aug 30 (status STAGED, not confirmed posted) -- that is a different initiative and is NOT counted as a networking-system interaction.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@degen-rehab', 'Degen Rehab', 'youtube', 'tier_b', 2, 10300,
   'Funded-account postmortem / behavioral-mistake breakdown videos -- his whole channel is already built on this format.',
   '10.3K subscribers, trading-psychology channel, genuinely good fit, no obvious affiliate spam. Caution: appears to be developing/promoting their own app/community and has participated in prop-firm giveaways -- understand product overlap before collaboration, not an immediate outreach target.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md');

-- ---------------------------------------------------------------------
-- Research Next -- promising, not fully vetted (or vetted but incomplete)
-- ---------------------------------------------------------------------
insert into creators (handle, display_name, platform, category, readiness_score, follower_count, creator_product_moment, notes, source_doc) values
  ('@gatietrades', 'GatieTrades', 'tiktok', 'research_next', 2, 47800,
   null,
   '659.6K likes, real large creator. Already promotes TradeZella (a direct competitor) in at least one video -- association isn''t purity-tested, but noted going in. Still Research Next for follow/endorsement purposes. Watch: many impersonator/copycat accounts under near-identical handles -- always verify the exact handle.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@ItsJayCook', 'Jay C', 'x', 'research_next', 0, 3692,
   null,
   'Trader, Topstep Performance Coach, Volume Analyst. Newly vetted Aug 31 -- approved as a Tier B candidate, but a drafted Aug 31 reply was not confirmed as posted -- treat as not-yet-interacted.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@AthenTrades', 'Athena Rise', 'x', 'research_next', null, null,
   null,
   '7,752 posts, real identity/story content. A fresh psychology post only drew 386 views, underperforming for the account -- not yet a strong enough opportunity to act on.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@HelloitsRoy', 'Roy An', 'x', 'research_next', null, null,
   null,
   'Bio reads "Economist and AI engineer," Dubai -- more general self-improvement/lifestyle content than a dedicated trader account. Weak topical fit; deprioritize unless stronger trading-specific content surfaces.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@MarketMamas', 'Becky Gaskell (Market Mamas)', 'youtube', 'research_next', 1, 3940,
   'Psychology / nervous-system / behavior-data analysis -- a "what your data shows about your nervous system on bad days" angle fits her existing format.',
   'Real identity, futures-specific, analytical psychology content. No pitching, ever, at current stage -- monitor only for genuinely relevant fresh content with a natural, no-promotion comment.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@propfirmmatch', 'Prop Firm Match', 'youtube', 'research_next', null, 75100,
   null,
   'Daily live futures streams, legitimate-reading description -- but "prop firm match/comparison" business model usually implies referral-commission monetization. Not fully vetted; check its own site/links before trusting.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@Trading-Psychology-Lab', 'Trading Psychology Lab', 'youtube', 'research_next', null, 7590,
   null,
   'Caution: many near-identical copycat channels share this name, one linking a suspicious Telegram bot (t.me/FoxiGrowbot -- avoid entirely). Verify exact handle before any engagement.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('RoadToFunded', 'RoadToFunded', 'tiktok', 'research_next', null, null,
   null,
   'French-language creator openly journaling a prop-firm challenge attempt -- genuine small creator, good persona fit. Could not be re-located by handle search as of Aug 31 -- unresolved, re-find via the original topic search rather than a name search.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('God of Finance', 'God of Finance', 'other', 'research_next', null, null,
   null,
   'Named in Master Social Growth source material as a Research Next candidate. Not yet vetted -- no platform/handle/audience/content data available.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('AbduTrades', 'AbduTrades', 'other', 'research_next', null, null,
   null,
   'Named in Master Social Growth source material as a Research Next candidate. Not yet vetted -- no platform/handle/audience/content data available.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('retiredby30', 'retiredby30', 'other', 'research_next', null, null,
   null,
   'Named in Master Social Growth source material as a Research Next candidate. Not yet vetted -- no platform/handle/audience/content data available.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md');

-- ---------------------------------------------------------------------
-- Rejected -- do not re-suggest without new evidence they've changed
-- ---------------------------------------------------------------------
insert into creators (handle, display_name, platform, category, rejection_reason, source_doc) values
  ('@CDemanincor', 'Cypress Demanincor', 'x', 'rejected',
   'Self-branded "Social Media Influencer," own research/community brand -- signal-selling, not a peer trader.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@CableAnalyst', 'Ola Daniel', 'x', 'rejected',
   'Bio/pinned content is a prop-firm referral hustle (GoatFundedTrader affiliate link).',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@Trader_TitusKE', null, 'x', 'rejected',
   'Links a Telegram channel, clickbait pinned post -- possible signals/community monetization.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@NovaXTrade', 'Nova Trading Community', 'x', 'rejected',
   'Bio is an explicit affiliate/discount-code account. (A specific post of theirs can still be a legitimate one-off reply target without endorsing the account.)',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@peetahlaw__', 'Peetah Law', 'x', 'rejected',
   'AI content farm, posts explicitly tagged "Made with AI."',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@Toruk_Makto8', null, 'x', 'rejected',
   'Not a trading account at all (off-topic content).',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@357TradingCo', null, 'x', 'rejected',
   'Unfocused/noisy account with a cash-app tip-jar link.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@TheWalkingDad69', 'Dadfolio', 'x', 'rejected',
   'Options trader running a paid Discord ($99 signup) -- signal-selling.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@Table_Shaker1', 'TableShaker', 'x', 'rejected',
   'Affiliate/checkout-page link, pushes a referral challenge.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md'),
  ('@Prop-Firm-Trader', 'PropFirmTrader', 'youtube', 'rejected',
   '26.4K subs, but video descriptions stacked with affiliate codes, including one for TradeZella (a direct competitor) -- textbook affiliate/coupon-farming despite large audience.',
   'fillbookhq/docs/social/CREATOR_NETWORK.md');

-- ---------------------------------------------------------------------
-- Confirmed interactions (unconfirmed/drafted-only ones are deliberately
-- NOT inserted here -- e.g. @ItsJayCook's drafted-but-unposted reply).
-- Source doc gives dates without times; occurred_at uses noon UTC on the
-- stated day as a reasonable placeholder, not a precise timestamp.
-- ---------------------------------------------------------------------
insert into creator_interactions (creator_id, interaction_type, occurred_at, summary, confirmed, source_doc)
  select id, 'x_reply', '2026-08-31 12:00:00+00', 'Reply on an active 8.7K-view thread on why profitable traders keep buying new prop accounts.', true, 'fillbookhq/docs/social/CREATOR_NETWORK.md'
  from creators where handle = '@MSroad2millions' and platform = 'x';

insert into creator_interactions (creator_id, interaction_type, occurred_at, summary, confirmed, source_doc)
  select id, 'x_reply', '2026-08-31 12:00:00+00', 'Reply on a thread about "skill vs. magic."', true, 'fillbookhq/docs/social/CREATOR_NETWORK.md'
  from creators where handle = '@wannabechamp' and platform = 'x';

insert into creator_interactions (creator_id, interaction_type, occurred_at, summary, confirmed, source_doc)
  select id, 'x_reply', '2026-08-31 12:00:00+00', 'Genuine reply confirmed live (exact date not recorded in source doc).', true, 'fillbookhq/docs/social/CREATOR_NETWORK.md'
  from creators where handle = '@fxgolfer' and platform = 'x';

insert into creator_interactions (creator_id, interaction_type, occurred_at, summary, confirmed, source_doc)
  select id, 'x_reply', '2026-08-31 12:00:00+00', 'Genuine reply confirmed live (exact date not recorded in source doc).', true, 'fillbookhq/docs/social/CREATOR_NETWORK.md'
  from creators where handle = '@Saint4423898285' and platform = 'x';

insert into creator_interactions (creator_id, interaction_type, occurred_at, summary, confirmed, source_doc)
  select id, 'youtube_comment', '2026-08-31 12:00:00+00', 'Comment on "How The F*CK Do I Keep Breaking My Rules?!" (49 real comments on that video, genuinely good fit).', true, 'fillbookhq/docs/social/CREATOR_NETWORK.md'
  from creators where handle = '@degen-rehab' and platform = 'youtube';

insert into creator_interactions (creator_id, interaction_type, occurred_at, summary, confirmed, source_doc)
  select id, 'tiktok_comment', '2026-08-31 12:00:00+00', 'Comment on the "August is over" post (49K views, 461 comments).', true, 'fillbookhq/docs/social/CREATOR_NETWORK.md'
  from creators where handle = '@gatietrades' and platform = 'tiktok';

update creators c
set last_interaction_at = i.occurred_at
from creator_interactions i
where i.creator_id = c.id;
