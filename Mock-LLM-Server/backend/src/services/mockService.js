const { getScenario } = require('../mutations/driftScenarios');

const BASE_SCHEMA = {
  type: 'object',
  required: ['answer', 'model', 'usage'],
  properties: {
    answer: { type: 'string' },
    model: { type: 'string' },
    usage: {
      type: 'object',
      required: ['prompt_tokens', 'completion_tokens'],
      properties: {
        prompt_tokens: { type: 'integer' },
        completion_tokens: { type: 'integer' },
      },
    },
  },
};

function buildResponse({ prompt, scenarioName }) {
  const scenario = getScenario(scenarioName);
  if (!scenario) {
    const err = new Error(`Unknown drift scenario: ${scenarioName}`);
    err.status = 400;
    err.code = 'UNKNOWN_SCENARIO';
    throw err;
  }
  const base = {
    answer: `Mock reply to: ${prompt}`,
    model: 'mock-llm-1',
    usage: { prompt_tokens: String(prompt).length, completion_tokens: 8 },
    scenario: scenarioName || 'stable',
  };
  if (scenario.drift === 'renamed-field') {
    const { answer, ...rest } = base;
    return { data: { ...rest, reply: answer }, schema: { ...BASE_SCHEMA, note: 'drift: answer renamed to reply' } };
  }
  return { data: base, schema: BASE_SCHEMA };
}

module.exports = { buildResponse, BASE_SCHEMA };
