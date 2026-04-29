const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireAdmin);

// ============================================
// ADMIN DASHBOARD - All projects overview
// ============================================
router.get('/', async (req, res) => {
  try {
    // All projects with stats
    const { rows: websites } = await db.query(
      `SELECT w.*,
        COUNT(m.id) as monitor_count,
        COUNT(CASE WHEN m.status = 'up' THEN 1 END) as up_count,
        COUNT(CASE WHEN m.status = 'down' THEN 1 END) as down_count,
        COUNT(CASE WHEN m.status = 'paused' THEN 1 END) as paused_count,
        COUNT(CASE WHEN m.status = 'unknown' THEN 1 END) as unknown_count
       FROM websites w
       LEFT JOIN monitors m ON m.website_id = w.id
       GROUP BY w.id
       ORDER BY w.name ASC`
    );

    // Overall stats
    const { rows: overallStats } = await db.query(
      `SELECT
        COUNT(DISTINCT w.id) as total_projects,
        COUNT(m.id) as total_monitors,
        COUNT(CASE WHEN m.status = 'up' THEN 1 END) as up_count,
        COUNT(CASE WHEN m.status = 'down' THEN 1 END) as down_count
       FROM websites w
       LEFT JOIN monitors m ON m.website_id = w.id`
    );

    // Total users
    const { rows: userStats } = await db.query('SELECT COUNT(*) as total_users FROM users');

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      websites,
      overall: overallStats[0],
      totalUsers: parseInt(userStats[0].total_users)
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    req.flash('error', 'Failed to load admin dashboard');
    res.render('admin/dashboard', { title: 'Admin Dashboard', websites: [], overall: {}, totalUsers: 0 });
  }
});

// ============================================
// PROJECT MANAGEMENT
// ============================================

// New project form
router.get('/projects/new', (req, res) => {
  res.render('admin/projects/new', { title: 'Add Project' });
});

// Create project
router.post('/projects', async (req, res) => {
  try {
    const { name, base_url, sitemaps, sitemap_auto_sync } = req.body;
    if (!name) {
      req.flash('error', 'Project name is required');
      return res.redirect('/admin/projects/new');
    }

    // Parse sitemaps (textarea, one per line)
    const sitemapList = (sitemaps || '').split('\n').map(s => s.trim()).filter(s => s.length > 0);

    const { rows } = await db.query(
      'INSERT INTO websites (user_id, name, base_url, sitemaps, sitemap_auto_sync) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [req.session.userId, name.trim(), (base_url || '').trim(), sitemapList, sitemap_auto_sync === 'on']
    );

    const projectId = rows[0].id;

    // Auto-create status page
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    try {
      await db.query(
        'INSERT INTO status_pages (user_id, website_id, title, slug, description) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (slug) DO NOTHING',
        [req.session.userId, projectId, name.trim() + ' Status', slug, 'Current status of ' + name.trim()]
      );
    } catch (e) { /* slug conflict, skip */ }

    // If sitemaps provided, sync immediately
    if (sitemapList.length > 0) {
      const { syncWebsiteSitemaps } = require('../engine/sitemapSync');
      const result = await syncWebsiteSitemaps(projectId);
      req.flash('success', `Project created! ${result.added} pages imported. Status page: /status/${slug}`);
    } else {
      req.flash('success', `Project created! Status page: /status/${slug}`);
    }

    // Auto-assign all monitors to status page
    try {
      const { rows: statusPage } = await db.query('SELECT id FROM status_pages WHERE slug = $1', [slug]);
      if (statusPage[0]) {
        const { rows: monitors } = await db.query('SELECT id FROM monitors WHERE website_id = $1', [projectId]);
        for (let i = 0; i < monitors.length; i++) {
          await db.query(
            'INSERT INTO status_page_monitors (status_page_id, monitor_id, sort_order) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [statusPage[0].id, monitors[i].id, i]
          );
        }
      }
    } catch (e) { console.error('Auto status page monitors error:', e.message); }

    res.redirect(`/admin/projects/${projectId}`);
  } catch (err) {
    console.error('Create project error:', err);
    req.flash('error', 'Failed to create project');
    res.redirect('/admin/projects/new');
  }
});

