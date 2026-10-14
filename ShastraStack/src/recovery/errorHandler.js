// Failure classification. Schema drift is ONE category among many and is only
// a candidate when the evidence supports it. Auth, 404, conflicts, rate limits,
// network errors, timeouts, and arbitrary 5xx are NEVER patched as drift.
const SCHEMA_SIGNAL_RE =
  /unknown field|unexpected|additional propert|required|missing|must have|must be|must not|invalid type|expected|schema|validation|not allowed/i;

function parseRetryAfterMs(headers) {
  if (!headers) return null;
  const raw = headers['retry-after'] || headers['Retry-After'];
  if (raw === undefined || raw === null) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.min(secs, 3600) * 1000;
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, Math.min(date - Date.now(), 3600 * 1000));
  return null;
}

function bodyText(body) {
  try {
    if (body === null || body === undefined) return '';
    return typeof body === 'string' ? body : JSON.stringify(body);
  } catch (_) {
    return '';
  }
}

// Input: { stage, httpStatus, httpBody, httpHeaders, ajvErrors, axiosCode }
// stage: 'client_validation' | 'request_validation' | 'downstream' | 'response_validation'
function classifyFailure(input = {}) {
  const { stage, httpStatus = 0, httpBody = null, httpHeaders = {}, ajvErrors = [] } = input;

  if (stage === 'client_validation') {
    return {
      category: 'USER_INPUT_ERROR',
      patchable: false,
      retryable: false,
      reason: 'Client input failed clientSchema validation; fix the caller payload, not the adapter.',
    };
  }

  if (stage === 'request_validation') {
    // Transformed request does not match the KNOWN downstream schema without any
    // downstream evidence yet. Treat as drift candidate only when ajv details exist.
    if (Array.isArray(ajvErrors) && ajvErrors.length > 0) {
      return {
        category: 'SCHEMA_DRIFT_CANDIDATE',
        patchable: true,
        retryable: true,
        reason: 'Adapted request fails known downstream schema; drift will be diagnosed from evidence.',
      };
    }
    return { category: 'UNKNOWN', patchable: false, retryable: false, reason: 'Unclassified request failure.' };
  }

  if (stage === 'response_validation') {
    return {
      category: 'SCHEMA_DRIFT_CANDIDATE',
      patchable: true,
      retryable: true,
      reason: 'Downstream 2xx response fails the registered responseSchema.',
    };
  }

  // stage === 'downstream' (HTTP / network outcome)
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      category: 'AUTH_ERROR',
      patchable: false,
      retryable: false,
      reason: `Downstream returned ${httpStatus}; credentials/permissions are never patched as schema drift.`,
    };
  }
  if (httpStatus === 404) {
    return {
      category: 'NOT_FOUND',
      patchable: false,
      retryable: false,
      reason: 'Downstream resource not found; not schema drift.',
    };
  }
  if (httpStatus === 409) {
    return {
      category: 'CONFLICT',
      patchable: false,
      retryable: false,
      reason: 'Downstream business conflict; never invent business data to resolve it.',
    };
  }
  if (httpStatus === 429) {
    return {
      category: 'RATE_LIMITED',
      patchable: false,
      retryable: false,
      reason: 'Downstream rate limit; honor Retry-After instead of patching.',
      retryAfterMs: parseRetryAfterMs(httpHeaders),
    };
  }
  if (httpStatus === 0) {
    const code = input.axiosCode || '';
    if (code === 'ECONNABORTED' || /timeout/i.test(input.axiosMessage || '')) {
      return { category: 'TIMEOUT', patchable: false, retryable: false, reason: 'Downstream request timed out; timeouts are not auto-patched.' };
    }
    return { category: 'NETWORK_ERROR', patchable: false, retryable: false, reason: 'Network error reaching downstream; not schema drift.' };
  }
  if (httpStatus >= 500) {
    return {
      category: 'SERVER_ERROR',
      patchable: false,
      retryable: false,
      reason: `Downstream server error ${httpStatus}; arbitrary 5xx is never auto-patched.`,
    };
  }
  if (httpStatus === 400 || httpStatus === 422) {
    const text = bodyText(httpBody);
    if ((Array.isArray(ajvErrors) && ajvErrors.length > 0) || SCHEMA_SIGNAL_RE.test(text)) {
      return {
        category: 'SCHEMA_DRIFT_CANDIDATE',
        patchable: true,
        retryable: true,
        reason: `Downstream ${httpStatus} carries schema-validation signals.`,
      };
    }
    return {
      category: 'DOWNSTREAM_REJECTED',
      patchable: false,
      retryable: false,
      reason: `Downstream ${httpStatus} without schema evidence; returning truthful failure.`,
    };
  }
  return { category: 'UNKNOWN', patchable: false, retryable: false, reason: `Unclassified downstream status ${httpStatus}.` };
}

module.exports = { classifyFailure, parseRetryAfterMs };
