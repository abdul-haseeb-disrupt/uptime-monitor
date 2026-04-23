function flashMiddleware(req, res, next) {
  res.locals.flash = {
    success: req.flash('success'),
    error: req.flash('error'),
    info: req.flash('info')
  };
  next();
}

module.exports = flashMiddleware;
