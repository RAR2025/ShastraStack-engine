// Local-dev token guard for /api/admin/*. The token value is read from env
// and is NEVER echoed in any response body.
function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_TOKEN || 'local-dev-token';
  const got = req.get('x-admin-token') || '';
  if (!got || got !== expected) {
    return res.status(401).json({ error: { code: 'ADMIN_UNAUTHORIZED', message: 'Valid x-admin-token required for admin routes.' } });
  }
  return next();
}

module.exports = { adminAuth };
