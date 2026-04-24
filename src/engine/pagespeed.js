const cron = require('node-cron');
const axios = require('axios');
const pLimit = require('p-limit');
const db = require('../config/database');

const limit = pLimit(2); // Only 2 concurrent PSI calls (API rate limit)
const env = require('../config/env');
const PSI_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

async function checkPageSpeed(monitorId, url) {
  try {
    let apiUrl = `${PSI_API}?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo`;
    if (env.PSI_API_KEY) apiUrl += `&key=${env.PSI_API_KEY}`;

    const response = await axios.get(apiUrl, {
      timeout: 60000
    });

    const data = response.data;
    const categories = data.lighthouseResult?.categories || {};
    const audits = data.lighthouseResult?.audits || {};

    const scores = {
      performance: Math.round((categories.performance?.score || 0) * 100),
      accessibility: Math.round((categories.accessibility?.score || 0) * 100),
      best_practices: Math.round((categories['best-practices']?.score || 0) * 100),
      seo: Math.round((categories.seo?.score || 0) * 100),
      lcp: audits['largest-contentful-paint']?.numericValue ? (audits['largest-contentful-paint'].numericValue / 1000).toFixed(2) : null,
      cls: audits['cumulative-layout-shift']?.numericValue ? audits['cumulative-layout-shift'].numericValue.toFixed(3) : null,
      fcp: audits['first-contentful-paint']?.numericValue ? Math.round(audits['first-contentful-paint'].numericValue) : null,
      ttfb: audits['server-response-time']?.numericValue ? Math.round(audits['server-response-time'].numericValue) : null,
      speed_index: audits['speed-index']?.numericValue ? Math.round(audits['speed-index'].numericValue) : null
    };

    await db.query(
      `INSERT INTO pagespeed_checks (monitor_id, performance, accessibility, best_practices, seo, lcp, cls, fcp, ttfb, speed_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [monitorId, scores.performance, scores.accessibility, scores.best_practices, scores.seo,
       scores.lcp, scores.cls, scores.fcp, scores.ttfb, scores.speed_index]
    );

    console.log(`PageSpeed: ${url} -> P:${scores.performance} A:${scores.accessibility} BP:${scores.best_practices} SEO:${scores.seo}`);
    return scores;
  } catch (err) {
    console.error(`PageSpeed error for ${url}:`, err.message);
    return null;
  }
}

async function runPageSpeedChecks() {
  console.log('Starting daily PageSpeed checks...');

  // Get all active HTTP monitors with URLs
  const { rows: monitors } = await db.query(
    "SELECT m.id, m.url FROM monitors m WHERE m.is_active = true AND m.type IN ('http', 'keyword') AND m.url IS NOT NULL"
  );

  console.log(`PageSpeed: ${monitors.length} pages to check`);

  let completed = 0;
  await Promise.all(
    monitors.map(m => limit(async () => {
      await checkPageSpeed(m.id, m.url);
      completed++;
      if (completed % 10 === 0) console.log(`PageSpeed: ${completed}/${monitors.length} done`);
    }))
  );

  console.log(`PageSpeed: All ${monitors.length} checks complete`);
}

async function getLatestScores(monitorId) {
  // Return today's average scores (3 checks/day)
  const { rows } = await db.query(
    `SELECT
      ROUND(AVG(performance)) as performance,
      ROUND(AVG(accessibility)) as accessibility,
      ROUND(AVG(best_practices)) as best_practices,
      ROUND(AVG(seo)) as seo,
      ROUND(AVG(lcp)::numeric, 2) as lcp,
      ROUND(AVG(cls)::numeric, 3) as cls,
      ROUND(AVG(fcp)) as fcp,
      ROUND(AVG(ttfb)) as ttfb,
      MAX(checked_at) as checked_at,
      COUNT(*) as check_count
     FROM pagespeed_checks
     WHERE monitor_id = $1 AND checked_at > NOW() - INTERVAL '24 hours'`,
    [monitorId]
  );
  if (!rows[0] || !rows[0].performance) return null;
  return rows[0];
}

async function getScoreHistory(monitorId, days) {
  const { rows } = await db.query(
    `SELECT performance, accessibility, best_practices, seo, lcp, cls, checked_at
     FROM pagespeed_checks WHERE monitor_id = $1 AND checked_at > NOW() - INTERVAL '${days} days'
     ORDER BY checked_at ASC`,
    [monitorId]
  );
  return rows;
}

function startPageSpeedScheduler() {
  // Run 3 times daily: 6 AM, 2 PM, 10 PM
  cron.schedule('0 6,14,22 * * *', async () => {
    try {
      await runPageSpeedChecks();
    } catch (err) {
      console.error('PageSpeed scheduler error:', err.message);
    }
  });

  console.log('PageSpeed scheduler started (daily at 4 AM)');

  // Run first check 2 minutes after startup
  setTimeout(async () => {
    try {
      await runPageSpeedChecks();
    } catch (err) {
      console.error('PageSpeed initial run error:', err.message);
    }
  }, 120000);
}

module.exports = { startPageSpeedScheduler, getLatestScores, getScoreHistory, runPageSpeedChecks };
