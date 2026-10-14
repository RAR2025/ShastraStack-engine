import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { backendApi } from '../api/backend.js';
import { mockApi } from '../api/mock.js';
import { MOCK_STUDIO_URL } from '../api/client.js';
import { apiErrorMessage } from '../api/client.js';
import { Page, DataState, JsonBlock, Field, SchemaDiff, Badge } from '../components/ui.jsx';

export default function SchemaLab() {
  const [tools, setTools] = useState([]);
  const [toolId, setToolId] = useState('');
  const [tool, setTool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [scenarios, setScenarios] = useState([]);
  const [scenarioId, setScenarioId] = useState('');
  const [mode, setMode] = useState('blind');
  const [notifyToolId, setNotifyToolId] = useState('');
  const [actionMsg, setActionMsg] = useState(null);
  const [actionErr, setActionErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mockSchema, setMockSchema] = useState(null);
  const mockToken = mockApi.hasToken();

  const loadTools = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [toolRes, scenRes] = await Promise.all([
        backendApi.listTools({ page: 1, pageSize: 100 }),
        mockApi.listScenarios().catch(() => ({ data: [] })),
      ]);
      setTools(toolRes.data || []);
      if (toolRes.data?.length && !toolId) setToolId(toolRes.data[0].toolId);
      setScenarios(scenRes.data || []);
      if (scenRes.data?.length && !scenarioId) setScenarioId(scenRes.data[0].scenarioId || scenRes.data[0].id);
      setLoading(false);
    } catch (err) {
      setError(apiErrorMessage(err));
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTools(); }, [loadTools]);

  const loadTool = useCallback(async () => {
    if (!toolId) return;
    try {
      const res = await backendApi.getTool(toolId);
      setTool(res.data);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }, [toolId]);

  useEffect(() => { loadTool(); }, [loadTool]);

  async function refreshMockSchema(endpointId) {
    try {
      const res = await mockApi.getSchema(endpointId || 'customers');
      setMockSchema(res.data);
    } catch {
      setMockSchema(null);
    }
  }

  useEffect(() => { refreshMockSchema('customers'); }, []);

  async function applyScenario(e) {
    e.preventDefault();
    setActionMsg(null);
    setActionErr(null);
    setBusy(true);
    try {
      const body = { endpointId: 'customers' };
      if (mode === 'informed') {
        if (!notifyToolId.trim()) throw new Error('Informed mode requires the engine toolId to notify.');
        body.notify = { toolId: notifyToolId.trim() };
      }
      // Blind: no notify field — the mock mutates silently and reports notified=false.
      const res = await mockApi.applyScenario(scenarioId, body);
      const n = res.data?.notification;
      if (mode === 'blind') {
        setActionMsg(
          `Scenario applied on the mock (schema v${res.data?.schemaVersion}). Engine notified: ${n?.notified === true ? 'YES — unexpected' : 'no (correct blind behavior)'}.`,
        );
      } else {
        setActionMsg(
          n?.notified
            ? `Scenario applied and engine tool “${notifyToolId.trim()}” notified (schema v${res.data?.schemaVersion}).`
            : 'Scenario applied on the mock, but the engine reported notified=false — verify the toolId.',
        );
      }
      await loadTool();
      await refreshMockSchema('customers');
    } catch (err) {
      setActionErr(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Schema Lab" subtitle="Compare client vs downstream contracts and drive mock mutations in either mode.">
      <DataState loading={loading} error={error} onRetry={loadTools}>
        <div className="grid">
          <Field label="Registered tool">
            <select value={toolId} onChange={(e) => setToolId(e.target.value)}>
              {tools.map((t) => <option key={t.toolId} value={t.toolId}>{t.toolId}</option>)}
            </select>
          </Field>
        </div>
        {tool ? (
          <>
            <p>
              <Badge>v{tool.version}</Badge> <Badge>downstream v{tool.downstreamVersion}</Badge>{' '}
              <Badge>{tool.method} {tool.path}</Badge>
            </p>
            <SchemaDiff before={tool.clientSchema} after={tool.downstreamSchema} />
            <div className="cols">
              <JsonBlock title="Client schema (stable contract)" value={tool.clientSchema} />
              <JsonBlock title="Downstream schema (known external contract)" value={tool.downstreamSchema} />
            </div>
            <JsonBlock title="Response schema" value={tool.responseSchema} />
          </>
        ) : null}

        <h2>Mutation scenario</h2>
        {!mockToken ? (
          <div className="alert error" role="alert">
            No <code>VITE_MOCK_ADMIN_TOKEN</code> configured — scenario controls are disabled.
            The mock still works from the <a href={MOCK_STUDIO_URL} target="_blank" rel="noreferrer">Mock API Studio</a>.
          </div>
        ) : null}
        <form onSubmit={applyScenario} className="grid">
          <Field label="Scenario">
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
              {scenarios.map((s) => (
                <option key={s.scenarioId || s.id} value={s.scenarioId || s.id}>
                  {s.scenarioId || s.id} — {s.title || s.description}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mode">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="blind">Blind — mutate silently, engine must detect</option>
              <option value="informed">Informed — notify the engine via its schema API</option>
            </select>
          </Field>
          {mode === 'informed' ? (
            <Field label="Engine toolId to notify" hint="Sent as notify.toolId to the mock">
              <input value={notifyToolId} onChange={(e) => setNotifyToolId(e.target.value)} placeholder="e.g. customers" />
            </Field>
          ) : null}
          <button type="submit" disabled={busy || !mockToken}>{busy ? 'Applying…' : mode === 'blind' ? 'Apply blind scenario on mock' : 'Apply informed scenario'}</button>
        </form>
        {actionMsg ? <div className="alert ok" role="status">{actionMsg}</div> : null}
        {actionErr ? <div className="alert error" role="alert">{actionErr}</div> : null}
        {mode === 'blind' ? (
          <p className="muted">
            Blind mode performs the mutation on the mock server <em>without</em> any engine
            notification — this UI never claims otherwise. Apply it in the{' '}
            <a href={MOCK_STUDIO_URL} target="_blank" rel="noreferrer">Mock API Studio</a>,
            then run the payload in <Link to="/test">Test &amp; Recovery</Link> to watch detection.
          </p>
        ) : null}
        {mockSchema ? <JsonBlock title="Mock active schema (customers)" value={mockSchema} /> : null}
        <p>
          <a className="btn" href={MOCK_STUDIO_URL} target="_blank" rel="noreferrer">Open Mock API Studio ↗</a>
        </p>
      </DataState>
    </Page>
  );
}
