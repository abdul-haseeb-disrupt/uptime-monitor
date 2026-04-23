const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { requireAuth } = require('../../middleware/auth');
const statsService = require('../../services/statsService');

router.use(requireAuth);

// Get check data for charts
router.get('/:id/checks', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    const rangeMap = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', '90d': '90 days' };
    const interval = rangeMap[range] || '24 hours';

    // Verify ownership
    const { rows: monitors } = await db.query(
      `SELECT m.id FROM monitors m JOIN websites w ON w.id = m.website_id WHERE m.id = $1 AND w.user_id = $2`,
      [req.params.id, req.session.userId]
    );
    if (!monitors[0]) return res.status(404).json({ error: 'Not found' });

    const { rows } = await db.query(
      `SELECT status, response_time, status_code, checked_at FROM checks
       WHERE monitor_id = $1 AND checked_at > NOW() - INTERVAL '${interval}'
       ORDER BY checked_at ASC`,
      [req.params.id]
    );

    res.json(rows);
  } catch (err) {
    console.error('API checks error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get monitor stats
router.get('/:id/stats', async (req, res) => {
  try {
    const { rows: monitors } = await db.query(
      `SELECT m.id FROM monitors m JOIN websites w ON w.id = m.website_id WHERE m.id = $1 AND w.user_id = $2`,
      [req.params.id, req.session.userId]
    );
    if (!monitors[0]) return res.status(404).json({ error: 'Not found' });

    const stats = await statsService.getMonitorStats(req.params.id);
    res.json(stats);
  } catch (err) {
    console.error('API stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Dashboard summary
router.get('/summary/all', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN m.status = 'up' THEN 1 END) as up,
        COUNT(CASE WHEN m.status = 'down' THEN 1 END) as down,
        COUNT(CASE WHEN m.status = 'paused' THEN 1 END) as paused
       FROM monitors m
       JOIN websites w ON w.id = m.website_id
       WHERE w.user_id = $1`,
      [req.session.userId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('API summary error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
