// Single API client for the judging console. Service URLs come from env only.
import axios from 'axios';

export const MOCK_API_URL = import.meta.env.VITE_MOCK_API_URL || 'http://localhost:5000';
export const ENGINE_BASE_URL = import.meta.env.VITE_ENGINE_BASE_URL || 'http://localhost:4000';
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || 'local-dev-token';

const admin = axios.create({
  baseURL: MOCK_API_URL,
  headers: { 'x-admin-token': ADMIN_TOKEN, 'Content-Type': 'application/json' },
  timeout: 15000,
});

const pub = axios.create({ baseURL: MOCK_API_URL, timeout: 15000 });

function unwrap(promise) {
  return promise.then((r) => r.data).catch((e) => {
    const err = new Error(e.response?.data?.error?.message || e.message);
    err.status = e.response?.status || 0;
    err.details = e.response?.data?.error;
    throw err;
  });
}

export const api = {
  health: () => unwrap(pub.get('/health')),
  // endpoints
  listEndpoints: () => unwrap(admin.get('/api/admin/endpoints')),
  getEndpoint: (id) => unwrap(admin.get(`/api/admin/endpoints/${encodeURIComponent(id)}`)),
  createEndpoint: (body) => unwrap(admin.post('/api/admin/endpoints', body)),
  patchEndpoint: (id, body) => unwrap(admin.patch(`/api/admin/endpoints/${encodeURIComponent(id)}`, body)),
  deleteEndpoint: (id) => unwrap(admin.delete(`/api/admin/endpoints/${encodeURIComponent(id)}`)),
  getSchema: (id) => unwrap(admin.get(`/api/admin/endpoints/${encodeURIComponent(id)}/schema`)),
  // mutations + reset
  mutate: (id, body) => unwrap(admin.post(`/api/admin/endpoints/${encodeURIComponent(id)}/mutations`, body)),
  reset: (id, body = {}) => unwrap(admin.post(`/api/admin/endpoints/${encodeURIComponent(id)}/reset`, body)),
  // response simulator + failure injection
  setResponse: (id, body) => unwrap(admin.put(`/api/admin/endpoints/${encodeURIComponent(id)}/response`, body)),
  setFailure: (id, body) => unwrap(admin.put(`/api/admin/endpoints/${encodeURIComponent(id)}/failure`, body)),
  // scenarios
  listScenarios: () => unwrap(admin.get('/api/admin/scenarios')),
  applyScenario: (scenarioId, body) => unwrap(admin.post(`/api/admin/scenarios/${encodeURIComponent(scenarioId)}/apply`, body)),
  // history
  activity: (limit = 50) => unwrap(admin.get('/api/admin/activity', { params: { limit } })),
  mutations: (endpointId, limit = 50) => unwrap(admin.get('/api/admin/mutations', { params: { endpointId, limit } })),
  ops: () => unwrap(admin.get('/api/admin/ops')),
  // simulated business call (public surface, optional extra headers)
  tryEndpoint: (method, path, body, headers = {}) =>
    unwrap(pub.request({ method: method.toLowerCase(), url: path, data: body, headers })),
};
