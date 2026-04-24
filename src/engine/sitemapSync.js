const cron = require('node-cron');
const axios = require('axios');
const db = require('../config/database');

async function parseSitemap(url) {
  try {
    const response = await axios.get(url, { timeout: 30000, headers: { 'User-Agent': 'UptimeMonitor/1.0' } });
    const xml = response.data;

    // Extract URLs from sitemap
    const allUrls = [];
    const matches = xml.match(/<loc>([^<]+)<\/loc>/g) || [];
    for (const match of matches) {
      const loc = match.replace(/<\/?loc>/g, '').trim();
      if (loc.match(/\.(jpg|jpeg|png|gif|svg|css|js|pdf|xml|json|ico|woff|woff2|ttf|eot)$/i)) continue;
      allUrls.push(loc);
    }

    // Smart filter: for sections like /blog, /news, /insights, /glossary, /resources
    // only keep the main section page, skip individual posts
    const sectionPatterns = /\/(blog|news|insights|glossary|resources|articles|posts|newsroom|case-studies|casestudy|stories|press)\//i;
    const sectionRoots = new Set();
    const urls = [];

    for (const u of allUrls) {
      const match = u.match(sectionPatterns);
      if (match) {
        // This is a sub-page of a section (e.g. /blog/my-post)
        // Only add the section root once (e.g. /blog)
        const sectionRoot = u.substring(0, u.indexOf('/' + match[1] + '/') + match[1].length + 2);
        if (!sectionRoots.has(sectionRoot)) {
          sectionRoots.add(sectionRoot);
          urls.push(sectionRoot.replace(/\/$/, ''));
        }
      } else {
        urls.push(u);
      }
    }

    return urls;
  } catch (err) {
    console.error(`Sitemap fetch error for ${url}:`, err.message);
    return [];
  }
}

function urlToPageName(url, baseUrl) {
  let path = url.replace(baseUrl, '').replace(/^\//, '').replace(/\/$/, '');
  if (!path) return 'Homepage';
  return path.split('/').map(p =>
    p.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  ).join(' > ');
}

async function syncWebsiteSitemaps(websiteId) {
  const { rows: websites } = await db.query(
    'SELECT * FROM websites WHERE id = $1',
    [websiteId]
  );
  if (!websites[0] || !websites[0].sitemaps || websites[0].sitemaps.length === 0) return { added: 0 };

  const website = websites[0];

  // Get existing monitor URLs
  const { rows: existing } = await db.query(
    'SELECT url FROM monitors WHERE website_id = $1 AND url IS NOT NULL',
    [websiteId]
  );
  const existingUrls = new Set(existing.map(e => e.url.replace(/\/$/, '')));

  let totalAdded = 0;

  for (const sitemapUrl of website.sitemaps) {
    const urls = await parseSitemap(sitemapUrl);
    console.log(`Sitemap ${sitemapUrl}: found ${urls.length} URLs`);

    for (const url of urls) {
      const cleanUrl = url.replace(/\/$/, '');
      if (existingUrls.has(cleanUrl) || existingUrls.has(cleanUrl + '/')) continue;

      const name = urlToPageName(url, website.base_url || '');

      await db.query(
        `INSERT INTO monitors (website_id, name, type, url, interval_seconds, timeout_seconds)
         VALUES ($1, $2, 'http', $3, 300, 30)`,
        [websiteId, name, url]
      );

      existingUrls.add(cleanUrl);
      totalAdded++;
      console.log(`Sitemap sync: Added "${name}" -> ${url}`);
    }
  }

  // Update last sync time
  await db.query('UPDATE websites SET last_sitemap_sync = NOW() WHERE id = $1', [websiteId]);

  // Reload scheduler for new monitors
  if (totalAdded > 0) {
    const { rows: newMonitors } = await db.query(
      'SELECT id FROM monitors WHERE website_id = $1 AND is_active = true',
      [websiteId]
    );
    const scheduler = require('./scheduler');
    for (const m of newMonitors) {
      scheduler.addMonitor(m.id);
    }
  }

  return { added: totalAdded };
}

async function syncAllSitemaps() {
  console.log('Starting sitemap sync...');

  const { rows: websites } = await db.query(
    "SELECT id, name FROM websites WHERE sitemap_auto_sync = true AND sitemaps != '{}'"
  );

  for (const website of websites) {
    try {
      const result = await syncWebsiteSitemaps(website.id);
      console.log(`Sitemap sync [${website.name}]: ${result.added} new pages added`);
    } catch (err) {
      console.error(`Sitemap sync error for ${website.name}:`, err.message);
    }
  }

  console.log('Sitemap sync complete');
}

function startSitemapScheduler() {
  // Check sitemaps every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    try {
      await syncAllSitemaps();
    } catch (err) {
      console.error('Sitemap scheduler error:', err.message);
    }
  });

  console.log('Sitemap sync scheduler started (every 6 hours)');
}

module.exports = { startSitemapScheduler, syncWebsiteSitemaps, syncAllSitemaps, parseSitemap };
