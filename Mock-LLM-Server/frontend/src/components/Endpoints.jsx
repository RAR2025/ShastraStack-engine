import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Status, ErrorBox, JsonBlock, Field } from './ui.jsx';

const EMPTY_FORM = {
  endpointId: '', method: 'POST', path: '/api/',
  requestSchema: '{\n  "type": "object",\n  "required": ["name"],\n  "properties": { "name": { "type": "string" } }\n}',
  responseSchema: '{\n  "type": "object",\n  "required": ["ok"],\n  "properties": { "ok": { "type": "boolean" } }\n}',
  responseStatus: '200', responseBody: '{\n  "ok": true\n}',
};

export default function Endpoints({ selected, onSelect, refreshKey, notifyChange }) {
  const [endpoints, setEndpoints] = useState([]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formMsg, setFormMsg] = useState(null);
  const [detail, setDetail] = useState(null);

  async function load() {
    setState('loading');
    setError(null);
    try {
      const res = await api.listEndpoints();
      setEndpoints(res.data);
      setState(res.data.length ? 'ready' : 'empty');
    } catch (e) {
      setError(e);
      setState('ready');
    }
  }

  useEffect(() => { load(); }, [refreshKey]);

  async function view(id) {
    setError(null);
    try {
      const res = await api.getEndpoint(id);
      setDetail(res.data);
      onSelect(id);
    } catch (e) { setError(e); }
  }

  async function create(e) {
    e.preventDefault();
    setFormMsg(null);
    try {
      const body = {
        endpointId: form.endpointId.trim(), method: form.method, path: form.path.trim(),
        requestSchema: JSON.parse(form.requestSchema),
        responseSchema: JSON.parse(form.responseSchema),
        responseStatus: Number(form.responseStatus),
        responseBody: JSON.parse(form.responseBody),
      };
      const res = await api.createEndpoint(body);
      setFormMsg({ ok: true, text: `Created ${res.data.endpointId} (v${res.data.version}).` });
      setForm(EMPTY_FORM);
      await load();
      notifyChange();
    } catch (err) {
      setFormMsg({ ok: false, text: err.message });
    }
  }

  async function remove(id) {
    if (!window.confirm(`Delete mock endpoint ${id}?`)) return;
    try {
      await api.deleteEndpoint(id);
      setDetail(null);
      await load();
      notifyChange();
    } catch (e) { setError(e); }
  }

  async function reset(id) {
    try {
      await api.reset(id, {});
      setFormMsg({ ok: true, text: `Reset ${id} to baseline.` });
      await load();
      notifyChange();
    } catch (e) { setError(e); }
  }

  return (
    <section>
      <h2>Endpoint Manager</h2>
      <ErrorBox error={error} />
      <Status state={state}>
        <ul className="list">
          {endpoints.map((ep) => (
            <li key={ep.endpointId} className={selected === ep.endpointId ? 'active' : ''}>
              <button className="link" onClick={() => view(ep.endpointId)}>
                {ep.method} {ep.path}
              </button>
              <span className="muted"> · {ep.endpointId} · cfg v{ep.version} · schema v{ep.schemaVersion}</span>
              <span className="actions">
                <button onClick={() => reset(ep.endpointId)}>Reset</button>
                <button className="danger" onClick={() => remove(ep.endpointId)}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      </Status>
      {detail ? <JsonBlock title={`Selected: ${detail.endpointId}`} value={detail} /> : null}

      <h3>Create endpoint</h3>
      <form onSubmit={create} className="grid">
        <Field label="endpointId (slug)">
          <input value={form.endpointId} onChange={(e) => setForm({ ...form, endpointId: e.target.value })} required />
        </Field>
        <Field label="method">
          <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="path (under /api/, never /api/admin)">
          <input value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} required />
        </Field>
        <Field label="requestSchema (JSON)">
          <textarea rows={7} value={form.requestSchema} onChange={(e) => setForm({ ...form, requestSchema: e.target.value })} />
        </Field>
        <Field label="responseSchema (JSON)">
          <textarea rows={5} value={form.responseSchema} onChange={(e) => setForm({ ...form, responseSchema: e.target.value })} />
        </Field>
        <Field label="responseStatus">
          <input value={form.responseStatus} onChange={(e) => setForm({ ...form, responseStatus: e.target.value })} />
        </Field>
        <Field label="responseBody (JSON, $body./$header. templating)">
          <textarea rows={4} value={form.responseBody} onChange={(e) => setForm({ ...form, responseBody: e.target.value })} />
        </Field>
        <button type="submit">Create endpoint</button>
      </form>
      {formMsg ? <p className={formMsg.ok ? 'ok' : 'fail'}>{formMsg.text}</p> : null}
    </section>
  );
}
