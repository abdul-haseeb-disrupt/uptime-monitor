-- Link auto-created status pages to their project so deleting a project also removes its status page.
ALTER TABLE status_pages ADD COLUMN IF NOT EXISTS website_id INTEGER REFERENCES websites(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_status_pages_website_id ON status_pages(website_id);

-- Backfill: match existing status pages to websites by the same slugify rule used at create-time
-- (lowercase, non-alphanumeric → "-", collapse "-", trim leading/trailing "-").
UPDATE status_pages sp
SET website_id = w.id
FROM websites w
WHERE sp.website_id IS NULL
  AND sp.slug = TRIM(BOTH '-' FROM REGEXP_REPLACE(REGEXP_REPLACE(LOWER(w.name), '[^a-z0-9]+', '-', 'g'), '-+', '-', 'g'));
