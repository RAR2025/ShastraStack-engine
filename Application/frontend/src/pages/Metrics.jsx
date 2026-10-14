import React, { useCallback, useEffect, useState } from 'react';
import { backendApi } from '../api/backend.js';
import { apiErrorMessage } from '../api/client.js';
import { Page, DataState, StatCard, Badge } from '../components/ui.jsx';

const TARGETS = [
  { label: 'Adaptation rate target', value: '≥ 80 %', note: 'target for supported mutations' },
  { label: 'MTTR target', value: '≤ 2 s', note: 'failure → verified recovery' },
  { label: 'LLM overhead target', value: '0 tokens', note: 'deterministic recovery uses no LLM' },
];

export default function Metrics() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await backendApi.metricsSummary();
      setSummary(res.data);
      setLoading(false);
    } catch (err) {
      setError(apiErrorMessage(err));
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const outcomes = summary?.byStatus || {};
  const total = summary?.totalExecutions || 0;

  return (
    <Page
      title="Metrics"
      subtitle="Measured recovery metrics from the engine. Targets are labeled as targets — never mixed with live values."
      actions={<button type="button" onClick={load}>Refresh</button>}
    >
      <DataState loading={loading} error={error} onRetry={load}>
        {summary ? (
          <>
            <h2>Measured (live)</h2>
            <div className="stat-grid">
              <StatCard label="Zero-Touch Adaptation Rate" value={`${summary.zeroTouchAdaptationRate ?? '—'} %`} sub={`${summary.recovered ?? 0} recoveries / ${total} executions`} />
              <StatCard label="MTTR" value={`${summary.mttrMs ?? '—'} ms`} sub={`avg duration ${summary.avgDurationMs ?? '—'} ms`} />
              <StatCard label="Additional LLM tokens" value={summary.tokenOverhead ?? '—'} sub={`recovery tokens: ${summary.llmTokensRecovery ?? '—'}`} />
              <StatCard label="Retries" value={summary.retries ?? 0} />
            </div>
            <h2>Execution outcomes (measured)</h2>
            <div className="stat-grid">
              {Object.keys(outcomes).length === 0 ? <p className="muted">No executions recorded yet.</p> : null}
              {Object.entries(outcomes).map(([status, count]) => (
                <StatCard key={status} label={status} value={count} sub={total ? `${Math.round((count / total) * 100)} % of total` : ''} />
              ))}
            </div>
            {summary.byClassification ? (
              <p>
                {Object.entries(summary.byClassification).map(([c, n]) => (
                  <span key={c}><Badge>{c}: {n}</Badge> </span>
                ))}
              </p>
            ) : null}
            <h2>Baseline comparison</h2>
            <p className="muted">
              Baseline = direct mock calls bypassing the engine (see Test &amp; Recovery).
              The engine reports only its own measured executions above; run a baseline alongside
              an engine execution to compare response equivalence and added recovery latency
              (<code>durationMs</code> on each trace).
            </p>
            <h2>Targets (not measurements)</h2>
            <div className="stat-grid">
              {TARGETS.map((t) => <StatCard key={t.label} label={t.label} value={t.value} sub={t.note} />)}
            </div>
          </>
        ) : null}
      </DataState>
    </Page>
  );
}
