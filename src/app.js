import express from 'express';
import session from 'express-session';
import expressLayouts from 'express-ejs-layouts';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { flashMiddleware } from './middleware/flash.js';
import { sessionUserMiddleware } from './middleware/auth.js';
import authRoutes, { callbackHandler } from './routes/auth.js';
import { getRedirectPath } from './swc-client.js';
import dashboardRoutes from './routes/dashboard.js';
import inventoryRoutes from './routes/inventory.js';
import groupRoutes from './routes/groups.js';
import userRoutes from './routes/users.js';
import myRoutes from './routes/my.js';
import auditRoutes from './routes/audit.js';
import apiRoutes from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export function createApp({ setupRoutes } = {}) {
  const app = express();

  // View engine
  app.set('view engine', 'ejs');
  app.set('views', path.join(projectRoot, 'views'));
  app.use(expressLayouts);
  app.set('layout', 'layout');

  // Static files
  app.use(express.static(path.join(projectRoot, 'public')));

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

  // Mount OAuth callback at the configured redirect path (supports custom redirect URIs)
  const redirectPath = getRedirectPath();
  if (redirectPath && redirectPath !== '/auth/callback') {
    app.get(redirectPath, callbackHandler);
  }
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

  // Hook for additional routes (used in testing)
  if (setupRoutes) setupRoutes(app);

  // 404
  app.use((req, res) => {
    res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
  });

  // Error handler
  app.use((err, req, res, _next) => {
    console.error(err.stack);
    res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
  });

  return app;
}
