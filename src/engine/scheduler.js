const cron = require('node-cron');
const pLimit = require('p-limit');
const db = require('../config/database');
const checkHttp = require('./checks/http');
const checkPing = require('./checks/ping');
const checkPort = require('./checks/port');
const checkHeartbeat = require('./checks/heartbeat');
const alerter = require('./alerter');

// In-memory schedule: Map<monitorId, { monitor, nextCheckAt, running }>
const schedule = new Map();
const limit = pLimit(10); // Max 10 concurrent checks

const checkFunctions = {
  http: checkHttp,
  keyword: checkHttp, // Keywords use the same HTTP check with keyword logic
  ping: checkPing,
  port: checkPort,
  heartbeat: checkHeartbeat
};

async function loadMonitors() {
  const { rows } = await db.query('SELECT * FROM monitors WHERE is_active = true');
  for (const monitor of rows) {
    if (!schedule.has(monitor.id)) {
      schedule.set(monitor.id, {
        monitor,
        nextCheckAt: Date.now(), // Check immediately on load
        running: false
      });
    }
  }
  console.log(`Loaded ${rows.length} active monitors`);
}

async function runCheck(monitorId) {
  const entry = schedule.get(monitorId);
  if (!entry || entry.running) return;

  entry.running = true;

  try {
    // Refresh monitor data
    const { rows } = await db.query('SELECT * FROM monitors WHERE id = $1 AND is_active = true', [monitorId]);
    if (!rows[0]) {
      schedule.delete(monitorId);
      return;
    }

    const monitor = rows[0];
    entry.monitor = monitor;

    const checkFn = checkFunctions[monitor.type];
    if (!checkFn) {
      console.error(`Unknown monitor type: ${monitor.type}`);
      return;
    }

    const result = await checkFn(monitor);
    await alerter.processCheckResult(monitor, result);
  } catch (err) {
    console.error(`Check error for monitor ${monitorId}:`, err.message);
  } finally {
    entry.running = false;
    entry.nextCheckAt = Date.now() + (entry.monitor.interval_seconds * 1000);
  }
}

async function tick() {
  const now = Date.now();
  const due = [];

  for (const [monitorId, entry] of schedule) {
    if (!entry.running && now >= entry.nextCheckAt) {
      due.push(monitorId);
    }
  }

  if (due.length > 0) {
    await Promise.all(due.map(id => limit(() => runCheck(id))));
  }
}

function addMonitor(monitorId) {
  if (!schedule.has(monitorId)) {
    schedule.set(monitorId, {
      monitor: { id: monitorId, interval_seconds: 300 },
      nextCheckAt: Date.now(),
      running: false
    });
  }
}

function removeMonitor(monitorId) {
  schedule.delete(monitorId);
}

function updateMonitor(monitorId) {
  // Remove and re-add to pick up new settings
  schedule.delete(monitorId);
  addMonitor(monitorId);
}

function getScheduleSize() {
  return schedule.size;
}

async function startScheduler() {
  await loadMonitors();

  // Run tick every 15 seconds
  cron.schedule('*/15 * * * * *', async () => {
    try {
      await tick();
    } catch (err) {
      console.error('Scheduler tick error:', err.message);
    }
  });

  console.log('Monitoring scheduler started (15s interval)');
}

module.exports = { startScheduler, addMonitor, removeMonitor, updateMonitor, getScheduleSize };
