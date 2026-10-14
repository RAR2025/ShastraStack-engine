// Informed-mode notification: calls the engine's documented
// POST /v1/tools/:toolId/schema API with axios. Called ONLY when a judge
// explicitly passes notify:{toolId} — blind mode never notifies.
const axios = require('axios');

function engineBaseUrl(explicit) {
  const base = explicit || process.env.ENGINE_BASE_URL || 'http://localhost:4000';
  return String(base).replace(/\/+$/, '');
}

async function notifyEngine({ toolId, requestSchema, responseSchema, engineUrl }) {
  if (!toolId) return { notified: false, mode: 'blind', reason: 'No toolId supplied; engine not notified.' };
  const url = `${engineBaseUrl(engineUrl)}/v1/tools/${encodeURIComponent(toolId)}/schema`;
  try {
    const res = await axios.post(url, {
      downstreamSchema: requestSchema,
      responseSchema,
      actor: 'mock-admin',
    }, { timeout: 8000 });
    return { notified: true, mode: 'informed', engineStatus: res.status, engineBody: res.data };
  } catch (err) {
    const e = new Error(`Engine notification failed: ${err.message}`);
    e.status = 502;
    e.code = 'ENGINE_NOTIFY_FAILED';
    e.details = err.response ? { status: err.response.status, body: err.response.data } : undefined;
    throw e;
  }
}

// Reads the explicit opt-in only. Anything else is blind mode.
function notifySpecFrom(body) {
  if (body && body.notify && typeof body.notify === 'object' && typeof body.notify.toolId === 'string') {
    return { toolId: body.notify.toolId, engineUrl: body.notify.engineUrl };
  }
  return { toolId: null };
}

module.exports = { notifyEngine, notifySpecFrom, engineBaseUrl };
