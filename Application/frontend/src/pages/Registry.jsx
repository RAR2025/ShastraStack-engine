import React, { useCallback, useEffect, useState } from 'react';
import { backendApi } from '../api/backend.js';
import { apiErrorMessage, MOCK_API_URL } from '../api/client.js';
import { Page, DataState, JsonBlock, Field, Pagination } from '../components/ui.jsx';

const EMPTY_FORM = {
  toolId: '', baseUrl: MOCK_API_URL, method: 'POST', path: '/api/customers',
  clientSchema: '{\n  "type": "object",\n  "required": ["name", "email"],\n  "properties": {\n    "name": { "type": "string" },\n    "email": { "type": "string" }\n  }\n}',
  downstreamSchema: '',
  responseSchema: '{\n  "type": "object",\n  "required": ["id"],\n  "properties": { "id": { "type": "string" } }\n}',
  timeoutMs: '5000', headers: '{}', credentialRef: '',
  recoveryPolicy: '{\n  "maxRetries": 1,\n  "allowAutomaticPatch": true\n}',
};

function parseJsonField(text, name, required) {
  if (!text.trim()) {
    if (required) throw new Error(`${name} must be valid JSON`);
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
}

export default function Registry() {
  const [tools, setTools] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [formOk, setFormOk] = useState(null);
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    setError(null);
    try {
      const res = await backendApi.listTools({ page: p, pageSize: 10 });
      setTools(res.data || []);
      setTotal(res.total || 0);
      setPage(res.page || p);
      setLoading(false);
    } catch (err) {
      setError(apiErrorMessage(err));
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(1); }, []);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e) {
    e.preventDefault();
    setFormError(null);
    setFormOk(null);
    try {
      const body = {
        toolId: form.toolId.trim(),
        baseUrl: form.baseUrl.trim(),
        method: form.method,
        path: form.path.trim(),
        clientSchema: parseJsonField(form.clientSchema, 'clientSchema', true),
        responseSchema: parseJsonField(form.responseSchema, 'responseSchema', false),
        timeoutMs: Number(form.timeoutMs),
        headers: parseJsonField(form.headers || '{}', 'headers', true),
        recoveryPolicy: parseJsonField(form.recoveryPolicy || '{}', 'recoveryPolicy', true),
      };
      const downstream = parseJsonField(form.downstreamSchema, 'downstreamSchema', false);
      if (downstream !== undefined) body.downstreamSchema = downstream;
      if (!form.credentialRef.trim()) delete body.credentialRef;
      else body.credentialRef = form.credentialRef.trim();
      if (!Number.isInteger(body.timeoutMs) || body.timeoutMs <= 0) throw new Error('timeoutMs must be a positive integer');
      const res = await backendApi.registerTool(body);
      setFormOk(`Registered ${res.data.toolId} (version ${res.data.version}).`);
      setForm(EMPTY_FORM);
      load(1);
    } catch (err) {
      setFormError(apiErrorMessage(err));
    }
  }

  async function inspect(toolId) {
    try {
      const res = await backendApi.getTool(toolId);
      setDetail(res.data);
      setEditing(null);
    } catch (err) {
      setFormError(apiErrorMessage(err));
    }
  }

  async function remove(toolId) {
    if (!window.confirm(`Unregister tool ${toolId}?`)) return;
    try {
      await backendApi.deleteTool(toolId);
      setDetail(null);
      load(page);
    } catch (err) {
      setFormError(apiErrorMessage(err));
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    try {
      const res = await backendApi.patchTool(editing.toolId, {
        expectedVersion: editing.version,
        timeoutMs: Number(editing.timeoutMs),
        headers: JSON.parse(editing.headers),
        recoveryPolicy: JSON.parse(editing.recoveryPolicy),
      });
      setDetail(res.data);
      setEditing(null);
      setFormOk(`Updated ${res.data.toolId} to version ${res.data.version}.`);
      load(page);
    } catch (err) {
      setFormError(apiErrorMessage(err));
    }
  }

  return (
    <Page title="API Registry" subtitle="Register, inspect, edit, and remove engine tools.">
      <DataState loading={loading} error={error} empty={tools.length === 0} onRetry={() => load(1)}>
        <ul className="list">
          {tools.map((t) => (
            <li key={t.toolId}>
              <strong>{t.toolId}</strong>{' '}
              <span className="muted">{t.method} {t.baseUrl}{t.path} · v{t.version} · downstream v{t.downstreamVersion}</span>
              <span className="actions">
                <button type="button" onClick={() => inspect(t.toolId)}>Inspect</button>
                <button type="button" onClick={() => setEditing({ toolId: t.toolId, version: t.version, timeoutMs: String(t.timeoutMs || 5000), headers: JSON.stringify(t.headers || {}), recoveryPolicy: JSON.stringify(t.recoveryPolicy || {}) })}>Edit</button>
                <button type="button" className="danger" onClick={() => remove(t.toolId)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
        <Pagination page={page} pageSize={10} total={total} onPage={(p) => load(p)} />
      </DataState>

      {editing ? (
        <form onSubmit={saveEdit} className="card">
          <h3>Edit {editing.toolId} (expects version {editing.version})</h3>
          <div className="grid">
            <Field label="timeoutMs"><input value={editing.timeoutMs} onChange={(e) => setEditing({ ...editing, timeoutMs: e.target.value })} /></Field>
            <Field label="headers (JSON)"><textarea rows={3} value={editing.headers} onChange={(e) => setEditing({ ...editing, headers: e.target.value })} /></Field>
            <Field label="recoveryPolicy (JSON)"><textarea rows={3} value={editing.recoveryPolicy} onChange={(e) => setEditing({ ...editing, recoveryPolicy: e.target.value })} /></Field>
          </div>
          <div className="row">
            <button type="submit">Save</button>
            <button type="button" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      ) : null}

      {detail ? <JsonBlock title={`Tool: ${detail.toolId}`} value={detail} /> : null}

      <h2>Register a tool</h2>
      <form onSubmit={submit} className="grid">
        <Field label="toolId" hint="lowercase slug"><input value={form.toolId} onChange={(e) => set('toolId', e.target.value)} required /></Field>
        <Field label="baseUrl"><input value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} required /></Field>
        <Field label="method">
          <select value={form.method} onChange={(e) => set('method', e.target.value)}>
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="path"><input value={form.path} onChange={(e) => set('path', e.target.value)} required /></Field>
        <Field label="clientSchema (JSON, required)"><textarea rows={8} value={form.clientSchema} onChange={(e) => set('clientSchema', e.target.value)} /></Field>
        <Field label="downstreamSchema (JSON, optional — defaults to clientSchema)"><textarea rows={8} value={form.downstreamSchema} onChange={(e) => set('downstreamSchema', e.target.value)} placeholder="leave empty to mirror clientSchema" /></Field>
        <Field label="responseSchema (JSON, optional)"><textarea rows={6} value={form.responseSchema} onChange={(e) => set('responseSchema', e.target.value)} /></Field>
        <Field label="timeoutMs"><input value={form.timeoutMs} onChange={(e) => set('timeoutMs', e.target.value)} /></Field>
        <Field label="headers (JSON)"><textarea rows={3} value={form.headers} onChange={(e) => set('headers', e.target.value)} /></Field>
        <Field label="credentialRef (name only — never a secret)" hint="Optional reference name"><input value={form.credentialRef} onChange={(e) => set('credentialRef', e.target.value)} /></Field>
        <Field label="recoveryPolicy (JSON)"><textarea rows={4} value={form.recoveryPolicy} onChange={(e) => set('recoveryPolicy', e.target.value)} /></Field>
        <button type="submit">Register tool</button>
      </form>
      {formError ? <div className="alert error" role="alert">{formError}</div> : null}
      {formOk ? <div className="alert ok" role="status">{formOk}</div> : null}
    </Page>
  );
}
