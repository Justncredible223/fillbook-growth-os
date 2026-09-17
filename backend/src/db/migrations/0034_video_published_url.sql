-- Lets the owner record the real external URL after manually posting a
-- rendered video (TikTok/YouTube/Instagram -- see Video Status's manual
-- Download/Share handoff, docs/EXTERNAL_WRITE_FIREWALL.md). Without this,
-- video_renders only ever tracked the internal render file (storage_path),
-- never where the owner actually published it -- so nothing downstream
-- (e.g. a comment-monitoring job) had a real target to poll.
--
-- Deliberately platform-agnostic (any of the three platforms can be
-- pasted here) rather than a YouTube-specific column: comment monitoring
-- only acts on it when it parses as a YouTube URL (see
-- src/video/youtubeUrl.ts), but the owner marking "this is where I
-- actually posted it" is useful regardless of which platform ever gets a
-- polling integration.
alter table video_renders
  add column if not exists published_url text null;
