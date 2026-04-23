const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const flash = require('connect-flash');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const env = require('./config/env');
const { pool } = require('./config/database');
const { loadUser } = require('./middleware/auth');
const flashMiddleware = require('./middleware/flash');
const timeUtils = require('./utils/time');

const app = express();

// Trust proxy (Railway runs behind a reverse proxy)
app.set('trust proxy', 1);

// Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "cdn.jsdelivr.net", "unpkg.com", "cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "fonts.googleapis.com", "cdn.tailwindcss.com"],
      fontSrc: ["'self'", "fonts.gstatic.com", "cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  }
}));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many attempts, please try again later'
});

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Sessions
app.use(session({
  store: new PgSession({ pool, tableName: 'session' }),
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

// Flash messages
app.use(flash());
app.use(flashMiddleware);

// Load user for all requests
app.use(loadUser);

// Template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Template helpers
app.use((req, res, next) => {
  res.locals.timeAgo = timeUtils.timeAgo;
  res.locals.formatDuration = timeUtils.formatDuration;
  res.locals.formatResponseTime = timeUtils.formatResponseTime;
  res.locals.currentPath = req.path;
  res.locals.appUrl = env.APP_URL;
  next();
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

// Routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const websiteRoutes = require('./routes/websites');
const monitorRoutes = require('./routes/monitors');
const settingsRoutes = require('./routes/settings');
const statusPageRoutes = require('./routes/statusPages');
const apiMonitorRoutes = require('./routes/api/monitors');
const apiHeartbeatRoutes = require('./routes/api/heartbeat');

app.use('/', authRoutes(authLimiter));
app.use('/dashboard', dashboardRoutes);
app.use('/websites', websiteRoutes);
app.use('/monitors', monitorRoutes);
app.use('/settings', settingsRoutes);
app.use('/status-pages', statusPageRoutes);
app.use('/status', require('./routes/publicStatus'));
app.use('/api/monitors', apiMonitorRoutes);
app.use('/api/heartbeat', apiHeartbeatRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('error', { layout: 'layouts/public', title: '404', message: 'Page not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { layout: 'layouts/public', title: 'Error', message: 'Something went wrong' });
});

module.exports = app;
