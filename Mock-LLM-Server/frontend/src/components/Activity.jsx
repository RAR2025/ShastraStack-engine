import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Status, ErrorBox, JsonBlock } from './ui.jsx';

export default function Activity({ refreshKey }) {
  const [activity, setActivity] = useState([]);
  const [mutations, setMutations] = useState([]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  async function load() {
    setState('loading');
    setError(null);
    try {
      const [a, m] = await Promise.all([api.activity(50), api.mutations(filter || undefined, 50)]);
      setActivity(a.data);
      setMutations(m.data);
      setState('ready');
    } catch (e) { setError(e); setState('ready'); }
  }

  useEffect(() => { load(); }, [refreshKey]);

  return (
    <section>
      <h2>Activity &amp; Mutation History</h2>
      <ErrorBox error={error} />
      <div className="row">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter mutations by endpointId (optional)" />
        <button onClick={load}>Refresh</button>
      </div>
      <Status state={state}>
        <h3>Recent mock requests &amp; admin events</h3>
        {activity.length === 0 ? <p className="muted">No activity yet.</p> : (
          <ul className="list small">
            {activity.map((a) => (
              <li key={a.id}><code>{a.at}</code> <strong>{a.type}</strong> {a.endpointId ? `· ${a.endpointId}` : ''} <span className="muted">{a.summary || ''}</span></li>
            ))}
          </ul>
        )}
        <h3>Mutation history (who, what, version)</h3>
        {mutations.length === 0 ? <p className="muted">No mutations yet.</p> : (
          <ul className="list small">
            {mutations.map((m) => (
              <li key={m.mutationId}>
                <code>{m.appliedAt}</code> <strong>{m.op}</strong> · {m.endpointId} ·
                v{m.prevVersion}→v{m.newVersion} · by {m.appliedBy}
                {m.scenarioId ? ` · scenario ${m.scenarioId}` : ''}
              </li>
            ))}
          </ul>
        )}
        {mutations[0] ? <JsonBlock title="Latest mutation detail" value={mutations[0]} /> : null}
      </Status>
    </section>
  );
}
