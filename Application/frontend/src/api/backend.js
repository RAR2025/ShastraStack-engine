import { backend } from './client.js';

const unwrap = (p) => p.then((r) => r.data);

export const backendApi = {
  health: () => unwrap(backend.get('/health')),
  ready: () => unwrap(backend.get('/ready')),
  engineHealth: () => unwrap(backend.get('/api/engine/health')),
  dashboard: () => unwrap(backend.get('/api/dashboard')),

  listTools: (params) => unwrap(backend.get('/api/tools', { params })),
  registerTool: (body) => unwrap(backend.post('/api/tools', body)),
  getTool: (toolId) => unwrap(backend.get(`/api/tools/${encodeURIComponent(toolId)}`)),
  patchTool: (toolId, body) => unwrap(backend.patch(`/api/tools/${encodeURIComponent(toolId)}`, body)),
  deleteTool: (toolId) => unwrap(backend.delete(`/api/tools/${encodeURIComponent(toolId)}`)),
  executeTool: (toolId, body) => unwrap(backend.post(`/api/tools/${encodeURIComponent(toolId)}/execute`, body)),

  logs: (params) => unwrap(backend.get('/api/logs', { params })),
  trace: (executionId) => unwrap(backend.get(`/api/logs/${encodeURIComponent(executionId)}`)),
  patches: (params) => unwrap(backend.get('/api/patches', { params })),
  patch: (patchId) => unwrap(backend.get(`/api/patches/${encodeURIComponent(patchId)}`)),

  metricsSummary: () => unwrap(backend.get('/api/metrics/summary')),
  metricsExecutions: (params) => unwrap(backend.get('/api/metrics/executions', { params })),
};
