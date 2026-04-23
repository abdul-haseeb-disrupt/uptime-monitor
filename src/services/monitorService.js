const db = require('../config/database');

async function getAllActiveMonitors() {
  const { rows } = await db.query(
    'SELECT * FROM monitors WHERE is_active = true'
  );
  return rows;
}

async function getMonitorById(id) {
  const { rows } = await db.query('SELECT * FROM monitors WHERE id = $1', [id]);
  return rows[0];
}

async function recordCheck(monitorId, status, responseTime, statusCode, errorMessage) {
  await db.query(
    'INSERT INTO checks (monitor_id, status, response_time, status_code, error_message) VALUES ($1, $2, $3, $4, $5)',
    [monitorId, status, responseTime, statusCode, errorMessage]
  );

  await db.query(
    'UPDATE monitors SET last_checked_at = NOW(), updated_at = NOW() WHERE id = $1',
    [monitorId]
  );
}

async function updateMonitorStatus(monitorId, newStatus) {
  await db.query(
    'UPDATE monitors SET status = $1, last_status_change = NOW(), updated_at = NOW() WHERE id = $2',
    [newStatus, monitorId]
  );
}

async function getRecentChecks(monitorId, count) {
  const { rows } = await db.query(
    'SELECT * FROM checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT $2',
    [monitorId, count]
  );
  return rows;
}

module.exports = { getAllActiveMonitors, getMonitorById, recordCheck, updateMonitorStatus, getRecentChecks };
