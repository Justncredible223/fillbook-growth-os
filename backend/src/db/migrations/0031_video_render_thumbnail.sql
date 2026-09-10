-- Adds a real, downloadable thumbnail alongside every rendered video --
-- previously the app only showed the LLM's THUMBNAIL CONCEPT as a text
-- description the owner had to manually recreate; render-single.ts now
-- extracts an actual frame from the finished video (during the Hook
-- caption, so the thumbnail already has bold on-brand text on it) and
-- uploads it next to the video in the same 'rendered-videos' bucket.
alter table video_renders add column thumbnail_path text; -- set only when status='ready', mirrors storage_path
