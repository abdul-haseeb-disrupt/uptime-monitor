const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { hashPassword, comparePassword } = require('../utils/crypto');

router.use(requireAuth);

router.get('/', async (req, res) => {
  res.render('settings/index', { title: 'Settings' });
});

router.post('/', async (req, res) => {
  try {
    const { name, slack_webhook_url, timezone } = req.body;
    await db.query(
      'UPDATE users SET name = $1, slack_webhook_url = $2, timezone = $3, updated_at = NOW() WHERE id = $4',
      [name.trim(), (slack_webhook_url || '').trim() || null, timezone || 'UTC', req.session.userId]
    );
    req.flash('success', 'Settings updated');
    res.redirect('/settings');
  } catch (err) {
    console.error('Settings update error:', err);
    req.flash('error', 'Failed to update settings');
    res.redirect('/settings');
  }
});

router.post('/password', async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;

    if (new_password.length < 6) {
      req.flash('error', 'New password must be at least 6 characters');
      return res.redirect('/settings');
    }
    if (new_password !== confirm_password) {
      req.flash('error', 'New passwords do not match');
      return res.redirect('/settings');
    }

    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.session.userId]);
    if (!(await comparePassword(current_password, rows[0].password_hash))) {
      req.flash('error', 'Current password is incorrect');
      return res.redirect('/settings');
    }

    const password_hash = await hashPassword(new_password);
    await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [password_hash, req.session.userId]);

    req.flash('success', 'Password changed');
    res.redirect('/settings');
  } catch (err) {
    console.error('Password change error:', err);
    req.flash('error', 'Failed to change password');
    res.redirect('/settings');
  }
});

// Test Slack webhook
router.post('/test-slack', async (req, res) => {
  try {
    const alertService = require('../services/alertService');
    const { rows } = await db.query('SELECT slack_webhook_url FROM users WHERE id = $1', [req.session.userId]);

    if (!rows[0]?.slack_webhook_url) {
      req.flash('error', 'Please save a Slack webhook URL first');
      return res.redirect('/settings');
    }

    await alertService.sendTestAlert(rows[0].slack_webhook_url);
    req.flash('success', 'Test alert sent to Slack!');
    res.redirect('/settings');
  } catch (err) {
    console.error('Test slack error:', err);
    req.flash('error', 'Failed to send test alert. Check your webhook URL.');
    res.redirect('/settings');
  }
});

module.exports = router;
