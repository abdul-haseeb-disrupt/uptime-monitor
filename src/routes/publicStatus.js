const express = require('express');
const router = express.Router();
const db = require('../config/database');
const statsService = require('../services/statsService');

// Public status page
router.get('/:slug', async (req, res) => {
  try {
    const { rows: pages } = await db.query(
      'SELECT * FROM status_pages WHERE slug = $1 AND is_public = true',
      [req.params.slug]
    );
    if (!pages[0]) {
      return res.status(404).render('error', { layout: 'layouts/public', title: '404', message: 'Status page not found' });
    }

    // Get monitors for this status page
    const { rows: monitors } = await db.query(
      `SELECT m.*, spm.display_name, spm.sort_order, w.name as website_name
       FROM status_page_monitors spm
       JOIN monitors m ON m.id = spm.monitor_id
       JOIN websites w ON w.id = m.website_id
       WHERE spm.status_page_id = $1
       ORDER BY spm.sort_order`,
      [pages[0].id]
    );

    // Get stats, daily uptime for multiple ranges, and pagespeed
    const { getLatestScores } = require('../engine/pagespeed');
    for (const monitor of monitors) {
      monitor.stats = await statsService.getMonitorStats(monitor.id);
      monitor.dailyUptime = {
        '24h': await statsService.getHourlyUptime(monitor.id),
        '7': await statsService.getDailyUptime(monitor.id, 7),
        '30': await statsService.getDailyUptime(monitor.id, 30),
        '90': await statsService.getDailyUptime(monitor.id, 90)
      };
      monitor.pagespeed = await getLatestScores(monitor.id);
    }

    // Recent incidents (last 30 days)
    const monitorIds = monitors.map(m => m.id);
    let incidents = [];
    if (monitorIds.length > 0) {
      const { rows } = await db.query(
        `SELECT i.*, m.name as monitor_name FROM incidents i
         JOIN monitors m ON m.id = i.monitor_id
         WHERE i.monitor_id = ANY($1) AND i.started_at > NOW() - INTERVAL '30 days'
         ORDER BY i.started_at DESC`,
        [monitorIds]
      );
      incidents = rows;
    }

    // Overall status
    const allUp = monitors.every(m => m.status === 'up');
    const anyDown = monitors.some(m => m.status === 'down');
    const overallStatus = anyDown ? 'major_outage' : allUp ? 'operational' : 'partial';

    res.render('public/status-page', {
      layout: 'layouts/public',
      title: pages[0].title,
      statusPage: pages[0],
      monitors,
      incidents,
      overallStatus
    });
  } catch (err) {
    console.error('Public status page error:', err);
    res.status(500).render('error', { layout: 'layouts/public', title: 'Error', message: 'Failed to load status page' });
  }
});

module.exports = router;
