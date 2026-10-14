import React, { useCallback, useEffect, useState } from 'react';
import { backendApi } from '../api/backend.js';
import { apiErrorMessage, BACKEND_URL, ENGINE_URL, MOCK_API_URL, MOCK_STUDIO_URL } from '../api/client.js';
import { Page, DataState, StatCard, Field, Badge } from '../components/ui.jsx';

export default function Settings() {
  const [health, setHealth] = useState(null);
  const [engine, setEngine] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeoutMs, setTimeoutMs] = useState('5000');
  const [policy, setPolicy] = useState('{\n  "maxRetries": 1,\n  "allowAutomaticPatch": true\n}');
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, e] = await Promise.allSettled([backendApi.health(), backendApi.engineHealth()]);
      setHealth(h.status === 'fulfilled' ? h.value : null);
      setEngine(e.status === 'fulfilled' ? e.value : null);
      if (h.status === 'rejected' && e.status === 'rejected') throw h.reason;
      setLoading(false);
    } catch (err) {
      setError(apiErrorMessage(err));
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function validatePolicy() {
    setMsg(null);
    try {
      const p = JSON.parse(policy);
      const t = Number(timeoutMs);
      if (!Number.isInteger(t) || t <= 0) throw new Error('timeoutMs must be a positive integer');
      if (p.maxRetries !== undefined && ![0, 1].includes(p.maxRetries)) throw new Error('maxRetries must be 0 or 1');
      if (p.allowAutomaticPatch !== undefined && typeof p.allowAutomaticPatch !== 'boolean') {
        throw new Error('allowAutomaticPatch must be boolean');
      }
      setMsg({ ok: true, text: 'Policy is valid. Apply it per-tool in the API Registry (edit) — this screen stores nothing.' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  return (
    <Page title="Settings" subtitle="Service wiring, health, and safe recovery-policy controls. Secret values are never shown.">
      <DataState loading={loading} error={error} onRetry={load}>
        <div className="stat-grid">
          <StatCard label="Application backend" value={health ? 'ok' : 'unreachable'} sub={BACKEND_URL} />
          <StatCard label="ShastraStack engine" value={engine?.status || 'unreachable'} sub={`${ENGINE_URL} · db: ${engine?.db || '—'}`} />
          <StatCard label="Mock API" value="see Mock Studio" sub={MOCK_API_URL} />
        </div>
        <h2>Configured service URLs</h2>
        <ul className="list small">
          <li>Backend <code>{BACKEND_URL}</code> <Badge tone={health ? 'ok' : 'bad'}>{health ? 'up' : 'down'}</Badge></li>
          <li>Engine <code>{ENGINE_URL}</code> <Badge tone={engine ? 'ok' : 'bad'}>{engine ? 'up' : 'down'}</Badge></li>
          <li>Mock API <code>{MOCK_API_URL}</code></li>
          <li>Mock Studio <code>{MOCK_STUDIO_URL}</code> <a className="btn small" href={MOCK_STUDIO_URL} target="_blank" rel="noreferrer">Open ↗</a></li>
        </ul>
        <p className="muted">URLs come from build-time environment (<code>VITE_*</code>). No secret values exist on this screen by design.</p>

        <h2>Timeout settings</h2>
        <div className="grid">
          <Field label="Default tool timeoutMs" hint="Used when registering tools; enforced per-tool by the engine">
            <input value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} inputMode="numeric" />
          </Field>
        </div>

        <h2>Recovery policy controls (safe)</h2>
        <div className="grid">
          <Field label="recoveryPolicy preview (JSON)" hint="Validated here, applied per-tool in the Registry">
            <textarea rows={5} value={policy} onChange={(e) => setPolicy(e.target.value)} />
          </Field>
          <div><button type="button" onClick={validatePolicy}>Validate policy</button></div>
        </div>
        {msg ? <div className={msg.ok ? 'alert ok' : 'alert error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div> : null}
      </DataState>
    </Page>
  );
}
