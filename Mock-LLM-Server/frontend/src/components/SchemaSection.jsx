import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Status, ErrorBox, JsonBlock, Field } from './ui.jsx';

function changedKeys(a, b) {
  const ka = Object.keys((a && a.properties) || {});
  const kb = Object.keys((b && b.properties) || {});
  const all = [...new Set([...ka, ...kb])];
  return all.filter((k) => JSON.stringify((a.properties || {})[k]) !== JSON.stringify((b.properties || {})[k]));
}

export default function SchemaSection({ selected }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState(null);
  const [reqText, setReqText] = useState('');
  const [resText, setResText] = useState('');
  const [msg, setMsg] = useState(null);

  async function load() {
    if (!selected) { setState('empty'); return; }
    setState('loading');
    setError(null);
    try {
      const schema = await api.getSchema(selected);
      setData(schema.data);
      setReqText(JSON.stringify(schema.data.requestSchema, null, 2));
      setResText(JSON.stringify(schema.data.responseSchema, null, 2));
      setState('ready');
    } catch (e) { setError(e); setState('ready'); }
  }

  useEffect(() => { load(); }, [selected]);

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    try {
      const parsedReq = JSON.parse(reqText);
      const parsedRes = JSON.parse(resText);
      const ep = await api.getEndpoint(selected);
      const res = await api.patchEndpoint(selected, {
        expectedVersion: ep.data.version, requestSchema: parsedReq, responseSchema: parsedRes,
      });
      setMsg({ ok: true, text: `Saved. Config v${res.data.version}, schema v${res.data.schemaVersion}.` });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  if (!selected) return <section><h2>Schema Editor</h2><p className="muted">Select an endpoint first.</p></section>;

  return (
    <section>
      <h2>Schema Editor — {selected}</h2>
      <ErrorBox error={error} />
      <Status state={state}>
        {data ? (
          <>
            <p className="muted">Active schema v{data.schemaVersion} · baseline v{data.baselineVersion}</p>
            <div className="cols">
              <JsonBlock title="Baseline request schema" value={data.baselineRequestSchema} />
              <JsonBlock title="Active request schema" value={data.requestSchema} />
            </div>
            <p><strong>Changed top-level request keys:</strong> {(changedKeys(data.baselineRequestSchema, data.requestSchema).join(', ') || '(none)')}</p>
            <div className="cols">
              <JsonBlock title="Baseline response schema" value={data.baselineResponseSchema} />
              <JsonBlock title="Active response schema" value={data.responseSchema} />
            </div>
            <form onSubmit={save} className="grid">
              <Field label="Edit active requestSchema (JSON)">
                <textarea rows={10} value={reqText} onChange={(e) => setReqText(e.target.value)} />
              </Field>
              <Field label="Edit active responseSchema (JSON)">
                <textarea rows={10} value={resText} onChange={(e) => setResText(e.target.value)} />
              </Field>
              <button type="submit">Save schemas (version-checked)</button>
            </form>
            {msg ? <p className={msg.ok ? 'ok' : 'fail'}>{msg.text}</p> : null}
          </>
        ) : null}
      </Status>
    </section>
  );
}
