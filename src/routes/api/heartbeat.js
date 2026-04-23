const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// Heartbeat check-in endpoint (no auth - token-based)
async function handleHeartbeat(req, res) {
  try {
    const { token } = req.params;

    const { rows } = await db.query(
      "SELECT * FROM monitors WHERE heartbeat_token = $1 AND type = 'heartbeat' AND is_active = true",
      [token]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Invalid heartbeat token' });
    }

    const monitor = rows[0];

    // Record the check
    await db.query(
      "INSERT INTO checks (monitor_id, status, response_time, checked_at) VALUES ($1, 'up', 0, NOW())",
      [monitor.id]
    );

    // Update monitor status
    const wasDown = monitor.status === 'down';
    await db.query(
      "UPDATE monitors SET status = 'up', last_checked_at = NOW(), updated_at = NOW() WHERE id = $1",
      [monitor.id]
    );

    // If was down, resolve incident and send recovery alert
    if (wasDown) {
      await db.query(
        'UPDATE incidents SET resolved_at = NOW() WHERE monitor_id = $1 AND resolved_at IS NULL',
        [monitor.id]
      );

      // Send recovery alert
      const alertService = require('../../services/alertService');
      await alertService.sendRecoveryAlert(monitor);
    }

    res.json({ ok: true, message: 'Heartbeat received' });
  } catch (err) {
    console.error('Heartbeat error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

router.get('/:token', handleHeartbeat);
router.post('/:token', handleHeartbeat);

module.exports = router;