// Project detail (project-level dashboard)
router.get('/projects/:id', async (req, res) => {
  try {
    const { rows: websites } = await db.query('SELECT * FROM websites WHERE id = $1', [req.params.id]);
    if (!websites[0]) {
      req.flash('error', 'Project not found');
      return res.redirect('/admin');
    }

    const { rows: monitors } = await db.query(
      'SELECT * FROM monitors WHERE website_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );

    // Get latest check + stats + pagespeed for each monitor
    const statsService = require('../services/statsService');
    const { getLatestScores } = require('../engine/pagespeed');
    for (const monitor of monitors) {
      const { rows: checks } = await db.query(
        'SELECT * FROM checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1',
        [monitor.id]
      );
      monitor.lastCheck = checks[0] || null;
      monitor.stats = await statsService.getMonitorStats(monitor.id);
      monitor.uptimeData = {
        '24h': await statsService.getHourlyUptime(monitor.id),
        '7': await statsService.getDailyUptime(monitor.id, 7),
        '30': await statsService.getDailyUptime(monitor.id, 30),
        '90': await statsService.getDailyUptime(monitor.id, 90)
      };
      monitor.pagespeed = await getLatestScores(monitor.id);
    }

    // Assigned users
    const { rows: assignedUsers } = await db.query(
      `SELECT u.id, u.name, u.email FROM user_projects up
       JOIN users u ON u.id = up.user_id
       WHERE up.website_id = $1
       ORDER BY u.name`,
      [req.params.id]
    );

    res.render('admin/projects/show', {
      title: websites[0].name,
      website: websites[0],
      monitors,
      assignedUsers
    });
  } catch (err) {
    console.error('Project detail error:', err);
    req.flash('error', 'Failed to load project');
    res.redirect('/admin');
  }
});

// Edit project
router.get('/projects/:id/edit', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM websites WHERE id = $1', [req.params.id]);
    if (!rows[0]) {
      req.flash('error', 'Project not found');
      return res.redirect('/admin');
    }
    res.render('admin/projects/edit', { title: 'Edit Project', website: rows[0] });
  } catch (err) {
    console.error('Edit project error:', err);
    res.redirect('/admin');
  }
});

// Update project
router.post('/projects/:id', async (req, res) => {
  try {
    const { name, base_url, sitemaps, sitemap_auto_sync } = req.body;
    const sitemapList = (sitemaps || '').split('\n').map(s => s.trim()).filter(s => s.length > 0);

    await db.query(
      'UPDATE websites SET name = $1, base_url = $2, sitemaps = $3, sitemap_auto_sync = $4, updated_at = NOW() WHERE id = $5',
      [name.trim(), (base_url || '').trim(), sitemapList, sitemap_auto_sync === 'on', req.params.id]
    );
    req.flash('success', 'Project updated');
    res.redirect(`/admin/projects/${req.params.id}`);
  } catch (err) {
    console.error('Update project error:', err);
    req.flash('error', 'Failed to update');
    res.redirect(`/admin/projects/${req.params.id}/edit`);
  }
});

// Delete project
router.post('/projects/:id/delete', async (req, res) => {
  try {
    await db.query('DELETE FROM websites WHERE id = $1', [req.params.id]);
    req.flash('success', 'Project and all its pages deleted');
    res.redirect('/admin');
  } catch (err) {
    console.error('Delete project error:', err);
    req.flash('error', 'Failed to delete');
    res.redirect('/admin');
  }
});

// ============================================
// PAGE (Monitor) MANAGEMENT under a project
// ============================================

// Add page form
router.get('/projects/:id/pages/new', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM websites WHERE id = $1', [req.params.id]);
    if (!rows[0]) {
      req.flash('error', 'Project not found');
      return res.redirect('/admin');
    }
    res.render('admin/pages/new', { title: 'Add Page', website: rows[0] });
  } catch (err) {
    console.error('New page error:', err);
    res.redirect('/admin');
  }
});

