const cron = require('node-cron');
const axios = require('axios');
const pLimit = require('p-limit');
const db = require('../config/database');
const env = require('../config/env');

const limit = pLimit(2);
const PSI_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

async function checkPageSpeed(monitorId, url, strategy) {
  try {
    let apiUrl = `${PSI_API}?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance&category=accessibility&category=best-practices&category=seo`;
    if (env.PSI_API_KEY) apiUrl += `&key=${env.PSI_API_KEY}`;

    const response = await axios.get(apiUrl, { timeout: 90000 });

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
      `INSERT INTO pagespeed_checks (monitor_id, strategy, performance, accessibility, best_practices, seo, lcp, cls, fcp, ttfb, speed_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [monitorId, strategy, scores.performance, scores.accessibility, scores.best_practices, scores.seo,
       scores.lcp, scores.cls, scores.fcp, scores.ttfb, scores.speed_index]
    );

    console.log(`PageSpeed [${strategy}]: ${url} -> P:${scores.performance} A:${scores.accessibility} BP:${scores.best_practices} SEO:${scores.seo}`);
    return scores;
  } catch (err) {
    console.error(`PageSpeed [${strategy}] error for ${url}:`, err.message);
    return null;
  }
}

async function runPageSpeedChecks() {
  console.log('Starting PageSpeed checks (mobile + desktop)...');

  const { rows: monitors } = await db.query(
    "SELECT m.id, m.url FROM monitors m WHERE m.is_active = true AND m.type IN ('http', 'keyword') AND m.url IS NOT NULL"
  );

  console.log(`PageSpeed: ${monitors.length} pages x 2 strategies = ${monitors.length * 2} checks`);

  let completed = 0;
  const total = monitors.length * 2;

  for (const m of monitors) {
    await limit(async () => {
      await checkPageSpeed(m.id, m.url, 'mobile');
      completed++;
    });
    await limit(async () => {
      await checkPageSpeed(m.id, m.url, 'desktop');
      completed++;
    });
    if (completed % 10 === 0) console.log(`PageSpeed: ${completed}/${total} done`);
  }

  console.log(`PageSpeed: All ${total} checks complete`);
}

async function getLatestScores(monitorId) {
  const result = {};

  for (const strategy of ['mobile', 'desktop']) {
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
       WHERE monitor_id = $1 AND strategy = $2 AND checked_at > NOW() - INTERVAL '24 hours'`,
      [monitorId, strategy]
    );
    if (rows[0] && rows[0].performance) {
      result[strategy] = rows[0];
    }
  }

  return (result.mobile || result.desktop) ? result : null;
}

async function getScoreHistory(monitorId, days) {
  const { rows } = await db.query(
    `SELECT strategy, performance, accessibility, best_practices, seo, lcp, cls, checked_at
     FROM pagespeed_checks WHERE monitor_id = $1 AND checked_at > NOW() - INTERVAL '${days} days'
     ORDER BY checked_at ASC`,
    [monitorId]
  );
  return rows;
}

function startPageSpeedScheduler() {
  cron.schedule('0 6,14,22 * * *', async () => {
    try {
      await runPageSpeedChecks();
    } catch (err) {
      console.error('PageSpeed scheduler error:', err.message);
    }
  });

  console.log('PageSpeed scheduler started (3x daily: 6AM, 2PM, 10PM UTC)');

  // Run 30s after startup if no data exists
  setTimeout(async () => {
    try {
      const { rows } = await db.query('SELECT COUNT(*) as c FROM pagespeed_checks WHERE strategy IS NOT NULL AND performance > 0');
      const count = parseInt(rows[0].c);
      if (count === 0) {
        console.log('PageSpeed: No valid data found, running initial checks...');
        await runPageSpeedChecks();
      } else {
        console.log(`PageSpeed: ${count} existing checks found, waiting for next scheduled run`);
      }
    } catch (err) {
      console.error('PageSpeed initial check error:', err.message);
    }
  }, 30000);
}

module.exports = { startPageSpeedScheduler, getLatestScores, getScoreHistory, runPageSpeedChecks };
