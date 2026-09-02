-- Audit trail for the one write action this app's owner-facing side has
-- always had: approve/reject on the Approvals screen. Before this, two
-- people sharing the app couldn't tell who made a given call -- the app
-- had no user identity at all, only a single shared access token. This
-- doesn't add real per-user accounts (out of scope for a personal-use,
-- single shared-token app), just records the display name the app now
-- asks for once at login, next to the decision it made.
alter table campaigns add column decided_by text;
alter table campaigns add column decided_at timestamptz;
