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
    const { name, base_url } = req.body;
    if (!name) {
      req.flash('error', 'Project name is required');
      return res.redirect('/admin/projects/new');
    }

    const { rows } = await db.query(
      'INSERT INTO websites (user_id, name, base_url) VALUES ($1, $2, $3) RETURNING id',
      [req.session.userId, name.trim(), (base_url || '').trim()]
    );

    req.flash('success', 'Project created! Now add pages to monitor.');
    res.redirect(`/admin/projects/${rows[0].id}`);
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

    // Get latest check + stats for each monitor
    const statsService = require('../services/statsService');
    for (const monitor of monitors) {
      const { rows: checks } = await db.query(
        'SELECT * FROM checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1',
        [monitor.id]
      );
      monitor.lastCheck = checks[0] || null;
      monitor.stats = await statsService.getMonitorStats(monitor.id);
      monitor.dailyUptime = await statsService.getDailyUptime(monitor.id, 90);
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
    const { name, base_url } = req.body;
    await db.query(
      'UPDATE websites SET name = $1, base_url = $2, updated_at = NOW() WHERE id = $3',
      [name.trim(), (base_url || '').trim(), req.params.id]
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
    const { name, type, url, hostname, port, keyword, keyword_type, interval_seconds, timeout_seconds, heartbeat_interval } = req.body;
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
        url ? url.trim() : null,
        hostname ? hostname.trim() : null,
        port ? parseInt(port) : null,
        keyword ? keyword.trim() : null,
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

module.exports = router;
