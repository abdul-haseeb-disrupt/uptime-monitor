-- Status pages
CREATE TABLE IF NOT EXISTS status_pages (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug            VARCHAR(100) UNIQUE NOT NULL,
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    logo_url        TEXT,
    is_public       BOOLEAN DEFAULT true,
    password_hash   VARCHAR(255),
    show_uptime     BOOLEAN DEFAULT true,
    show_response_time BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_status_pages_slug ON status_pages(slug);

-- Status page monitors (which monitors appear on which status page)
CREATE TABLE IF NOT EXISTS status_page_monitors (
    id              SERIAL PRIMARY KEY,
    status_page_id  INTEGER NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
    monitor_id      INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    sort_order      INTEGER DEFAULT 0,
    display_name    VARCHAR(255),
    UNIQUE(status_page_id, monitor_id)
);
