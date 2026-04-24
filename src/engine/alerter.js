const db = require('../config/database');
const monitorService = require('../services/monitorService');
const alertService = require('../services/alertService');

const CONFIRMATION_THRESHOLD = 2;

async function processCheckResult(monitor, result) {
  // Record the check
  await monitorService.recordCheck(monitor.id, result.status, result.responseTime, result.statusCode, result.error);

  // Re-read current status from DB to avoid stale data
  const fresh = await monitorService.getMonitorById(monitor.id);
  if (!fresh) return;
  const currentStatus = fresh.status;
  const newStatus = result.status;

  // Same status - nothing to do
  if (currentStatus === newStatus) return;

  // First check came back UP from unknown
  if (currentStatus === 'unknown' && newStatus === 'up') {
    await monitorService.updateMonitorStatus(monitor.id, 'up');
    return;
  }

  // Going DOWN (from up, unknown, or any non-down state)
  if (newStatus === 'down' && currentStatus !== 'down') {
    // Check if we have enough consecutive failures
    const recentChecks = await monitorService.getRecentChecks(monitor.id, CONFIRMATION_THRESHOLD);
    const allDown = recentChecks.length >= CONFIRMATION_THRESHOLD &&
      recentChecks.every(c => c.status === 'down');

    if (!allDown) return;

    // Check if already has an open incident (prevent duplicate alerts)
    const { rows: openIncidents } = await db.query(
      'SELECT id FROM incidents WHERE monitor_id = $1 AND resolved_at IS NULL LIMIT 1',
      [monitor.id]
    );
    if (openIncidents.length > 0) {
      // Already has open incident, just update status
      await monitorService.updateMonitorStatus(monitor.id, 'down');
      return;
    }

    // Confirmed down - update status, create incident, send alert
    await monitorService.updateMonitorStatus(monitor.id, 'down');

    const { rows } = await db.query(
      'INSERT INTO incidents (monitor_id, cause) VALUES ($1, $2) RETURNING *',
      [monitor.id, result.error || 'Monitor is down']
    );

    try {
      await alertService.sendDownAlert(monitor, rows[0]);
    } catch (err) {
      console.error(`Failed to send down alert for monitor ${monitor.id}:`, err.message);
    }
    return;
  }

  // Going UP (recovering from down)
  if (newStatus === 'up' && currentStatus === 'down') {
    await monitorService.updateMonitorStatus(monitor.id, 'up');

    // Resolve open incident
    await db.query(
      'UPDATE incidents SET resolved_at = NOW() WHERE monitor_id = $1 AND resolved_at IS NULL',
      [monitor.id]
    );

    try {
      await alertService.sendRecoveryAlert(monitor);
    } catch (err) {
      console.error(`Failed to send recovery alert for monitor ${monitor.id}:`, err.message);
    }
  }
}

module.exports = { processCheckResult };
