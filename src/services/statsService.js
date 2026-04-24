const db = require('../config/database');

async function getMonitorStats(monitorId) {
  const periods = [
    { label: '24h', interval: '24 hours' },
    { label: '7d', interval: '7 days' },
    { label: '30d', interval: '30 days' },
    { label: '90d', interval: '90 days' }
  ];

  const stats = {};

  for (const period of periods) {
    const { rows } = await db.query(
      `SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'up' THEN 1 END) as up_count,
        AVG(CASE WHEN status = 'up' THEN response_time END) as avg_response_time
       FROM checks
       WHERE monitor_id = $1 AND checked_at > NOW() - INTERVAL '${period.interval}'`,
      [monitorId]
    );

    const row = rows[0];
    const total = parseInt(row.total) || 0;
    const upCount = parseInt(row.up_count) || 0;

    const uptime = total > 0 ? (upCount / total) * 100 : null;
    stats[`uptime_${period.label}`] = uptime !== null ? (uptime === 100 ? '100' : uptime.toFixed(2)) : null;
    stats[`avg_response_${period.label}`] = row.avg_response_time ? Math.round(parseFloat(row.avg_response_time)) : null;
  }

  return stats;
}

async function getDailyUptime(monitorId, days) {
  const { rows } = await db.query(
    `SELECT
      DATE(checked_at) as day,
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'up' THEN 1 END) as up_count
     FROM checks
     WHERE monitor_id = $1 AND checked_at > NOW() - INTERVAL '${days} days'
     GROUP BY DATE(checked_at)
     ORDER BY day ASC`,
    [monitorId]
  );

  // Fill missing days with null
  const result = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dayStr = date.toISOString().split('T')[0];

    const found = rows.find(r => r.day.toISOString().split('T')[0] === dayStr);
    if (found) {
      const total = parseInt(found.total);
      const up = parseInt(found.up_count);
      result.push({
        day: dayStr,
        uptime: total > 0 ? (up / total) * 100 : null
      });
    } else {
      result.push({ day: dayStr, uptime: null });
    }
  }

  return result;
}

async function getHourlyUptime(monitorId) {
  const { rows } = await db.query(
    `SELECT
      DATE_TRUNC('hour', checked_at) as hour,
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'up' THEN 1 END) as up_count
     FROM checks
     WHERE monitor_id = $1 AND checked_at > NOW() - INTERVAL '24 hours'
     GROUP BY DATE_TRUNC('hour', checked_at)
     ORDER BY hour ASC`,
    [monitorId]
  );

  const result = [];
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const date = new Date(now);
    date.setHours(date.getHours() - i, 0, 0, 0);
    const hourStr = date.toISOString().slice(0, 13);

    const found = rows.find(r => new Date(r.hour).toISOString().slice(0, 13) === hourStr);
    if (found) {
      const total = parseInt(found.total);
      const up = parseInt(found.up_count);
      result.push({
        day: date.toISOString().slice(11, 16),
        uptime: total > 0 ? (up / total) * 100 : null
      });
    } else {
      result.push({ day: date.toISOString().slice(11, 16), uptime: null });
    }
  }

  return result;
}

module.exports = { getMonitorStats, getDailyUptime, getHourlyUptime };
