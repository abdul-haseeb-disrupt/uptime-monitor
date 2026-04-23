-- Users table
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    name            VARCHAR(100) NOT NULL,
    slack_webhook_url TEXT,
    timezone        VARCHAR(50) DEFAULT 'UTC',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Websites (grouping concept)
CREATE TABLE IF NOT EXISTS websites (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    base_url        TEXT,
    favicon_url     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_websites_user_id ON websites(user_id);

-- Monitors (belong to a website)
CREATE TABLE IF NOT EXISTS monitors (
    id              SERIAL PRIMARY KEY,
    website_id      INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(20) NOT NULL CHECK (type IN ('http', 'ping', 'keyword', 'port', 'heartbeat')),
    url             TEXT,
    hostname        VARCHAR(255),
    port            INTEGER,
    keyword         VARCHAR(255),
    keyword_type    VARCHAR(10) CHECK (keyword_type IN ('exists', 'not_exists')),
    heartbeat_token VARCHAR(64) UNIQUE,
    heartbeat_interval INTEGER,
    interval_seconds INTEGER NOT NULL DEFAULT 300,
    timeout_seconds  INTEGER NOT NULL DEFAULT 30,
    http_method     VARCHAR(10) DEFAULT 'GET',
    expected_status_codes INTEGER[] DEFAULT '{200,201,301,302}',
    status          VARCHAR(10) NOT NULL DEFAULT 'unknown' CHECK (status IN ('up', 'down', 'unknown', 'paused')),
    last_checked_at TIMESTAMPTZ,
    last_status_change TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitors_website_id ON monitors(website_id);
CREATE INDEX IF NOT EXISTS idx_monitors_active ON monitors(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_monitors_heartbeat ON monitors(heartbeat_token) WHERE heartbeat_token IS NOT NULL;

-- Check results
CREATE TABLE IF NOT EXISTS checks (
    id              BIGSERIAL PRIMARY KEY,
    monitor_id      INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    status          VARCHAR(10) NOT NULL CHECK (status IN ('up', 'down')),
    response_time   INTEGER,
    status_code     INTEGER,
    error_message   TEXT,
    checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checks_monitor_time ON checks(monitor_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_checks_checked_at ON checks(checked_at);

-- Incidents
CREATE TABLE IF NOT EXISTS incidents (
    id              SERIAL PRIMARY KEY,
    monitor_id      INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    cause           TEXT,
    alert_sent      BOOLEAN DEFAULT false,
    recovery_alert_sent BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_incidents_monitor_id ON incidents(monitor_id);
CREATE INDEX IF NOT EXISTS idx_incidents_open ON incidents(monitor_id, resolved_at) WHERE resolved_at IS NULL;

-- Sessions (for connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
    sid     VARCHAR NOT NULL COLLATE "default",
    sess    JSON NOT NULL,
    expire  TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);
