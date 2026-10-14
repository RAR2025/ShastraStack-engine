const SENSITIVE_KEY = /password|passwd|secret|token|api[-_ ]?key|authorization|cookie|credential|private[-_ ]?key|session/i;

export function redactDeep(value, depth = 0) {
  if (depth > 12) return '…';
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '••• (redacted)' : redactDeep(v, depth + 1)]),
    );
  }
  return value;
}

export function toJson(value) {
  return JSON.stringify(redactDeep(value), null, 2);
}
