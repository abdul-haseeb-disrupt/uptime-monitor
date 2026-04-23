const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    // Get all websites with their monitors
    const { rows: websites } = await db.query(
      `SELECT w.*,
        COUNT(m.id) as monitor_count,
        COUNT(CASE WHEN m.status = 'up' THEN 1 END) as up_count,
        COUNT(CASE WHEN m.status = 'down' THEN 1 END) as down_count,
        COUNT(CASE WHEN m.status = 'paused' THEN 1 END) as paused_count
       FROM websites w
       LEFT JOIN monitors m ON m.website_id = w.id
       WHERE w.user_id = $1
       GROUP BY w.id
       ORDER BY w.created_at DESC`,
      [req.session.userId]
    );

    // Get monitors for each website
    const { rows: monitors } = await db.query(
      `SELECT m.* FROM monitors m
       JOIN websites w ON w.id = m.website_id
       WHERE w.user_id = $1
       ORDER BY m.created_at DESC`,
      [req.session.userId]
    );

    // Group monitors by website
    const websiteMonitors = {};
    monitors.forEach(m => {
      if (!websiteMonitors[m.website_id]) websiteMonitors[m.website_id] = [];
      websiteMonitors[m.website_id].push(m);
    });

    // Summary stats
    const totalMonitors = monitors.length;
    const upCount = monitors.filter(m => m.status === 'up').length;
    const downCount = monitors.filter(m => m.status === 'down').length;
    const pausedCount = monitors.filter(m => m.status === 'paused').length;

    res.render('dashboard/index', {
      title: 'Dashboard',
      websites,
      websiteMonitors,
      stats: { total: totalMonitors, up: upCount, down: downCount, paused: pausedCount }
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    req.flash('error', 'Failed to load dashboard');
    res.render('dashboard/index', {
      title: 'Dashboard',
      websites: [],
      websiteMonitors: {},
      stats: { total: 0, up: 0, down: 0, paused: 0 }
    });
  }
});

module.exports = router;
