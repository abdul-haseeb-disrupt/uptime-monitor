function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  req.flash('error', 'Please login to continue');
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && res.locals.user && res.locals.user.role === 'admin') {
    return next();
  }
  req.flash('error', 'Admin access required');
  res.redirect('/dashboard');
}

function guestOnly(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  next();
}

// Load user data into res.locals for views
async function loadUser(req, res, next) {
  res.locals.user = null;
  res.locals.isAdmin = false;
  if (req.session && req.session.userId) {
    const db = require('../config/database');
    try {
      const { rows } = await db.query('SELECT id, email, name, role, slack_webhook_url, timezone FROM users WHERE id = $1', [req.session.userId]);
      if (rows[0]) {
        res.locals.user = rows[0];
        res.locals.isAdmin = rows[0].role === 'admin';
      }
    } catch (err) {
      console.error('Error loading user:', err);
    }
  }
  next();
}

module.exports = { requireAuth, requireAdmin, guestOnly, loadUser };
