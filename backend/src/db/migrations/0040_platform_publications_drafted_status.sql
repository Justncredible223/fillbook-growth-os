-- Widens platform_publications.status to include 'drafted': an automated
-- upload that succeeded but landed as a private/unlisted, not-publicly-
-- reachable object -- the human owner still has to make it public
-- themselves. See docs/EXTERNAL_WRITE_FIREWALL.md: EXTERNAL_DRAFT actions
-- must not silently become indistinguishable from a real publish.
alter table platform_publications drop constraint platform_publications_status_check;
alter table platform_publications add constraint platform_publications_status_check
  check (status in ('pending', 'drafted', 'published', 'failed'));

comment on column platform_publications.status is
  'pending: enqueued. drafted: uploaded successfully but not publicly reachable (e.g. YouTube privacyStatus=private) -- owner must make it public. published: confirmed publicly live. failed: see error.';

-- Widens platform to allow 'tiktok' -- same table, same EXTERNAL_DRAFT
-- posture, for the TikTok Content Posting API "upload to inbox" flow.
alter table platform_publications drop constraint platform_publications_platform_check;
alter table platform_publications add constraint platform_publications_platform_check
  check (platform in ('youtube', 'tiktok'));
