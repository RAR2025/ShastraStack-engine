// Deterministic drift scenarios for hackathon demos.
// Foundation ships: stable + renamed-field. More scenarios land with self-healing tests.
const SCENARIOS = {
  stable: { drift: null, description: 'Baseline stable schema' },
  'renamed-field': { drift: 'renamed-field', description: 'Response renames `answer` to `reply`' },
};

function getScenario(name) {
  return SCENARIOS[name || 'stable'] || null;
}

function listScenarios() {
  return Object.entries(SCENARIOS).map(([name, s]) => ({ name, ...s }));
}

module.exports = { SCENARIOS, getScenario, listScenarios };
