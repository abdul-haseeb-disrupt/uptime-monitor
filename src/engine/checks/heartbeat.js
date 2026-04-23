const db = require('../../config/database');

// Heartbeat is passive - check if the monitor has missed its expected interval
async function checkHeartbeat(monitor) {
  if (!monitor.heartbeat_interval) {
    return { status: 'down', responseTime: 0, statusCode: null, error: 'No heartbeat interval configured' };
  }

  const lastChecked = monitor.last_checked_at ? new Date(monitor.last_checked_at) : null;

  if (!lastChecked) {
    // Never received a heartbeat - could be new, mark as down if enough time passed
    const created = new Date(monitor.created_at);
    const gracePeriod = monitor.heartbeat_interval * 1000 * 2; // Double interval as grace
    if (Date.now() - created.getTime() > gracePeriod) {
      return { status: 'down', responseTime: 0, statusCode: null, error: 'No heartbeat received' };
    }
    return { status: 'up', responseTime: 0, statusCode: null, error: null };
  }

  const elapsed = Date.now() - lastChecked.getTime();
  const expectedMs = monitor.heartbeat_interval * 1000;
  const tolerance = expectedMs * 1.5; // 50% grace period

  if (elapsed > tolerance) {
    return {
      status: 'down',
      responseTime: 0,
      statusCode: null,
      error: `Heartbeat missed - last seen ${Math.round(elapsed / 60000)} minutes ago`
    };
  }

  return { status: 'up', responseTime: 0, statusCode: null, error: null };
}

module.exports = checkHeartbeat;
