-- Add sitemaps to websites
ALTER TABLE websites ADD COLUMN IF NOT EXISTS sitemaps TEXT[] DEFAULT '{}';
ALTER TABLE websites ADD COLUMN IF NOT EXISTS sitemap_auto_sync BOOLEAN DEFAULT false;
ALTER TABLE websites ADD COLUMN IF NOT EXISTS last_sitemap_sync TIMESTAMPTZ;
