-- Closes a real, reproducible bug: Inbound's reply guardrail rejected any
-- link-shaped text unconditionally, even when the person's own message
-- explicitly asked "how do I contact you" -- there was no way to declare a
-- link as intentional (unlike Prospecting's usesLink flag). This column
-- persists the model's own usesLink declaration for an Inbound draft,
-- mirroring prospecting_candidates.reply_used_link.

alter table inbound_engagements add column draft_uses_link boolean;
