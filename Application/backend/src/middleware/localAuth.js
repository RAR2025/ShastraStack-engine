// Optional local guard for mutating judging-interface routes.
// Reads APP_API_TOKEN from env: when unset, all routes are open (local dev
// default); when set, POST/PATCH/DELETE under /api require x-api-token.
// Reads stay open either way so dashboards keep working.
function maybeLocalAuth(req, res, next) {
  const token = process.env.APP_API_TOKEN;
  if (!token) return next();
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.get('x-api-token') === token) return next();
  const err = new Error('Valid x-api-token required for this operation.');
  err.status = 401;
  err.code = 'UNAUTHORIZED';
  return next(err);
}

module.exports = { maybeLocalAuth };
