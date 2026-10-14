import React, { useCallback, useEffect, useState } from 'react';
import { backendApi } from '../api/backend.js';
import { apiErrorMessage, MOCK_API_URL } from '../api/client.js';
import { Page, DataState, StatCard, Badge } from '../components/ui.jsx';

function fmt(value, suffix = '') {
  if (value === null || value === undefined) return 'unavailable';
  return `${value}${suffix}`;
}

export default function Dashboard() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [dash, mockReach] = await Promise.allSettled([
        backendApi.dashboard(),
        fetch(`${MOCK_API_URL}/health`).then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.json();
        }),
      ]);
      if (dash.status === 'rejected') throw dash.reason;
      setState({
        loading: false,
        error: null,
        data: {
          ...dash.value.data,
          mock: mockReach.status === 'fulfilled' ? mockReach.value : null,
          mockError: mockReach.status === 'rejected' ? apiErrorMessage(mockReach.reason) : null,
        },
      });
    } catch (err) {
      setState({ loading: false, error: apiErrorMessage(err), data: null });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const d = state.data;
  const m = d?.metrics;

  return (
    <Page
      title="Dashboard"
      subtitle="Live engine health and recovery metrics, fetched through the Application backend."
      actions={<button type="button" onClick={load}>Refresh</button>}
    >
      <DataState loading={state.loading} error={state.error} onRetry={load}>
        {d ? (
          <>
            <div className="stat-grid">
              <StatCard
                label="Engine health"
                value={d.engine?.status === 'ok' ? 'ok' : fmt(d.engine?.status)}
                sub={`db: ${fmt(d.engine?.db)} · ${d.at ? new Date(d.at).toLocaleTimeString() : ''}`}
              />
              <StatCard
                label="Mock server"
                value={d.mock ? 'reachable' : 'unreachable'}
                sub={d.mock ? d.mock.status || 'ok' : d.mockError}
              />
              <StatCard label="Total executions" value={fmt(m?.totalExecutions)} />
              <StatCard label="Successful recoveries" value={fmt(m?.recovered)} sub={`succeeded: ${fmt(m?.succeeded)}`} />
              <StatCard label="Failed recoveries" value={fmt(m?.failed)} />
              <StatCard label="Adaptation rate" value={fmt(m?.zeroTouchAdaptationRate, ' %')} sub="measured, not a target" />
              <StatCard label="MTTR" value={fmt(m?.mttrMs, ' ms')} sub={`avg duration: ${fmt(m?.avgDurationMs, ' ms')}`} />
              <StatCard label="Retries" value={fmt(m?.retries)} />
              <StatCard label="Additional LLM tokens" value={fmt(m?.tokenOverhead)} sub={`recovery tokens: ${fmt(m?.llmTokensRecovery)}`} />
            </div>
            <p>
              <Badge tone={d.engine?.status === 'ok' ? 'ok' : 'bad'}>engine: {d.engine?.status || 'unknown'}</Badge>{' '}
              <Badge tone={d.mock ? 'ok' : 'bad'}>mock: {d.mock ? 'reachable' : 'unreachable'}</Badge>
            </p>
            <p className="muted">
              Unavailable values are shown honestly as “unavailable”. All numbers come from
              <code> GET /api/dashboard</code>; nothing on this page is sample data.
            </p>
          </>
        ) : null}
      </DataState>
    </Page>
  );
}
