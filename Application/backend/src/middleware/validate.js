const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true });

function validate(schema) {
  const fn = ajv.compile(schema);
  return (req, res, next) => {
    if (fn(req.body)) return next();
    const err = new Error('Invalid request body');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = (fn.errors || []).map((e) => ({ path: e.instancePath || '/', message: e.message }));
    return next(err);
  };
}

module.exports = { validate };
