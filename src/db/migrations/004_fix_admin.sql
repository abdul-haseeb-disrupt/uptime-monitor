-- Make ALL existing users admin (initial setup fix)
-- After this, admins can manage roles from the admin panel
UPDATE users SET role = 'admin' WHERE role = 'user';
