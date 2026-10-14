import React, { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { backendApi } from '../api/backend.js';
import { apiErrorMessage } from '../api/client.js';
import { Page, DataState, JsonBlock, Field, Pagination, Badge } from '../components/ui.jsx';

const STATUSES = ['', 'success', 'recovered', 'failed', 'client_error'];

export function LogList() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ toolId: '', status: '', classification: '', from: '', to: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = { page: p, pageSize: 15 };
      if (filters.toolId.trim()) params.toolId = filters.toolId.trim();
      if (filters.status) params.status = filters.status;
      const res = await backendApi.logs(params);
      let data = res.data || [];
      // Client-side refinements the API doesn't filter: classification + date range.
      if (filters.classification.trim()) {
        const q = filters.classification.trim().toLowerCase();
        data = data.filter((r) => (r.classification || '').toLowerCase().includes(q));
      }
      if (filters.from) data = data.filter((r) => r.created_at && r.created_at >= filters.from);
      if (filters.to) data = data.filter((r) => r.created_at && r.created_at <= filters.to + 'T23:59:59Z');
      setRows(data);
      setTotal(res.total || 0);
      setPage(res.page || p);
      setLoading(false);
    } catch (err) {
      setError(apiErrorMessage(err));
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(1); }, []);

  return (
    <Page title="Logs" subtitle="Persistent execution logs via the Application backend (sourced from ShastraStack). Secrets are redacted.">
      <form className="filters" onSubmit={(e) => { e.preventDefault(); load(1); }}>
        <Field label="Tool ID"><input value={filters.toolId} onChange={(e) => setFilters({ ...filters, toolId: e.target.value })} placeholder="optional" /></Field>
        <Field label="Status">
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || '(any)'}</option>)}
          </select>
        </Field>
        <Field label="Error type (classification contains)"><input value={filters.classification} onChange={(e) => setFilters({ ...filters, classification: e.target.value })} placeholder="e.g. SCHEMA_DRIFT" /></Field>
        <Field label="From date"><input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Field>
        <Field label="To date"><input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Field>
        <button type="submit">Apply filters</button>
      </form>
      <DataState loading={loading} error={error} empty={rows.length === 0} onRetry={() => load(page)}>
        <ul className="list">
          {rows.map((r) => (
            <li key={r.execution_id}>
              <Link to={`/logs/${r.execution_id}`}><code>{r.execution_id}</code></Link>{' '}
              <Badge tone={r.status === 'failed' || r.status === 'client_error' ? 'bad' : r.status === 'recovered' ? 'warn' : 'ok'}>{r.status}</Badge>{' '}
              <span className="muted">{r.tool_ref} · {r.classification || '—'} · retries {r.retry_count} · {r.duration_ms} ms · {r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
            </li>
          ))}
        </ul>
        <Pagination page={page} pageSize={15} total={total} onPage={(p) => load(p)} />
      </DataState>
    </Page>
  );
}

export function LogTrace() {
  const { executionId } = useParams();
  const [trace, setTrace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    backendApi.trace(executionId).then(
      (res) => { setTrace(res.data); setLoading(false); },
      (err) => { setError(apiErrorMessage(err)); setLoading(false); },
    );
  }, [executionId]);

  return (
    <Page title={`Trace ${executionId}`} subtitle="Complete execution trace with patch details.">
      <DataState loading={loading} error={error} onRetry={() => window.location.reload()}>
        {trace ? (
          <>
            <JsonBlock title="Execution (payloads redacted)" value={trace.execution} />
            <h3>Audit events</h3>
            {trace.auditEvents?.length ? (
              <ul className="list small">
                {trace.auditEvents.map((a) => (
                  <li key={a.id}><code>{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</code> <strong>{a.action}</strong> <span className="muted">{a.actor} · {a.entity} {a.entity_id}</span></li>
                ))}
              </ul>
            ) : <p className="muted">No audit events.</p>}
            <h3>Patches (including rejected & rolled back)</h3>
            {trace.patches?.length ? trace.patches.map((p) => (
              <div key={p.patch_id} className="card">
                <p><code>{p.patch_id}</code> <Badge tone={p.status === 'committed' ? 'ok' : 'bad'}>{p.status}</Badge></p>
                <JsonBlock title="Diagnosis" value={p.diagnosis} />
                <JsonBlock title="Operations" value={p.operations} />
                {p.error ? <div className="alert error">{p.error}</div> : null}
              </div>
            )) : <p className="muted">No patches for this execution.</p>}
          </>
        ) : null}
      </DataState>
    </Page>
  );
}
