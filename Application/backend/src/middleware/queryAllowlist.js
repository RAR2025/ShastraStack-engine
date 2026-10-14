// Strict allowlist of supported query parameters per listing route.
// Unknown parameters are rejected so typos fail loudly instead of being ignored.
function checkQuery(allowed) {
  const set = new Set(allowed);
  return (req, res, next) => {
    const unknown = Object.keys(req.query || {}).filter((k) => !set.has(k));
    if (unknown.length > 0) {
      const err = new Error(`Unsupported query parameter(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ') || '(none)'}`);
      err.status = 400;
      err.code = 'VALIDATION_ERROR';
      return next(err);
    }
    return next();
  };
}

const TOOL_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

function checkToolId(req, res, next) {
  if (!TOOL_ID_RE.test(req.params.toolId || '')) {
    const err = new Error('Invalid toolId; must match ^[a-z0-9][a-z0-9-_]{0,63}$');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    return next(err);
  }
  return next();
}

function checkIdParam(name, maxLength = 100) {
  return (req, res, next) => {
    const v = String(req.params[name] || '');
    if (!v || v.length > maxLength) {
      const err = new Error(`Invalid ${name}`);
      err.status = 400;
      err.code = 'VALIDATION_ERROR';
      return next(err);
    }
    return next();
  };
}

module.exports = { checkQuery, checkToolId, checkIdParam };
