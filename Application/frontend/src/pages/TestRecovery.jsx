import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { backendApi } from '../api/backend.js';
import { mockApi } from '../api/mock.js';
import { apiErrorMessage, apiErrorCode } from '../api/client.js';
import { Page, DataState, JsonBlock, Field, Badge } from '../components/ui.jsx';

export default function TestRecovery() {
  const [tools, setTools] = useState([]);
  const [toolId, setToolId] = useState('');
  const [payload, setPayload] = useState('{\n  "name": "Ada",\n  "email": "ada@example.com"\n}');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [resultError, setResultError] = useState(null);
  const [trace, setTrace] = useState(null);
  const [traceState, setTraceState] = useState('idle');
  const [baseline, setBaseline] = useState(null);
  const [baselineState, setBaselineState] = useState('idle');
  const [tool, setTool] = useState(null);

  useEffect(() => {
    backendApi.listTools({ page: 1, pageSize: 100 }).then(
      (res) => {
        setTools(res.data || []);
        if (res.data?.length) setToolId(res.data[0].toolId);
      },
      () => {},
    );
  }, []);

  useEffect(() => {
    if (!toolId) return;
    backendApi.getTool(toolId).then((res) => setTool(res.data), () => setTool(null));
  }, [toolId]);

  async function run(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    setResultError(null);
    setTrace(null);
    setTraceState('idle');
    setBaseline(null);
    setBaselineState('idle');
    let parsed;
    try {
      parsed = payload.trim() ? JSON.parse(payload) : {};
    } catch {
      setResultError('Payload must be valid JSON');
      setBusy(false);
      return;
    }
    const started = performance.now();
    try {
      const body = { input: parsed };
      if (idempotencyKey.trim()) body.idempotencyKey = idempotencyKey.trim();
      const res = await backendApi.executeTool(toolId, body);
      setResult({ ...res, clientMs: Math.round(performance.now() - started) });
      if (res.executionId) loadTrace(res.executionId);
    } catch (err) {
      setResultError(`${apiErrorCode(err)}: ${apiErrorMessage(err)}`);
      const execId = err?.response?.data?.executionId;
      if (execId) loadTrace(execId);
      setBusy(false);
    }
  }

  async function loadTrace(executionId) {
    setTraceState('loading');
    try {
      const res = await backendApi.trace(executionId);
      setTrace(res.data);
      setTraceState('ready');
    } catch {
      setTraceState('idle');
    } finally {
      setBusy(false);
    }
  }

  async function runBaseline() {
    if (!tool) return;
    setBaselineState('loading');
    try {
      const res = await mockApi.callDirect(tool.method || 'POST', tool.path, payload.trim() ? JSON.parse(payload) : {});
      setBaseline({ ok: true, body: res });
      setBaselineState('ready');
    } catch (err) {
      setBaseline({ ok: false, error: `${apiErrorCode(err)}: ${apiErrorMessage(err)}` });
      setBaselineState('ready');
    }
  }

  const patch = trace?.patches?.[0];
  const exec = trace?.execution;

  return (
    <Page title="Test & Recovery" subtitle="Execute a payload through ShastraStack and inspect the full recovery trail.">
      <form onSubmit={run} className="grid">
        <Field label="Registered tool">
          <select value={toolId} onChange={(e) => setToolId(e.target.value)}>
            {tools.map((t) => <option key={t.toolId} value={t.toolId}>{t.toolId}</option>)}
          </select>
        </Field>
        <Field label="Request payload (JSON)">
          <textarea rows={8} value={payload} onChange={(e) => setPayload(e.target.value)} />
        </Field>
        <Field label="Idempotency key (optional)" hint="Required before the engine retries non-idempotent writes">
          <input value={idempotencyKey} onChange={(e) => setIdempotencyKey(e.target.value)} placeholder="e.g. judge-run-1" />
        </Field>
        <div className="row">
          <button type="submit" disabled={busy || !toolId}>{busy ? 'Executing…' : 'Execute via ShastraStack'}</button>
          <button type="button" onClick={runBaseline} disabled={!tool}>Run baseline (direct mock)</button>
        </div>
      </form>

      {resultError && !result ? <div className="alert error" role="alert">{resultError}</div> : null}

      {result ? (
        <div className="card">
          <h3>Result <Badge tone={result.status === 'recovered' ? 'warn' : result.status === 'success' ? 'ok' : 'bad'}>{result.status}</Badge></h3>
          <p className="muted">
            Execution <code>{result.executionId}</code> · client round-trip {result.clientMs} ms · engine duration {result.durationMs ?? '—'} ms
            {result.classification ? <> · classification <code>{result.classification}</code></> : null}
          </p>
          <JsonBlock title="HTTP response data" value={result.data} />
          {result.recovery ? <JsonBlock title="Recovery (patch committed, retried in memory)" value={result.recovery} /> : null}
        </div>
      ) : null}

      <DataState loading={traceState === 'loading'} empty={false}>
        {trace ? (
          <div className="card">
            <h3>Execution trace <span className="muted">{exec?.execution_id}</span></h3>
            <p className="muted">
              {exec?.created_at ? new Date(exec.created_at).toLocaleString() : ''} → {exec?.finished_at ? new Date(exec.finished_at).toLocaleString() : ''} ·
              status <code>{exec?.status}</code> · retries {exec?.retry_count ?? 0} · recovery <code>{exec?.recovery_result || 'none'}</code>
            </p>
            <div className="cols">
              <JsonBlock title="Original request (secrets redacted)" value={exec?.request_body} />
              <JsonBlock title="Transformed downstream request" value={exec?.downstream_request} />
            </div>
            <JsonBlock title="Downstream response" value={exec?.downstream_response} />
            {exec?.error ? <div className="alert error" role="alert">{exec.error}</div> : null}
            <h4>Detected schema difference</h4>
            {patch?.diagnosis ? <JsonBlock value={patch.diagnosis} /> : <p className="muted">No diagnosis recorded (no drift detected or client-side error).</p>}
            <h4>Proposed patch & validation decision</h4>
            {patch ? (
              <>
                <JsonBlock title={`Operations — ${patch.status}`} value={patch.operations} />
                <p>
                  <Badge tone={patch.status === 'committed' ? 'ok' : 'bad'}>{patch.status}</Badge>{' '}
                  <span className="muted">
                    adapter v{patch.adapter_version_before} → v{patch.adapter_version_after}
                    {patch.error ? ` · ${patch.error}` : ' · transformed payload validated before commit'}
                  </span>
                </p>
              </>
            ) : <p className="muted">No patch proposed.</p>}
            <p className="muted">
              In-memory application: {exec?.status === 'recovered' ? 'candidate applied, retry verified, then committed' : 'no candidate committed'}
              {' '}· Rollback outcome: {patch && patch.status !== 'committed' ? 'rolled back — adapter untouched' : patch ? 'committed after verification' : 'n/a'}
              {' '}· Recovery duration: {exec?.duration_ms ?? '—'} ms
            </p>
            <p><Link to={`/logs/${exec?.execution_id}`}>Open full trace in Logs →</Link></p>
          </div>
        ) : null}
      </DataState>

      {baselineState !== 'idle' ? (
        <div className="card">
          <h3>Baseline comparison <Badge>direct mock path</Badge></h3>
          <p className="muted">Same payload sent straight to the mock API, bypassing ShastraStack — for controlled comparison only.</p>
          {baselineState === 'loading' ? <p className="muted">Calling mock…</p>
            : baseline?.ok ? <JsonBlock title="Mock response" value={baseline.body} />
            : <div className="alert error" role="alert">{baseline?.error}</div>}
        </div>
      ) : null}
    </Page>
  );
}