// Create page (monitor)
router.post('/projects/:id/pages', async (req, res) => {
  try {
    const { name, type, url, keyword, keyword_type, interval_seconds, timeout_seconds, heartbeat_interval } = req.body;
    // hostname and port can come as arrays when multiple fields with same name exist
    const hostname = Array.isArray(req.body.hostname) ? req.body.hostname.find(h => h) : req.body.hostname;
    const port = Array.isArray(req.body.port) ? req.body.port.find(p => p) : req.body.port;
    const websiteId = req.params.id;

    const { rows: websites } = await db.query('SELECT * FROM websites WHERE id = $1', [websiteId]);
    if (!websites[0]) {
      req.flash('error', 'Project not found');
      return res.redirect('/admin');
    }

    const { generateToken } = require('../utils/crypto');

    const { rows } = await db.query(
      `INSERT INTO monitors (website_id, name, type, url, hostname, port, keyword, keyword_type,
       heartbeat_token, heartbeat_interval, interval_seconds, timeout_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        parseInt(websiteId), name.trim(), type,
        url ? String(url).trim() : null,
        hostname ? String(hostname).trim() : null,
        port ? parseInt(port) : null,
        keyword ? String(keyword).trim() : null,
        keyword_type || null,
        type === 'heartbeat' ? generateToken() : null,
        heartbeat_interval ? parseInt(heartbeat_interval) : null,
        parseInt(interval_seconds) || 300,
        parseInt(timeout_seconds) || 30
      ]
    );

    // Notify scheduler
    const scheduler = require('../engine/scheduler');
    scheduler.addMonitor(rows[0].id);

    // Auto-add to project's status page
    try {
      const { rows: website } = await db.query('SELECT name FROM websites WHERE id = $1', [websiteId]);
      if (website[0]) {
        const slug = website[0].name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const { rows: sp } = await db.query('SELECT id FROM status_pages WHERE slug = $1', [slug]);
        if (sp[0]) {
          const { rows: maxOrder } = await db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM status_page_monitors WHERE status_page_id = $1', [sp[0].id]);
          await db.query('INSERT INTO status_page_monitors (status_page_id, monitor_id, sort_order) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [sp[0].id, rows[0].id, maxOrder[0].next]);
        }
      }
    } catch (e) { /* skip */ }

    req.flash('success', 'Page added!');
    res.redirect(`/admin/projects/${websiteId}`);
  } catch (err) {
    console.error('Create page error:', err);
    req.flash('error', 'Failed to add page');
    res.redirect(`/admin/projects/${req.params.id}/pages/new`);
  }
});

// Delete page
router.post('/projects/:projectId/pages/:pageId/delete', async (req, res) => {
  try {
    const scheduler = require('../engine/scheduler');
    scheduler.removeMonitor(parseInt(req.params.pageId));
    await db.query('DELETE FROM monitors WHERE id = $1 AND website_id = $2', [req.params.pageId, req.params.projectId]);
    req.flash('success', 'Page deleted');
    res.redirect(`/admin/projects/${req.params.projectId}`);
  } catch (err) {
    console.error('Delete page error:', err);
    req.flash('error', 'Failed to delete');
    res.redirect(`/admin/projects/${req.params.projectId}`);
  }
});

// Pause/Resume page
router.post('/projects/:projectId/pages/:pageId/toggle', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM monitors WHERE id = $1', [req.params.pageId]);
    if (!rows[0]) {
      req.flash('error', 'Page not found');
      return res.redirect(`/admin/projects/${req.params.projectId}`);
    }

    const newActive = !rows[0].is_active;
    const newStatus = newActive ? 'unknown' : 'paused';
    await db.query('UPDATE monitors SET is_active = $1, status = $2, updated_at = NOW() WHERE id = $3',
      [newActive, newStatus, req.params.pageId]);

    const scheduler = require('../engine/scheduler');
    if (newActive) scheduler.addMonitor(parseInt(req.params.pageId));
    else scheduler.removeMonitor(parseInt(req.params.pageId));

    req.flash('success', newActive ? 'Page resumed' : 'Page paused');
    res.redirect(`/admin/projects/${req.params.projectId}`);
  } catch (err) {
    console.error('Toggle page error:', err);
    res.redirect(`/admin/projects/${req.params.projectId}`);
  }
});

// ============================================
// USER MANAGEMENT
// ============================================

// List users
router.get('/users', async (req, res) => {
  try {
    const { rows: users } = await db.query(
      `SELECT u.*,
        COUNT(DISTINCT up.website_id) as assigned_projects
       FROM users u
       LEFT JOIN user_projects up ON up.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );

    res.render('admin/users/index', { title: 'User Management', users });
  } catch (err) {
    console.error('Users list error:', err);
    res.render('admin/users/index', { title: 'User Management', users: [] });
  }
});

