const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true, removeAdditional: false });

function validate(schema) {
  const fn = ajv.compile(schema);
  return (req, res, next) => {
    const valid = fn(req.body);
    if (valid) return next();
    const err = new Error('Invalid request body');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = (fn.errors || []).map((e) => ({
      path: e.instancePath || '/',
      message: e.message,
      params: e.params,
    }));
    return next(err);
  };
}

module.exports = { validate, ajv };
