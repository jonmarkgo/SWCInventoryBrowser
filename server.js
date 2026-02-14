import express from 'express';
import session from 'express-session';
import expressLayouts from 'express-ejs-layouts';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './src/config.js';
import { initDatabase } from './src/database.js';
import { restoreLeaderClient } from './src/swc-client.js';
import { flashMiddleware } from './src/middleware/flash.js';
import { sessionUserMiddleware } from './src/middleware/auth.js';
import authRoutes from './src/routes/auth.js';
import dashboardRoutes from './src/routes/dashboard.js';
import inventoryRoutes from './src/routes/inventory.js';
import groupRoutes from './src/routes/groups.js';
import userRoutes from './src/routes/users.js';
import myRoutes from './src/routes/my.js';
import auditRoutes from './src/routes/audit.js';
import apiRoutes from './src/routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Initialize database and restore leader token
await initDatabase();
await restoreLeaderClient();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sessions
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// Flash messages & session user
app.use(flashMiddleware);
app.use(sessionUserMiddleware);

// Routes
app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/inventory', inventoryRoutes);
app.use('/groups', groupRoutes);
app.use('/users', userRoutes);
app.use('/my', myRoutes);
app.use('/audit', auditRoutes);
app.use('/api', apiRoutes);

// Landing page
app.get('/', (req, res) => {
  if (req.session.userId) {
    const user = req.appUser;
    if (user?.is_leader) return res.redirect('/dashboard');
    return res.redirect('/my/dashboard');
  }
  res.render('index', { title: '' });
});

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
});

app.listen(config.port, () => {
  console.log(`SWC Inventory Control running at ${config.baseUrl}`);
});
