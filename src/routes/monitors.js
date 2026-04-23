const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { generateToken } = require('../utils/crypto');

router.use(requireAuth);

// New monitor form (under a website)
router.get('/new', async (req, res) => {
  try {
    const websiteId = req.query.website_id;
    if (!websiteId) {
      req.flash('error', 'Please select a website first');
      return res.redirect('/dashboard');
    }

    const { rows } = await db.query(
      'SELECT * FROM websites WHERE id = $1 AND user_id = $2',
      [websiteId, req.session.userId]
    );
    if (!rows[0]) {
      req.flash('error', 'Website not found');
      return res.redirect('/dashboard');
    }

    res.render('monitors/new', { title: 'Add Monitor', website: rows[0] });
  } catch (err) {
    console.error('New monitor error:', err);
    res.redirect('/dashboard');
  }
});

// Create monitor
router.post('/', async (req, res) => {
  try {
    const { website_id, name, type, url, hostname, port, keyword, keyword_type, interval_seconds, timeout_seconds, heartbeat_interval } = req.body;

    // Verify website ownership
    const { rows: websites } = await db.query(
      'SELECT * FROM websites WHERE id = $1 AND user_id = $2',
      [website_id, req.session.userId]
    );
    if (!websites[0]) {
      req.flash('error', 'Website not found');
      return res.redirect('/dashboard');
    }

    const monitorData = {
      website_id: parseInt(website_id),
      name: name.trim(),
      type,
      url: url ? url.trim() : null,
      hostname: hostname ? hostname.trim() : null,
      port: port ? parseInt(port) : null,
      keyword: keyword ? keyword.trim() : null,
      keyword_type: keyword_type || null,
      heartbeat_token: type === 'heartbeat' ? generateToken() : null,
      heartbeat_interval: heartbeat_interval ? parseInt(heartbeat_interval) : null,
      interval_seconds: parseInt(interval_seconds) || 300,
      timeout_seconds: parseInt(timeout_seconds) || 30
    };

    const { rows } = await db.query(
      `INSERT INTO monitors (website_id, name, type, url, hostname, port, keyword, keyword_type, heartbeat_token, heartbeat_interval, interval_seconds, timeout_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [monitorData.website_id, monitorData.name, monitorData.type, monitorData.url, monitorData.hostname,
       monitorData.port, monitorData.keyword, monitorData.keyword_type, monitorData.heartbeat_token,
       monitorData.heartbeat_interval, monitorData.interval_seconds, monitorData.timeout_seconds]
    );

    // Notify scheduler about new monitor
    const scheduler = require('../engine/scheduler');
    scheduler.addMonitor(rows[0].id);

    req.flash('success', 'Monitor created!');
    res.redirect(`/monitors/${rows[0].id}`);
  } catch (err) {
    console.error('Create monitor error:', err);
    req.flash('error', 'Failed to create monitor');
    res.redirect(`/websites/${req.body.website_id}`);
  }
});

// Show monitor detail
router.get('/:id', async (req, res) => {
  try {
    const { rows: monitors } = await db.query(
      `SELECT m.*, w.name as website_name, w.id as website_id
       FROM monitors m
       JOIN websites w ON w.id = m.website_id
       WHERE m.id = $1 AND w.user_id = $2`,
      [req.params.id, req.session.userId]
    );
    if (!monitors[0]) {
      req.flash('error', 'Monitor not found');
      return res.redirect('/dashboard');
    }

    // Recent checks (last 50)
    const { rows: recentChecks } = await db.query(
      'SELECT * FROM checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 50',
      [req.params.id]
    );

    // Open incidents
    const { rows: incidents } = await db.query(
      'SELECT * FROM incidents WHERE monitor_id = $1 ORDER BY started_at DESC LIMIT 20',
      [req.params.id]
    );

    // Uptime stats
    const statsService = require('../services/statsService');
    const stats = await statsService.getMonitorStats(req.params.id);

    // Daily uptime for 90-day bar
    const dailyUptime = await statsService.getDailyUptime(req.params.id, 90);

    const env = require('../config/env');

    res.render('monitors/show', {
      title: monitors[0].name,
      monitor: monitors[0],
      recentChecks,
      incidents,
      stats,
      dailyUptime,
      appUrl: env.APP_URL
    });
  } catch (err) {
    console.error('Show monitor error:', err);
    req.flash('error', 'Failed to load monitor');
    res.redirect('/dashboard');
  }
});

// Edit monitor form
router.get('/:id/edit', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.*, w.name as website_name, w.base_url
       FROM monitors m
       JOIN websites w ON w.id = m.website_id
       WHERE m.id = $1 AND w.user_id = $2`,
      [req.params.id, req.session.userId]
    );
    if (!rows[0]) {
      req.flash('error', 'Monitor not found');
      return res.redirect('/dashboard');
    }
    res.render('monitors/edit', { title: 'Edit Monitor', monitor: rows[0] });
  } catch (err) {
    console.error('Edit monitor error:', err);
    res.redirect('/dashboard');
  }
});

