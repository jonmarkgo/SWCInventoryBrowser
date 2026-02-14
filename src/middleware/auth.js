import { getDb } from '../database.js';

export async function sessionUserMiddleware(req, res, next) {
  res.locals.user = null;
  if (req.session.userId) {
    const db = getDb();
    const user = await db('users').where('id', req.session.userId).first();
    if (user) {
      req.appUser = user;
      res.locals.user = user;
    } else {
      delete req.session.userId;
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.session.userId) {
    req.session.flash = { type: 'warning', message: 'Please log in to continue.' };
    return res.redirect('/');
  }
  next();
}

export function requireLeader(req, res, next) {
  if (!req.session.userId) {
    req.session.flash = { type: 'warning', message: 'Please log in to continue.' };
    return res.redirect('/');
  }
  if (!req.appUser?.is_leader) {
    req.session.flash = { type: 'danger', message: 'Access denied. Leader privileges required.' };
    return res.redirect('/my/dashboard');
  }
  next();
}

export function requireSubuser(req, res, next) {
  if (!req.session.userId) {
    req.session.flash = { type: 'warning', message: 'Please log in to continue.' };
    return res.redirect('/');
  }
  if (req.appUser?.is_leader) {
    return res.redirect('/dashboard');
  }
  next();
}
