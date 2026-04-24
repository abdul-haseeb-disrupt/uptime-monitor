-- PageSpeed scores table
CREATE TABLE IF NOT EXISTS pagespeed_checks (
    id              BIGSERIAL PRIMARY KEY,
    monitor_id      INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    performance     INTEGER,
    accessibility   INTEGER,
    best_practices  INTEGER,
    seo             INTEGER,
    lcp             NUMERIC,
    cls             NUMERIC,
    fcp             INTEGER,
    ttfb            INTEGER,
    speed_index     INTEGER,
    checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pagespeed_monitor_time ON pagespeed_checks(monitor_id, checked_at DESC);
