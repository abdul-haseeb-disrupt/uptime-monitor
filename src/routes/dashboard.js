const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    // Admin goes to admin dashboard
    if (res.locals.isAdmin) {
      return res.redirect('/admin');
    }

    // Regular user: only see assigned projects
    const { rows: websites } = await db.query(
      `SELECT w.*,
        COUNT(m.id) as monitor_count,
        COUNT(CASE WHEN m.status = 'up' THEN 1 END) as up_count,
        COUNT(CASE WHEN m.status = 'down' THEN 1 END) as down_count,
        COUNT(CASE WHEN m.status = 'paused' THEN 1 END) as paused_count
       FROM websites w
       JOIN user_projects up ON up.website_id = w.id AND up.user_id = $1
       LEFT JOIN monitors m ON m.website_id = w.id
       GROUP BY w.id
       ORDER BY w.name ASC`,
      [req.session.userId]
    );

    // Get monitors for assigned websites
    const websiteIds = websites.map(w => w.id);
    let monitors = [];
    if (websiteIds.length > 0) {
      const { rows } = await db.query(
        `SELECT m.* FROM monitors m
         WHERE m.website_id = ANY($1)
         ORDER BY m.created_at DESC`,
        [websiteIds]
      );
      monitors = rows;
    }

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

    res.render('dashboard/index', {
      title: 'Dashboard',
      websites,
      websiteMonitors,
      stats: { total: totalMonitors, up: upCount, down: downCount, paused: monitors.filter(m => m.status === 'paused').length }
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
