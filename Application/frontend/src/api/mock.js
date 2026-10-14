import { mock, MOCK_ADMIN_TOKEN } from './client.js';

const unwrap = (p) => p.then((r) => r.data);
const adminHeaders = () => (MOCK_ADMIN_TOKEN ? { 'x-admin-token': MOCK_ADMIN_TOKEN } : {});

export const mockApi = {
  hasToken: () => Boolean(MOCK_ADMIN_TOKEN),
  listEndpoints: () => unwrap(mock.get('/api/admin/endpoints', { headers: adminHeaders() })),
  getSchema: (endpointId) =>
    unwrap(mock.get(`/api/admin/endpoints/${encodeURIComponent(endpointId)}/schema`, { headers: adminHeaders() })),
  listScenarios: () => unwrap(mock.get('/api/admin/scenarios', { headers: adminHeaders() })),
  applyScenario: (scenarioId, body) =>
    unwrap(mock.post(`/api/admin/scenarios/${encodeURIComponent(scenarioId)}/apply`, body, { headers: adminHeaders() })),
  mutate: (endpointId, body) =>
    unwrap(mock.post(`/api/admin/endpoints/${encodeURIComponent(endpointId)}/mutations`, body, { headers: adminHeaders() })),
  resetEndpoint: (endpointId, body = {}) =>
    unwrap(mock.post(`/api/admin/endpoints/${encodeURIComponent(endpointId)}/reset`, body, { headers: adminHeaders() })),
  // Direct baseline call to a simulated endpoint (public surface, no token).
  callDirect: (method, path, data) => unwrap(mock.request({ method, url: path, data })),
};
