const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// List status pages
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM status_pages WHERE user_id = $1 ORDER BY created_at DESC',
      [req.session.userId]
    );
    res.render('status-pages/index', { title: 'Status Pages', statusPages: rows });
  } catch (err) {
    console.error('Status pages error:', err);
    res.render('status-pages/index', { title: 'Status Pages', statusPages: [] });
  }
});

// New status page form
router.get('/new', async (req, res) => {
  try {
    const { rows: monitors } = await db.query(
      `SELECT m.id, m.name, w.name as website_name FROM monitors m
       JOIN websites w ON w.id = m.website_id
       WHERE w.user_id = $1 ORDER BY w.name, m.name`,
      [req.session.userId]
    );
    res.render('status-pages/edit', { title: 'New Status Page', statusPage: null, monitors, selectedMonitors: [] });
  } catch (err) {
    console.error('New status page error:', err);
    res.redirect('/status-pages');
  }
});

// Create status page
router.post('/', async (req, res) => {
  try {
    const { title, slug, description, monitor_ids } = req.body;

    if (!title || !slug) {
      req.flash('error', 'Title and slug are required');
      return res.redirect('/status-pages/new');
    }

    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

    const { rows } = await db.query(
      'INSERT INTO status_pages (user_id, title, slug, description) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.session.userId, title.trim(), cleanSlug, (description || '').trim()]
    );

    // Add monitors to status page
    const ids = Array.isArray(monitor_ids) ? monitor_ids : (monitor_ids ? [monitor_ids] : []);
    for (let i = 0; i < ids.length; i++) {
      await db.query(
        'INSERT INTO status_page_monitors (status_page_id, monitor_id, sort_order) VALUES ($1, $2, $3)',
        [rows[0].id, parseInt(ids[i]), i]
      );
    }

    req.flash('success', 'Status page created!');
    res.redirect('/status-pages');
  } catch (err) {
    console.error('Create status page error:', err);
    if (err.code === '23505') {
      req.flash('error', 'A status page with this slug already exists');
    } else {
      req.flash('error', 'Failed to create status page');
    }
    res.redirect('/status-pages/new');
  }
});

// Edit status page
router.get('/:id/edit', async (req, res) => {
  try {
    const { rows: pages } = await db.query(
      'SELECT * FROM status_pages WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );
    if (!pages[0]) {
      req.flash('error', 'Status page not found');
      return res.redirect('/status-pages');
    }

    const { rows: monitors } = await db.query(
      `SELECT m.id, m.name, w.name as website_name FROM monitors m
       JOIN websites w ON w.id = m.website_id
       WHERE w.user_id = $1 ORDER BY w.name, m.name`,
      [req.session.userId]
    );

    const { rows: selected } = await db.query(
      'SELECT monitor_id FROM status_page_monitors WHERE status_page_id = $1',
      [req.params.id]
    );

    res.render('status-pages/edit', {
      title: 'Edit Status Page',
      statusPage: pages[0],
      monitors,
      selectedMonitors: selected.map(s => s.monitor_id)
    });
  } catch (err) {
    console.error('Edit status page error:', err);
    res.redirect('/status-pages');
  }
});

// Update status page
router.post('/:id', async (req, res) => {
  try {
    const { title, slug, description, monitor_ids } = req.body;
    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

    await db.query(
      'UPDATE status_pages SET title = $1, slug = $2, description = $3, updated_at = NOW() WHERE id = $4 AND user_id = $5',
      [title.trim(), cleanSlug, (description || '').trim(), req.params.id, req.session.userId]
    );

    // Update monitors
    await db.query('DELETE FROM status_page_monitors WHERE status_page_id = $1', [req.params.id]);
    const ids = Array.isArray(monitor_ids) ? monitor_ids : (monitor_ids ? [monitor_ids] : []);
    for (let i = 0; i < ids.length; i++) {
      await db.query(
        'INSERT INTO status_page_monitors (status_page_id, monitor_id, sort_order) VALUES ($1, $2, $3)',
        [req.params.id, parseInt(ids[i]), i]
      );
    }

    req.flash('success', 'Status page updated');
    res.redirect('/status-pages');
  } catch (err) {
    console.error('Update status page error:', err);
    req.flash('error', 'Failed to update');
    res.redirect(`/status-pages/${req.params.id}/edit`);
  }
});

// Delete status page
router.post('/:id/delete', async (req, res) => {
  try {
    await db.query('DELETE FROM status_pages WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    req.flash('success', 'Status page deleted');
    res.redirect('/status-pages');
  } catch (err) {
    console.error('Delete status page error:', err);
    req.flash('error', 'Failed to delete');
    res.redirect('/status-pages');
  }
});

module.exports = router;
