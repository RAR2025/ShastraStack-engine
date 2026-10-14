// Small JSON-path helpers (dot-separated). No external deps.
function parsePath(path) {
  if (typeof path !== 'string' || path.length === 0) throw new Error('path must be a non-empty string');
  return path.split('.').filter((s) => s.length > 0);
}

function getPath(obj, path) {
  const parts = Array.isArray(path) ? path : parsePath(path);
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function hasPath(obj, path) {
  const parts = Array.isArray(path) ? path : parsePath(path);
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(cur, p)) return false;
    cur = cur[p];
  }
  return true;
}

function setPath(obj, path, value) {
  const parts = Array.isArray(path) ? path : parsePath(path);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (cur[p] === null || cur[p] === undefined || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

function deletePath(obj, path) {
  const parts = Array.isArray(path) ? path : parsePath(path);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (cur[p] === null || cur[p] === undefined || typeof cur[p] !== 'object') return false;
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  if (cur !== null && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, last)) {
    delete cur[last];
    return true;
  }
  return false;
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function jsonTypeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  const t = typeof value;
  if (t === 'number') return 'number';
  if (t === 'string') return 'string';
  if (t === 'boolean') return 'boolean';
  if (t === 'object') return 'object';
  return t;
}

module.exports = { parsePath, getPath, hasPath, setPath, deletePath, deepClone, jsonTypeOf };
