// Evidence-based drift diagnosis. Emits a diagnosis ONLY when a single,
// well-supported change explains the failure. Anything else is 'ambiguous'
// and the engine must return a truthful failure instead of guessing.
const Ajv = require('ajv');
const { getPath, jsonTypeOf } = require('../utils/paths');

const ajv = new Ajv({ allErrors: true, strict: false });

function schemaProps(schema) {
  if (schema && typeof schema === 'object' && schema.properties && typeof schema.properties === 'object') {
    return schema.properties;
  }
  return {};
}

function typeMatches(actualValue, schemaProp) {
  if (!schemaProp || typeof schemaProp !== 'object') return true;
  const expected = schemaProp.type;
  if (!expected) return true;
  const actual = jsonTypeOf(actualValue);
  if (Array.isArray(expected)) return expected.includes(actual);
  if (expected === 'number' && actual === 'integer') return true;
  return actual === expected;
}

function isCoercible(value, toType) {
  try {
    if (toType === 'string') {
      return value !== null && value !== undefined && ['string', 'number', 'boolean', 'integer'].includes(jsonTypeOf(value));
    }
    if (toType === 'number' || toType === 'integer') {
      if (typeof value === 'number') return toType === 'number' || Number.isInteger(value);
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
        return toType === 'number' || Number.isInteger(Number(value));
      }
      return false;
    }
    if (toType === 'boolean') {
      return value === 'true' || value === 'false' || typeof value === 'boolean';
    }
    return false;
  } catch (_) {
    return false;
  }
}

function missingRequired(ajvErrors) {
  const out = [];
  for (const e of ajvErrors || []) {
    if (e.keyword === 'required' && e.params && e.params.missingProperty) {
      out.push({ field: e.params.missingProperty, basePath: e.instancePath || '' });
    }
  }
  return out;
}

function invalidTypeErrors(ajvErrors) {
  return (ajvErrors || []).filter((e) => e.keyword === 'type' && typeof e.instancePath === 'string');
}

function additionalProps(ajvErrors, actual) {
  // Returns [{field, basePath}] so nested sites keep their location.
  const out = [];
  for (const e of ajvErrors || []) {
    if (e.keyword === 'additionalProperties' && e.params && e.params.additionalProperty) {
      out.push({ field: e.params.additionalProperty, basePath: typeof e.instancePath === 'string' ? e.instancePath : '' });
    }
  }
  // Also treat unknown top-level keys as candidates when schema lists properties.
  return out;
}

function isTopPath(p) {
  return p === '' || p === '/';
}

function unknownKeys(actual, props) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return [];
  return Object.keys(actual).filter((k) => !Object.prototype.hasOwnProperty.call(props, k));
}

