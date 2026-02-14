export function flashMiddleware(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
}

export function setFlash(req, type, message) {
  req.session.flash = { type, message };
}
