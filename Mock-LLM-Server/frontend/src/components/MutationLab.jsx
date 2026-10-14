import React, { useEffect, useState } from 'react';
import { api, ENGINE_BASE_URL } from '../api.js';
import { ErrorBox, JsonBlock, Field } from './ui.jsx';

const OPS = ['RENAME_FIELD', 'MOVE_FIELD', 'CONVERT_TYPE', 'ADD_REQUIRED_FIELD', 'ADD_HEADER', 'CHANGE_RESPONSE_SCHEMA'];

export default function MutationLab({ selected, notifyChange }) {
  const [op, setOp] = useState('RENAME_FIELD');
  const [args, setArgs] = useState({ scope: 'request', from: 'email', to: 'emailAddress' });
  const [mode, setMode] = useState('blind');
  const [toolId, setToolId] = useState('customer-api');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [selected, op]);

  function set(k, v) {
    setArgs((a) => ({ ...a, [k]: v }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!selected) { setError(new Error('Select an endpoint first.')); return; }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = { op, appliedBy: 'console-judge' };
      for (const [k, v] of Object.entries(args)) {
        if (v === '' || v === undefined) continue;
        if (k === 'fieldSchema' || k === 'responseSchema') {
          try { body[k] = JSON.parse(v); } catch { throw new Error(`${k} must be valid JSON`); }
        } else body[k] = v;
      }
      if (mode === 'informed') {
        if (!toolId.trim()) throw new Error('Informed mode requires a ShastraStack toolId.');
        body.notify = { toolId: toolId.trim(), engineUrl: ENGINE_BASE_URL };
      }
      const res = await api.mutate(selected, body);
      setResult(res.data);
      notifyChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Runtime Mutation Lab</h2>
      <p className="muted">
        Target: <strong>{selected || '(none selected)'}</strong> · Engine: <code>{ENGINE_BASE_URL}</code> ·
        blind mode never notifies the engine; informed mode calls its documented schema API.
      </p>
      <form onSubmit={submit} className="grid">
        <Field label="operation">
          <select value={op} onChange={(e) => setOp(e.target.value)}>
            {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        {(op !== 'ADD_HEADER' && op !== 'CHANGE_RESPONSE_SCHEMA') ? (
          <Field label="scope">
            <select value={args.scope || 'request'} onChange={(e) => set('scope', e.target.value)}>
              <option value="request">request</option>
              <option value="response">response</option>
            </select>
          </Field>
        ) : null}
        {op === 'RENAME_FIELD' ? (<>
          <Field label="from"><input value={args.from || ''} onChange={(e) => set('from', e.target.value)} /></Field>
          <Field label="to"><input value={args.to || ''} onChange={(e) => set('to', e.target.value)} /></Field>
        </>) : null}
        {op === 'MOVE_FIELD' ? (<>
          <Field label="fromPath"><input value={args.fromPath || ''} onChange={(e) => set('fromPath', e.target.value)} placeholder="name" /></Field>
          <Field label="toPath"><input value={args.toPath || ''} onChange={(e) => set('toPath', e.target.value)} placeholder="customer.name" /></Field>
        </>) : null}
        {op === 'CONVERT_TYPE' ? (<>
          <Field label="field"><input value={args.field || ''} onChange={(e) => set('field', e.target.value)} /></Field>
          <Field label="toType">
            <select value={args.toType || 'integer'} onChange={(e) => set('toType', e.target.value)}>
              {['string', 'number', 'integer', 'boolean'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </>) : null}
        {op === 'ADD_REQUIRED_FIELD' ? (<>
          <Field label="field"><input value={args.field || ''} onChange={(e) => set('field', e.target.value)} placeholder="phone" /></Field>
          <Field label='fieldSchema (JSON, optional)'>
            <input value={args.fieldSchema || ''} onChange={(e) => set('fieldSchema', e.target.value)} placeholder='{"type":"string"}' />
          </Field>
        </>) : null}
        {op === 'ADD_HEADER' ? (
          <Field label="header"><input value={args.header || ''} onChange={(e) => set('header', e.target.value)} placeholder="x-tenant-id" /></Field>
        ) : null}
        {op === 'CHANGE_RESPONSE_SCHEMA' ? (
          <Field label="responseSchema (JSON)">
            <textarea rows={6} value={args.responseSchema || ''} onChange={(e) => set('responseSchema', e.target.value)} placeholder='{"type":"object",...}' />
          </Field>
        ) : null}
        <Field label="notification mode">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="blind">Blind — mutate silently (engine must detect)</option>
            <option value="informed">Informed — also notify ShastraStack</option>
          </select>
        </Field>
        {mode === 'informed' ? (
          <Field label="ShastraStack toolId to notify">
            <input value={toolId} onChange={(e) => setToolId(e.target.value)} />
          </Field>
        ) : null}
        <button type="submit" disabled={busy}>{busy ? 'Applying…' : 'Apply mutation now'}</button>
      </form>
      <ErrorBox error={error} />
      {result ? (
        <>
          <p className="ok">Applied {result.mutation.op}: schema v{result.mutation.prevVersion} → v{result.mutation.newVersion}. Notification: {result.notification.mode}.</p>
          <JsonBlock title="Mutation record" value={result.mutation} />
          {result.notification.notified ? <JsonBlock title="Engine notification" value={result.notification} /> : null}
        </>
      ) : null}
    </section>
  );
}
