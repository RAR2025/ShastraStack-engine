// Shared secret redaction. Execution itself always uses real values; only
// what is persisted (executions, audit events, outbox) or served back is
// scrubbed, so traces and logs can never leak credentials or secrets.
const SENSITIVE_KEY = /password|passwd|secret|token|api[-_ ]?key|authorization|cookie|credential|private[-_ ]?key|session/i;

function redactSensitive(value, depth = 0) {
  if (depth > 12) return '[redacted]';
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[redacted]' : redactSensitive(v, depth + 1)])
    );
  }
  return value;
}

function hasSensitiveKey(value) {
  if (Array.isArray(value)) return value.some(hasSensitiveKey);
  if (value && typeof value === 'object') {
    return Object.keys(value).some((k) => SENSITIVE_KEY.test(k)) || Object.values(value).some(hasSensitiveKey);
  }
  return false;
}

module.exports = { SENSITIVE_KEY, redactSensitive, hasSensitiveKey };
