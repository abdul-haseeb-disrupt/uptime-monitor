-- Add strategy column and delete old 0-score data
ALTER TABLE pagespeed_checks ADD COLUMN IF NOT EXISTS strategy VARCHAR(10) NOT NULL DEFAULT 'mobile';

-- Delete old bad data (scores of 0)
DELETE FROM pagespeed_checks WHERE accessibility = 0 AND best_practices = 0 AND seo = 0;
