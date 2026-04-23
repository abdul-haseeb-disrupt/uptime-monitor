const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// List websites
router.get('/', async (req, res) => {
  res.redirect('/dashboard');
});

// New website form
router.get('/new', (req, res) => {
  res.render('websites/new', { title: 'Add Website' });
});

// Create website
router.post('/', async (req, res) => {
  try {
    const { name, base_url } = req.body;
    if (!name) {
      req.flash('error', 'Website name is required');
      return res.redirect('/websites/new');
    }

    const { rows } = await db.query(
      'INSERT INTO websites (user_id, name, base_url) VALUES ($1, $2, $3) RETURNING id',
      [req.session.userId, name.trim(), (base_url || '').trim()]
    );

    req.flash('success', 'Website added! Now add monitors.');
    res.redirect(`/websites/${rows[0].id}`);
  } catch (err) {
    console.error('Create website error:', err);
    req.flash('error', 'Failed to create website');
    res.redirect('/websites/new');
  }
});

// Show website with monitors
router.get('/:id', async (req, res) => {
  try {
    const { rows: websites } = await db.query(
      'SELECT * FROM websites WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );
    if (!websites[0]) {
      req.flash('error', 'Website not found');
      return res.redirect('/dashboard');
    }

    const { rows: monitors } = await db.query(
      'SELECT * FROM monitors WHERE website_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );

    // Get latest check for each monitor
    for (const monitor of monitors) {
      const { rows: checks } = await db.query(
        'SELECT * FROM checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1',
        [monitor.id]
      );
      monitor.lastCheck = checks[0] || null;
    }

    res.render('websites/show', {
      title: websites[0].name,
      website: websites[0],
      monitors
    });
  } catch (err) {
    console.error('Show website error:', err);
    req.flash('error', 'Failed to load website');
    res.redirect('/dashboard');
  }
});

// Edit website form
router.get('/:id/edit', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM websites WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );
    if (!rows[0]) {
      req.flash('error', 'Website not found');
      return res.redirect('/dashboard');
    }
    res.render('websites/edit', { title: 'Edit Website', website: rows[0] });
  } catch (err) {
    console.error('Edit website error:', err);
    res.redirect('/dashboard');
  }
});

// Update website
router.post('/:id', async (req, res) => {
  try {
    const { name, base_url } = req.body;
    await db.query(
      'UPDATE websites SET name = $1, base_url = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4',
      [name.trim(), (base_url || '').trim(), req.params.id, req.session.userId]
    );
    req.flash('success', 'Website updated');
    res.redirect(`/websites/${req.params.id}`);
  } catch (err) {
    console.error('Update website error:', err);
    req.flash('error', 'Failed to update');
    res.redirect(`/websites/${req.params.id}/edit`);
  }
});

// Delete website
router.post('/:id/delete', async (req, res) => {
  try {
    await db.query(
      'DELETE FROM websites WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );
    req.flash('success', 'Website and all monitors deleted');
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Delete website error:', err);
    req.flash('error', 'Failed to delete');
    res.redirect('/dashboard');
  }
});

module.exports = router;