// User detail - assign/unassign projects
router.get('/users/:id', async (req, res) => {
  try {
    const { rows: users } = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!users[0]) {
      req.flash('error', 'User not found');
      return res.redirect('/admin/users');
    }

    // All projects
    const { rows: allProjects } = await db.query('SELECT * FROM websites ORDER BY name');

    // Assigned project IDs
    const { rows: assigned } = await db.query(
      'SELECT website_id FROM user_projects WHERE user_id = $1',
      [req.params.id]
    );
    const assignedIds = assigned.map(a => a.website_id);

    res.render('admin/users/show', {
      title: `Manage ${users[0].name}`,
      targetUser: users[0],
      allProjects,
      assignedIds
    });
  } catch (err) {
    console.error('User detail error:', err);
    res.redirect('/admin/users');
  }
});

// Update user project assignments
router.post('/users/:id/assignments', async (req, res) => {
  try {
    const userId = req.params.id;
    let { project_ids } = req.body;
    project_ids = Array.isArray(project_ids) ? project_ids : (project_ids ? [project_ids] : []);

    // Remove all existing assignments
    await db.query('DELETE FROM user_projects WHERE user_id = $1', [userId]);

    // Add new assignments
    for (const pid of project_ids) {
      await db.query(
        'INSERT INTO user_projects (user_id, website_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, parseInt(pid)]
      );
    }

    req.flash('success', 'Project assignments updated');
    res.redirect(`/admin/users/${userId}`);
  } catch (err) {
    console.error('Update assignments error:', err);
    req.flash('error', 'Failed to update assignments');
    res.redirect(`/admin/users/${req.params.id}`);
  }
});

// Toggle user role
router.post('/users/:id/toggle-role', async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.session.userId) {
      req.flash('error', 'Cannot change your own role');
      return res.redirect('/admin/users');
    }

    const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [req.params.id]);
    if (!rows[0]) {
      req.flash('error', 'User not found');
      return res.redirect('/admin/users');
    }

    const newRole = rows[0].role === 'admin' ? 'user' : 'admin';
    await db.query('UPDATE users SET role = $1 WHERE id = $2', [newRole, req.params.id]);

    req.flash('success', `User role changed to ${newRole}`);
    res.redirect('/admin/users');
  } catch (err) {
    console.error('Toggle role error:', err);
    res.redirect('/admin/users');
  }
});

// Delete user
router.post('/users/:id/delete', async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.session.userId) {
      req.flash('error', 'Cannot delete yourself');
      return res.redirect('/admin/users');
    }
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    req.flash('success', 'User deleted');
    res.redirect('/admin/users');
  } catch (err) {
    console.error('Delete user error:', err);
    res.redirect('/admin/users');
  }
});

