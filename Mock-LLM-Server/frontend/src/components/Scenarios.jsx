import React, { useEffect, useState } from 'react';
import { api, ENGINE_BASE_URL } from '../api.js';
import { Status, ErrorBox, Field } from './ui.jsx';

export default function Scenarios({ selected, notifyChange }) {
  const [scenarios, setScenarios] = useState([]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState(null);
  const [target, setTarget] = useState('customers');
  const [mode, setMode] = useState('blind');
  const [toolId, setToolId] = useState('customer-api');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);

  async function load() {
    setState('loading');
    try {
      const res = await api.listScenarios();
      setScenarios(res.data);
      setState('ready');
    } catch (e) { setError(e); setState('ready'); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { if (selected) setTarget(selected); }, [selected]);

  async function apply(scenarioId) {
    setBusy(scenarioId);
    setMsg(null);
    try {
      const body = { endpointId: target, appliedBy: 'console-judge' };
      if (mode === 'informed') {
        if (!toolId.trim()) throw new Error('Informed mode requires a toolId.');
        body.notify = { toolId: toolId.trim(), engineUrl: ENGINE_BASE_URL };
      }
      const res = await api.applyScenario(scenarioId, body);
      setMsg({ ok: true, text: `Applied ${scenarioId} to ${res.data.endpointId}: ${res.data.applied.length} mutation(s), schema v${res.data.schemaVersion} (${res.data.notification.mode}).` });
      notifyChange();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function resetAll() {
    setMsg(null);
    try {
      const list = await api.listEndpoints();
      for (const ep of list.data) {
        // eslint-disable-next-line no-await-in-loop
        await api.reset(ep.endpointId, {});
      }
      setMsg({ ok: true, text: 'All endpoints reset to baselines.' });
      notifyChange();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  }

  return (
    <section>
      <h2>Scenario Presets</h2>
      <p className="muted">Deterministic and repeatable: applying a preset resets the endpoint to baseline first. <code>unsupported-change</code> demonstrates safe engine rejection.</p>
      <ErrorBox error={error} />
      <div className="grid">
        <Field label="target endpoint"><input value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        <Field label="notification mode">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="blind">Blind</option>
            <option value="informed">Informed</option>
          </select>
        </Field>
        {mode === 'informed' ? (
          <Field label="toolId"><input value={toolId} onChange={(e) => setToolId(e.target.value)} /></Field>
        ) : null}
      </div>
      <Status state={state}>
        <ul className="list">
          {scenarios.map((s) => (
            <li key={s.scenarioId}>
              <div><strong>{s.scenarioId}</strong> — {s.title}</div>
              <div className="muted">{s.description}</div>
              <button disabled={busy === s.scenarioId} onClick={() => apply(s.scenarioId)}>
                {busy === s.scenarioId ? 'Applying…' : 'Apply preset'}
              </button>
            </li>
          ))}
        </ul>
      </Status>
      {msg ? <p className={msg.ok ? 'ok' : 'fail'}>{msg.text}</p> : null}
      <button className="danger" onClick={resetAll}>Reset ALL endpoints to baselines</button>
    </section>
  );
}
