-- Add role to users (admin or user)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user'));

-- Make first user admin
UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users);

-- User-Project assignment table
CREATE TABLE IF NOT EXISTS user_projects (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    website_id  INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, website_id)
);

CREATE INDEX IF NOT EXISTS idx_user_projects_user ON user_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_user_projects_website ON user_projects(website_id);