// Trigger PageSpeed checks manually
router.post('/run-pagespeed', async (req, res) => {
  try {
    const { runPageSpeedChecks } = require('../engine/pagespeed');
    req.flash('success', 'PageSpeed checks started! This will take ~15-25 minutes for all pages.');
    res.redirect('/admin');
    // Run in background after response
    runPageSpeedChecks().catch(err => console.error('Manual PageSpeed run error:', err.message));
  } catch (err) {
    console.error('Run PageSpeed error:', err);
    req.flash('error', 'Failed to start PageSpeed checks');
    res.redirect('/admin');
  }
});

// Run PageSpeed for a specific project
router.post('/projects/:id/run-pagespeed', async (req, res) => {
  try {
    const axios = require('axios');
    const pLimit = require('p-limit');
    const { getLatestScores } = require('../engine/pagespeed');
    const env = require('../config/env');

    const { rows: monitors } = await db.query(
      "SELECT m.id, m.url FROM monitors m WHERE m.website_id = $1 AND m.is_active = true AND m.type IN ('http', 'keyword') AND m.url IS NOT NULL",
      [req.params.id]
    );

    req.flash('success', `PageSpeed checks started for ${monitors.length} pages! This will take a few minutes.`);
    res.redirect(`/admin/projects/${req.params.id}`);

    // Run in background
    const limit = pLimit(2);
    const PSI_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

    for (const m of monitors) {
      for (const strategy of ['mobile', 'desktop']) {
        await limit(async () => {
          try {
            let apiUrl = `${PSI_API}?url=${encodeURIComponent(m.url)}&strategy=${strategy}&category=performance&category=accessibility&category=best-practices&category=seo`;
            if (env.PSI_API_KEY) apiUrl += `&key=${env.PSI_API_KEY}`;
            const response = await axios.get(apiUrl, { timeout: 90000 });
            const data = response.data;
            const cats = data.lighthouseResult?.categories || {};
            const audits = data.lighthouseResult?.audits || {};
            await db.query(
              `INSERT INTO pagespeed_checks (monitor_id, strategy, performance, accessibility, best_practices, seo, lcp, cls, fcp, ttfb, speed_index)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [m.id, strategy,
               Math.round((cats.performance?.score || 0) * 100),
               Math.round((cats.accessibility?.score || 0) * 100),
               Math.round((cats['best-practices']?.score || 0) * 100),
               Math.round((cats.seo?.score || 0) * 100),
               audits['largest-contentful-paint']?.numericValue ? (audits['largest-contentful-paint'].numericValue / 1000).toFixed(2) : null,
               audits['cumulative-layout-shift']?.numericValue ? audits['cumulative-layout-shift'].numericValue.toFixed(3) : null,
               audits['first-contentful-paint']?.numericValue ? Math.round(audits['first-contentful-paint'].numericValue) : null,
               audits['server-response-time']?.numericValue ? Math.round(audits['server-response-time'].numericValue) : null,
               audits['speed-index']?.numericValue ? Math.round(audits['speed-index'].numericValue) : null
              ]);
            console.log(`PageSpeed [${strategy}]: ${m.url} done`);
          } catch (err) {
            console.error(`PageSpeed [${strategy}] error for ${m.url}:`, err.message);
          }
        });
      }
    }
    console.log(`PageSpeed for project ${req.params.id}: complete`);
  } catch (err) {
    console.error('Run project PageSpeed error:', err);
    req.flash('error', 'Failed to start PageSpeed checks');
    res.redirect(`/admin/projects/${req.params.id}`);
  }
});

// Sync sitemap for a project
router.post('/projects/:id/sync-sitemap', async (req, res) => {
  try {
    const { syncWebsiteSitemaps } = require('../engine/sitemapSync');
    const result = await syncWebsiteSitemaps(req.params.id);
    req.flash('success', `Sitemap synced! ${result.added} new pages added.`);
    res.redirect(`/admin/projects/${req.params.id}`);
  } catch (err) {
    console.error('Sync sitemap error:', err);
    req.flash('error', 'Failed to sync sitemap');
    res.redirect(`/admin/projects/${req.params.id}`);
  }
});

module.exports = router;
