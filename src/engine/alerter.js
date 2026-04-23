const db = require('../config/database');
const monitorService = require('../services/monitorService');
const alertService = require('../services/alertService');

const CONFIRMATION_THRESHOLD = 2; // Consecutive failures before alerting

async function processCheckResult(monitor, result) {
  // Record the check
  await monitorService.recordCheck(monitor.id, result.status, result.responseTime, result.statusCode, result.error);

  const previousStatus = monitor.status;
  const newStatus = result.status;

  // No state change needed
  if (previousStatus === newStatus) return;
  if (previousStatus === 'unknown' && newStatus === 'up') {
    // First check came back up - just update
    await monitorService.updateMonitorStatus(monitor.id, 'up');
    return;
  }

  // Going DOWN - require confirmation threshold
  if (newStatus === 'down' && previousStatus !== 'down') {
    const recentChecks = await monitorService.getRecentChecks(monitor.id, CONFIRMATION_THRESHOLD);
    const allDown = recentChecks.length >= CONFIRMATION_THRESHOLD &&
      recentChecks.every(c => c.status === 'down');

    if (!allDown) return; // Not enough consecutive failures

    // Confirmed down
    await monitorService.updateMonitorStatus(monitor.id, 'down');

    // Create incident
    const { rows } = await db.query(
      'INSERT INTO incidents (monitor_id, cause) VALUES ($1, $2) RETURNING *',
      [monitor.id, result.error || 'Monitor is down']
    );

    // Send alert
    try {
      await alertService.sendDownAlert(monitor, rows[0]);
    } catch (err) {
      console.error(`Failed to send down alert for monitor ${monitor.id}:`, err.message);
    }
  }

  // Going UP (recovering)
  if (newStatus === 'up' && previousStatus === 'down') {
    await monitorService.updateMonitorStatus(monitor.id, 'up');

    // Resolve open incident
    await db.query(
      'UPDATE incidents SET resolved_at = NOW() WHERE monitor_id = $1 AND resolved_at IS NULL',
      [monitor.id]
    );

    // Send recovery alert
    try {
      await alertService.sendRecoveryAlert(monitor);
    } catch (err) {
      console.error(`Failed to send recovery alert for monitor ${monitor.id}:`, err.message);
    }
  }

  // Unknown -> down (first check failed)
  if (previousStatus === 'unknown' && newStatus === 'down') {
    const recentChecks = await monitorService.getRecentChecks(monitor.id, CONFIRMATION_THRESHOLD);
    const allDown = recentChecks.length >= CONFIRMATION_THRESHOLD &&
      recentChecks.every(c => c.status === 'down');

    if (allDown) {
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
    }
  }
}

module.exports = { processCheckResult };
