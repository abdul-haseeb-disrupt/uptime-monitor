const env = require('./config/env');
const runMigrations = require('./db/migrate');
const app = require('./app');
const { startScheduler } = require('./engine/scheduler');
const { startRetention } = require('./engine/retention');
const { startPageSpeedScheduler } = require('./engine/pagespeed');

async function start() {
  try {
    console.log('Running database migrations...');
    await runMigrations();

    console.log('Starting monitoring engine...');
    await startScheduler();

    console.log('Starting data retention job...');
    startRetention();

    console.log('Starting PageSpeed scheduler...');
    startPageSpeedScheduler();

    app.listen(env.PORT, () => {
      console.log(`Uptime Monitor running on port ${env.PORT}`);
      console.log(`Environment: ${env.NODE_ENV}`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