// Blind-mode evidence: downstream HTTP error bodies often name the offending
// and expected fields (e.g. "unknown field 'email', expected 'emailAddress'").
// Extract single-candidate field signals; never treat them as proof alone —
// they must line up with the known schema exactly, else ambiguous.
function fieldSignalsFromBody(httpBody) {
  let text = '';
  try {
    text = typeof httpBody === 'string' ? httpBody : JSON.stringify(httpBody);
  } catch (_) { text = ''; }
  if (!text) return {};
  const unknown = /unknown field[s]?\s*['"]?([\w.-]+)['"]?|unexpected (?:field|property)\s*['"]?([\w.-]+)['"]?/i.exec(text);
  const expected = /expected\s*['"]?([\w.-]+)['"]?|did you mean\s*['"]?([\w.-]+)['"]?|use\s*['"]?([\w.-]+)['"]?\s+instead/i.exec(text);
  const missing = /missing (?:required )?(?:field|property)\s*['"]?([\w.-]+)['"]?|['"]?([\w.-]+)['"]?\s+is required/i.exec(text);
  return {
    unknownField: unknown ? (unknown[1] || unknown[2]) : null,
    expectedField: expected ? (expected[1] || expected[2] || expected[3]) : null,
    missingField: missing ? (missing[1] || missing[2]) : null,
  };
}

// Downstream HTTP-400 bodies often carry STRUCTURED Ajv details
// ({keyword, instancePath, params}) inside error.details. Normalize those into
// the same evidence shapes used below. Only trusted when they look like Ajv
// error objects; anything else is ignored (message-text signals stay fallback).
// Extracted only for 4xx downstream responses — never for 2xx payloads, where
// httpBody is data rather than an error envelope.
function extractDownstreamEvidence(httpBody, httpStatus) {
  const out = { missing: [], extra: [], typeErrors: [] };
  if (httpStatus !== 400 && httpStatus !== 422) return out;
  let details = null;
  try {
    details = httpBody && httpBody.error && httpBody.error.details;
  } catch (_) { details = null; }
  if (!Array.isArray(details)) return out;
  for (const e of details) {
    if (!e || typeof e !== 'object' || typeof e.keyword !== 'string') continue;
    // Some downstream bodies name the location `path` instead of `instancePath`.
    const loc = typeof e.instancePath === 'string' ? e.instancePath : (typeof e.path === 'string' ? e.path : '');
    if (e.keyword === 'required' && e.params && typeof e.params.missingProperty === 'string') {
      out.missing.push({ field: e.params.missingProperty, basePath: loc });
    } else if (e.keyword === 'additionalProperties' && e.params && typeof e.params.additionalProperty === 'string') {
      out.extra.push({ field: e.params.additionalProperty, basePath: loc });
    } else if (e.keyword === 'type' && e.params && typeof e.params.type === 'string') {
      out.typeErrors.push({ instancePath: loc, params: { type: e.params.type } });
    }
  }
  return out;
}

// Diagnose request-side drift: known downstreamSchema vs transformed request (+ http error).
// Diagnose response-side drift: known responseSchema vs downstream payload.
function diagnose({ scope, knownSchema, actual, ajvErrors = [], httpStatus = 0, httpBody = null, depth = 0 }) {
  const props = schemaProps(knownSchema);
  const missing = missingRequired(ajvErrors);
  const typeErrors = invalidTypeErrors(ajvErrors);
  const unknowns = unknownKeys(actual, props);
  const extraFromAjv = additionalProps(ajvErrors, actual);
  // Merge structured downstream evidence (blind mode: adapted payload still
  // matches the stale known schema, so local comparison alone sees nothing).
  const downstream = scope === 'request' ? extractDownstreamEvidence(httpBody, httpStatus) : { missing: [], extra: [], typeErrors: [] };
  for (const m of downstream.missing) {
    if (!missing.some((x) => x.field === m.field && (x.basePath || '') === (m.basePath || ''))) missing.push(m);
  }
  for (const t of downstream.typeErrors) {
    if (!typeErrors.some((x) => (x.instancePath || '') === (t.instancePath || ''))) typeErrors.push(t);
  }
  const extra = [...new Set([...unknowns, ...extraFromAjv.map((e) => e.field), ...downstream.extra.map((e) => e.field)])];
  // Top-level-only views for blind rules: nested sites are handled by recursion,
  // never by top-level guessing.
  const ajvExtraTop = extraFromAjv.filter((e) => isTopPath(e.basePath)).map((e) => e.field);
  const downstreamExtraTop = downstream.extra.filter((e) => isTopPath(e.basePath)).map((e) => e.field);
  const extraTop = [...new Set([...unknowns, ...ajvExtraTop, ...downstreamExtraTop])];
  const missingTop = missing.filter((m) => isTopPath(m.basePath || ''));

  // Unique known object wrappers declaring `field` as a nested prop.
  function wrappersContaining(field) {
    const out = [];
    for (const [k, propSchema] of Object.entries(props)) {
      const nested = propSchema && typeof propSchema === 'object' && propSchema.properties && typeof propSchema.properties === 'object'
        ? propSchema.properties : null;
      if (nested && Object.prototype.hasOwnProperty.call(nested, field)) out.push({ key: k, nested });
    }
    return out;
  }

  // --- 0c. Blind FLATTEN via the known-schema map: the missing flat field is
  // declared nested under exactly one known object wrapper holding a
  // type-compatible value. Checked before rename evidence because a wrapper
  // name in error text otherwise looks like a rename source.
  // (Reverse — flat→nested — stays ambiguous: rename vs move are
  // indistinguishable from blind evidence, so the engine refuses to guess.)
  if (scope === 'request' && missingTop.length === 1) {
    const missingName = missingTop[0].field.split('.').pop();
    if (!Object.prototype.hasOwnProperty.call(props, missingName)) {
      const candidates = wrappersContaining(missingName).filter(({ key, nested }) =>
        actual && typeof actual[key] === 'object' && actual[key] !== null &&
        Object.prototype.hasOwnProperty.call(actual[key], missingName) &&
        typeMatches(actual[key][missingName], nested[missingName]));
      if (candidates.length === 1 &&
          (extraTop.length === 0 || (extraTop.length === 1 && extraTop[0] === candidates[0].key))) {
        return {
          supported: true,
          kind: 'move',
          evidence: { missingField: missingName, wrapper: candidates[0].key, direction: 'flatten', scope, httpStatus, fromKnownMap: true },
          move: { fromPath: `${candidates[0].key}.${missingName}`, toPath: missingTop[0].field },
        };
      }
    }
  }

  // --- 0. Blind rename from downstream error text: the named unknown field must
  // be a known-schema property and the named expected field must be new.
  // (Covers HTTP-400 drift where the adapted request still matches the OLD schema.)
  const signals = fieldSignalsFromBody(httpBody);
  const signaledTarget = signals.expectedField || signals.missingField;
  if (signals.unknownField && signaledTarget && scope === 'request') {
    const unknownTop = signals.unknownField.split('.').pop();
    const expectedTop = signaledTarget.split('.').pop();
    if (Object.prototype.hasOwnProperty.call(props, unknownTop) &&
        !Object.prototype.hasOwnProperty.call(props, expectedTop)) {
      return {
        supported: true,
        kind: 'rename',
        evidence: { missingField: expectedTop, extraField: unknownTop, scope, httpStatus, fromErrorText: true },
        rename: { from: unknownTop, to: expectedTop },
      };
    }
  }

  // --- 0b. Blind rename from STRUCTURED downstream evidence: exactly one extra
  // known field + exactly one missing new field, value consistent with the known
  // declaration. Fires when messages are terse but details are present.
  if (scope === 'request' && missingTop.length === 1 && extraTop.length === 1) {
    const missingName = missingTop[0].field.split('.').pop();
    const extraName = extraTop[0].split('.').pop();
    if (Object.prototype.hasOwnProperty.call(props, extraName) &&
        !Object.prototype.hasOwnProperty.call(props, missingName) &&
        typeMatches(actual ? getPath(actual, extraTop[0]) : undefined, props[extraName])) {
      const base = missingTop[0].basePath || '';
      const prefix = isTopPath(base) ? '' : base.replace(/^\//, '').replace(/\//g, '.');
      return {
        supported: true,
        kind: 'rename',
        evidence: { missingField: missingName, extraField: extraName, scope, httpStatus, fromStructuredEvidence: true },
        rename: {
          from: extraTop[0],
          to: prefix ? `${prefix}.${missingName}` : missingName,
        },
      };
    }
  }

  // --- 1. RENAME_FIELD: exactly one required field missing + exactly one unknown
  // key present with a compatible type.
  if (missing.length === 1 && extra.length === 1) {
    const missingField = missing[0].field;
    const extraField = extra[0];
    if (props[missingField] && typeMatches(actual ? actual[extraField] : undefined, props[missingField])) {
      const base = missing[0].basePath || '';
      const prefix = base === '' || base === '/' ? '' : base.replace(/^\//, '').replace(/\//g, '.');
      return {
        supported: true,
        kind: 'rename',
        evidence: { missingField, extraField, scope, httpStatus },
        rename: {
          from: prefix ? `${prefix}.${extraField}` : extraField,
          to: prefix ? `${prefix}.${missingField}` : missingField,
        },
      };
    }
  }

  // --- 2. MOVE_FIELD (nesting): expected object wrapper missing, inner field flat (or reverse).
  if (missing.length === 1 && actual && typeof actual === 'object') {
    const missingField = missing[0].field;
    const expectedProp = props[missingField];
    if (expectedProp && expectedProp.type === 'object' && expectedProp.properties) {
      const innerRequired = Array.isArray(expectedProp.required) ? expectedProp.required : Object.keys(expectedProp.properties);
      const flatMatches = innerRequired.filter((inner) =>
        Object.prototype.hasOwnProperty.call(actual, inner) &&
        typeMatches(actual[inner], expectedProp.properties[inner])
      );
      const nestedObj = actual[missingField];
      const nestedEmpty = nestedObj === undefined || nestedObj === null;
      if (flatMatches.length === 1 && innerRequired.length >= 1 && nestedEmpty) {
        return {
          supported: true,
          kind: 'move',
          evidence: { missingField, flatField: flatMatches[0], direction: 'nest', scope },
          move: { fromPath: flatMatches[0], toPath: `${missingField}.${flatMatches[0]}` },
        };
      }
    }
    // Reverse: schema expects flat field, actual nests it one level deep.
    for (const [wrapper, value] of Object.entries(actual)) {
      if (value && typeof value === 'object' && !Array.isArray(value) &&
        Object.prototype.hasOwnProperty.call(value, missingField) &&
        props[missingField] && typeMatches(value[missingField], props[missingField])) {
        const others = Object.keys(actual).filter((k) => k !== wrapper && !Object.prototype.hasOwnProperty.call(props, k));
        if (others.length === 0) {
          return {
            supported: true,
            kind: 'move',
            evidence: { missingField, wrapper, direction: 'flatten', scope },
            move: { fromPath: `${wrapper}.${missingField}`, toPath: missingField },
          };
        }
      }
    }
  }

  // --- 3. CONVERT_TYPE: exactly one type error on a present field, safely coercible.
  // (Includes structured downstream type evidence merged above.)
  if (typeErrors.length === 1 && missing.length === 0) {
    const e = typeErrors[0];
    const field = String(e.instancePath || '').replace(/^\//, '').replace(/\//g, '.');
    if (field && !field.includes('*')) {
      const value = getPath(actual, field);
      const expectedType = e.params && e.params.type;
      if (value !== undefined && expectedType && isCoercible(value, expectedType)) {
        return {
          supported: true,
          kind: 'convert',
          evidence: { field, fromType: jsonTypeOf(value), toType: expectedType, scope },
          convert: { field, toType: expectedType },
        };
      }
    }
  }

  // --- 4. ADD_HEADER: downstream explicitly names a missing required header AND
  // the tool registration configures a static value for it. Header values are
  // never invented — they must come from tool.headers.
  if (scope === 'request' && (httpStatus === 400 || httpStatus === 422)) {
    let text = '';
    try {
      text = typeof httpBody === 'string' ? httpBody : JSON.stringify(httpBody);
    } catch (_) { text = ''; }
    const m = /missing (?:required )?header\s*[:=]?\s*["']?([A-Za-z0-9_-]+)["']?|header\s+["']?([A-Za-z0-9_-]+)["']?\s+(?:is required|missing|required)/i.exec(text || '');
    const headerName = m ? (m[1] || m[2]) : null;
    if (headerName) {
      return {
        supported: true,
        kind: 'add_header',
        evidence: { headerName, scope },
        needsConfiguredValue: true,
      };
    }
  }

  // --- 5. Response-side rename uses the same single-missing/single-extra rule
  // (handled generically above since it only depends on schema+payload).

  const missingTopEmpty = missingTop.length === 0;
  const typeTopEmpty = !typeErrors.some((e) => (e.instancePath || '') === '');
  if (missingTopEmpty && typeTopEmpty && extraTop.length === 0) {
    // --- 5b. Nested recursion: no top-level evidence at all, but exactly one
    // nested object site (e.g. a response envelope like {data:{...}}) yields a
    // supported diagnosis. Multi-site or ambiguous children stay unsupported.
    // Depth-capped; only fires from a clean top level so existing ambiguous
    // verdicts are never weakened.
    if (depth < 2 && actual && typeof actual === 'object' && !Array.isArray(actual)) {
      const hits = [];
      for (const [k, propSchema] of Object.entries(props)) {
        if (!propSchema || typeof propSchema !== 'object' || propSchema.type !== 'object') continue;
        const childActual = actual[k];
        if (!childActual || typeof childActual !== 'object' || Array.isArray(childActual)) continue;
        const childErrors = (ajvErrors || [])
          .filter((e) => typeof e.instancePath === 'string' && (e.instancePath === `/${k}` || e.instancePath.startsWith(`/${k}/`)))
          .map((e) => ({ ...e, instancePath: e.instancePath.slice(k.length + 1) || '' }));
        const child = diagnose({ scope, knownSchema: propSchema, actual: childActual, ajvErrors: childErrors, httpStatus, httpBody: null, depth: depth + 1 });
        if (child.supported) hits.push({ key: k, diagnosis: child });
      }
      if (hits.length === 1) {
        const { key: k, diagnosis: child } = hits[0];
        const prefixOps = (obj) => {
          if (obj.rename) return { ...obj, rename: { from: `${k}.${obj.rename.from}`, to: `${k}.${obj.rename.to}` } };
          if (obj.move) return { ...obj, move: { fromPath: `${k}.${obj.move.fromPath}`, toPath: `${k}.${obj.move.toPath}` } };
          if (obj.convert) return { ...obj, convert: { ...obj.convert, field: `${k}.${obj.convert.field}` } };
          return obj;
        };
        const prefixed = prefixOps(child);
        return { ...prefixed, evidence: { ...(child.evidence || {}), nestedUnder: k, scope } };
      }
    }
    return { supported: false, kind: 'none', evidence: { scope }, reason: 'No schema differences detected.' };
  }
  return {
    supported: false,
    kind: 'ambiguous',
    evidence: {
      scope,
      missing: missing.map((m) => m.field),
      extra,
      typeErrors: typeErrors.map((e) => e.instancePath),
      httpStatus,
    },
    reason: 'Multiple or unsupported differences; refusing to guess.',
  };
}

// Bounded cache of compiled validators, keyed by canonical schema JSON.
// Schemas are versioned on every update, so content keys self-invalidate —
// a changed contract simply compiles once under its new key. Cap prevents
// unbounded growth when many distinct tools register.
const COMPILED_CACHE_MAX = 200;
const compiledCache = new Map();

function compiledValidator(schema) {
  const key = JSON.stringify(schema);
  let fn = compiledCache.get(key);
  if (fn) {
    // Refresh recency.
    compiledCache.delete(key);
    compiledCache.set(key, fn);
    return fn;
  }
  fn = ajv.compile(schema);
  compiledCache.set(key, fn);
  if (compiledCache.size > COMPILED_CACHE_MAX) {
    compiledCache.delete(compiledCache.keys().next().value);
  }
  return fn;
}

// Validate a payload against a schema, returning { valid, errors }.
function validateAgainst(schema, payload) {
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) {
    return { valid: true, errors: [] };
  }
  try {
    const fn = compiledValidator(schema);
    const valid = fn(payload);
    return { valid: !!valid, errors: fn.errors || [] };
  } catch (err) {
    return { valid: false, errors: [{ keyword: 'schema', message: `Invalid stored schema: ${err.message}` }] };
  }
}

module.exports = { diagnose, validateAgainst };