// Update monitor
router.post('/:id', async (req, res) => {
  try {
    const { name, url, hostname, port, keyword, keyword_type, interval_seconds, timeout_seconds, heartbeat_interval } = req.body;

    // Verify ownership
    const { rows: existing } = await db.query(
      `SELECT m.id FROM monitors m JOIN websites w ON w.id = m.website_id WHERE m.id = $1 AND w.user_id = $2`,
      [req.params.id, req.session.userId]
    );
    if (!existing[0]) {
      req.flash('error', 'Monitor not found');
      return res.redirect('/dashboard');
    }

    await db.query(
      `UPDATE monitors SET name = $1, url = $2, hostname = $3, port = $4, keyword = $5, keyword_type = $6,
       interval_seconds = $7, timeout_seconds = $8, heartbeat_interval = $9, updated_at = NOW()
       WHERE id = $10`,
      [name.trim(), url || null, hostname || null, port ? parseInt(port) : null,
       keyword || null, keyword_type || null, parseInt(interval_seconds) || 300,
       parseInt(timeout_seconds) || 30, heartbeat_interval ? parseInt(heartbeat_interval) : null, req.params.id]
    );

    const scheduler = require('../engine/scheduler');
    scheduler.updateMonitor(req.params.id);

    req.flash('success', 'Monitor updated');
    res.redirect(`/monitors/${req.params.id}`);
  } catch (err) {
    console.error('Update monitor error:', err);
    req.flash('error', 'Failed to update');
    res.redirect(`/monitors/${req.params.id}/edit`);
  }
});

// Delete monitor
router.post('/:id/delete', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.website_id FROM monitors m JOIN websites w ON w.id = m.website_id WHERE m.id = $1 AND w.user_id = $2`,
      [req.params.id, req.session.userId]
    );
    if (!rows[0]) {
      req.flash('error', 'Monitor not found');
      return res.redirect('/dashboard');
    }

    const websiteId = rows[0].website_id;

    const scheduler = require('../engine/scheduler');
    scheduler.removeMonitor(parseInt(req.params.id));

    await db.query('DELETE FROM monitors WHERE id = $1', [req.params.id]);

    req.flash('success', 'Monitor deleted');
    res.redirect(`/websites/${websiteId}`);
  } catch (err) {
    console.error('Delete monitor error:', err);
    req.flash('error', 'Failed to delete');
    res.redirect('/dashboard');
  }
});

// Pause/Resume monitor
router.post('/:id/toggle', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.* FROM monitors m JOIN websites w ON w.id = m.website_id WHERE m.id = $1 AND w.user_id = $2`,
      [req.params.id, req.session.userId]
    );
    if (!rows[0]) {
      req.flash('error', 'Monitor not found');
      return res.redirect('/dashboard');
    }

    const newActive = !rows[0].is_active;
    const newStatus = newActive ? 'unknown' : 'paused';

    await db.query(
      'UPDATE monitors SET is_active = $1, status = $2, updated_at = NOW() WHERE id = $3',
      [newActive, newStatus, req.params.id]
    );

    const scheduler = require('../engine/scheduler');
    if (newActive) {
      scheduler.addMonitor(parseInt(req.params.id));
    } else {
      scheduler.removeMonitor(parseInt(req.params.id));
    }

    req.flash('success', newActive ? 'Monitor resumed' : 'Monitor paused');
    res.redirect(`/monitors/${req.params.id}`);
  } catch (err) {
    console.error('Toggle monitor error:', err);
    req.flash('error', 'Failed to toggle');
    res.redirect('/dashboard');
  }
});

module.exports = router;
