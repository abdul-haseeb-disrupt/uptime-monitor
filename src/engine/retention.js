const cron = require('node-cron');
const db = require('../config/database');

function startRetention() {
  // Run daily at 3 AM
  cron.schedule('0 3 * * *', async () => {
    try {
      console.log('Running data retention cleanup...');

      // Delete checks older than 90 days
      const checksResult = await db.query(
        "DELETE FROM checks WHERE checked_at < NOW() - INTERVAL '90 days'"
      );
      console.log(`Deleted ${checksResult.rowCount} old checks`);

      // Delete resolved incidents older than 180 days
      const incidentsResult = await db.query(
        "DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < NOW() - INTERVAL '180 days'"
      );
      console.log(`Deleted ${incidentsResult.rowCount} old incidents`);

    } catch (err) {
      console.error('Retention cleanup error:', err.message);
    }
  });

  console.log('Data retention job scheduled (daily at 3 AM)');
}

module.exports = { startRetention };
