import React, { useState } from 'react';
import { api } from '../api.js';
import { ErrorBox, JsonBlock, Field } from './ui.jsx';

export default function Simulator({ selected, notifyChange }) {
  const [method, setMethod] = useState('POST');
  const [path, setPath] = useState('/api/customers');
  const [body, setBody] = useState('{\n  "name": "Ada",\n  "email": "a@b.c"\n}');
  const [headers, setHeaders] = useState('{\n}');
  const [resp, setResp] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [respStatus, setRespStatus] = useState('201');
  const [respBody, setRespBody] = useState('{\n  "id": "cus_demo123",\n  "name": "$body.name",\n  "email": "$body.email"\n}');
  const [cfgMsg, setCfgMsg] = useState(null);

  const [failure, setFailure] = useState({ mode: 'off', retryAfterSec: '2', delayMs: '2000', status: '500' });
  const [failMsg, setFailMsg] = useState(null);

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResp(null);
    try {
      const parsedBody = body.trim() ? JSON.parse(body) : {};
      const parsedHeaders = headers.trim() ? JSON.parse(headers) : {};
      const res = await api.tryEndpoint(method, path, parsedBody, parsedHeaders);
      setResp({ status: '2xx', body: res });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveResponse(e) {
    e.preventDefault();
    setCfgMsg(null);
    try {
      if (!selected) throw new Error('Select an endpoint first.');
      const res = await api.setResponse(selected, {
        responseStatus: Number(respStatus), responseBody: JSON.parse(respBody),
      });
      setCfgMsg({ ok: true, text: `Response configured: ${res.data.responseStatus}.` });
      notifyChange();
    } catch (err) {
      setCfgMsg({ ok: false, text: err.message });
    }
  }

  async function saveFailure(e) {
    e.preventDefault();
    setFailMsg(null);
    try {
      if (!selected) throw new Error('Select an endpoint first.');
      const payload = { mode: failure.mode };
      if (failure.mode === 'ratelimit') payload.retryAfterSec = Number(failure.retryAfterSec);
      if (failure.mode === 'timeout') payload.delayMs = Number(failure.delayMs);
      if (failure.mode === 'server') payload.status = Number(failure.status);
      const res = await api.setFailure(selected, payload);
      setFailMsg({ ok: true, text: `Failure mode: ${res.data.failure.mode}. Explicit and resettable via endpoint Reset.` });
      notifyChange();
    } catch (err) {
      setFailMsg({ ok: false, text: err.message });
    }
  }

  return (
    <section>
      <h2>Response Simulator &amp; Failure Injection</h2>
      <h3>Try a simulated endpoint</h3>
      <form onSubmit={send} className="grid">
        <Field label="method">
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="path"><input value={path} onChange={(e) => setPath(e.target.value)} /></Field>
        <Field label="request body (JSON)"><textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <Field label="extra headers (JSON)"><textarea rows={3} value={headers} onChange={(e) => setHeaders(e.target.value)} /></Field>
        <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
      </form>
      <ErrorBox error={error} />
      {resp ? <JsonBlock title="Response" value={resp.body} /> : null}

      <h3>Configure response — {selected || '(select an endpoint)'}</h3>
      <form onSubmit={saveResponse} className="grid">
        <Field label="responseStatus"><input value={respStatus} onChange={(e) => setRespStatus(e.target.value)} /></Field>
        <Field label="responseBody (JSON)"><textarea rows={5} value={respBody} onChange={(e) => setRespBody(e.target.value)} /></Field>
        <button type="submit">Save response config</button>
      </form>
      {cfgMsg ? <p className={cfgMsg.ok ? 'ok' : 'fail'}>{cfgMsg.text}</p> : null}

      <h3>Failure injection (explicit test simulation)</h3>
      <form onSubmit={saveFailure} className="grid">
        <Field label="mode">
          <select value={failure.mode} onChange={(e) => setFailure({ ...failure, mode: e.target.value })}>
            <option value="off">off (normal)</option>
            <option value="auth">auth failure (401)</option>
            <option value="ratelimit">rate limit (429 + Retry-After)</option>
            <option value="timeout">timeout (delayed response)</option>
            <option value="server">server error (5xx)</option>
          </select>
        </Field>
        {failure.mode === 'ratelimit' ? (
          <Field label="retryAfterSec"><input value={failure.retryAfterSec} onChange={(e) => setFailure({ ...failure, retryAfterSec: e.target.value })} /></Field>
        ) : null}
        {failure.mode === 'timeout' ? (
          <Field label="delayMs"><input value={failure.delayMs} onChange={(e) => setFailure({ ...failure, delayMs: e.target.value })} /></Field>
        ) : null}
        {failure.mode === 'server' ? (
          <Field label="status"><input value={failure.status} onChange={(e) => setFailure({ ...failure, status: e.target.value })} /></Field>
        ) : null}
        <button type="submit">Apply failure mode</button>
      </form>
      {failMsg ? <p className={failMsg.ok ? 'ok' : 'fail'}>{failMsg.text}</p> : null}
    </section>
  );
}
