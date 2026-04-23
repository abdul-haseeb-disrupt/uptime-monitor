const express = require('express');
const db = require('../config/database');
const { hashPassword, comparePassword } = require('../utils/crypto');
const { guestOnly } = require('../middleware/auth');

module.exports = function (authLimiter) {
  const router = express.Router();

  router.get('/login', guestOnly, (req, res) => {
    res.render('auth/login', { layout: 'layouts/public', title: 'Login' });
  });

  router.post('/login', authLimiter, guestOnly, async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        req.flash('error', 'Email and password are required');
        return res.redirect('/login');
      }

      const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
      if (!rows[0] || !(await comparePassword(password, rows[0].password_hash))) {
        req.flash('error', 'Invalid email or password');
        return res.redirect('/login');
      }

      req.session.userId = rows[0].id;
      req.session.save(() => res.redirect('/dashboard'));
    } catch (err) {
      console.error('Login error:', err);
      req.flash('error', 'Something went wrong');
      res.redirect('/login');
    }
  });

  router.get('/register', guestOnly, (req, res) => {
    res.render('auth/register', { layout: 'layouts/public', title: 'Register' });
  });

  router.post('/register', authLimiter, guestOnly, async (req, res) => {
    try {
      const { name, email, password, password_confirm } = req.body;

      if (!name || !email || !password) {
        req.flash('error', 'All fields are required');
        return res.redirect('/register');
      }
      if (password.length < 6) {
        req.flash('error', 'Password must be at least 6 characters');
        return res.redirect('/register');
      }
      if (password !== password_confirm) {
        req.flash('error', 'Passwords do not match');
        return res.redirect('/register');
      }

      const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
      if (existing.rows.length > 0) {
        req.flash('error', 'Email already registered');
        return res.redirect('/register');
      }

      const password_hash = await hashPassword(password);

      // First user becomes admin automatically
      const { rows: adminCheck } = await db.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      const role = adminCheck.length === 0 ? 'admin' : 'user';

      await db.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
        [name.trim(), email.toLowerCase().trim(), password_hash, role]
      );

      req.flash('success', role === 'admin' ? 'Admin account created! Please login.' : 'Account created! Please login.');
      res.redirect('/login');
    } catch (err) {
      console.error('Register error:', err);
      req.flash('error', 'Something went wrong');
      res.redirect('/register');
    }
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  // One-time setup: make first user admin if no admin exists
  router.get('/setup-admin', async (req, res) => {
    try {
      const { rows: adminCheck } = await db.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      if (adminCheck.length > 0) {
        req.flash('info', 'Admin already exists');
        return res.redirect('/login');
      }
      await db.query("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)");
      req.flash('success', 'First user promoted to admin!');
      res.redirect('/login');
    } catch (err) {
      console.error('Setup admin error:', err);
      req.flash('error', 'Setup failed');
      res.redirect('/login');
    }
  });

  // Root redirect
  router.get('/', (req, res) => {
    if (req.session && req.session.userId) {
      return res.redirect('/dashboard');
    }
    res.redirect('/login');
  });

  return router;
};
