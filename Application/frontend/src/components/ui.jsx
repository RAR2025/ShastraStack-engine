import React from 'react';
import { toJson } from './redact.js';

export function Page({ title, subtitle, children, actions }) {
  return (
    <section className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
      <div className="page-body">{children}</div>
    </section>
  );
}

export function DataState({ loading, error, empty, onRetry, children }) {
  if (loading) return <p className="muted" role="status">Loading…</p>;
  if (error) {
    return (
      <div className="alert error" role="alert">
        <strong>Request failed.</strong> <span>{error}</span>
        {onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}
      </div>
    );
  }
  if (empty) return <p className="muted">Nothing here yet.</p>;
  return <>{children}</>;
}

export function StatCard({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function Badge({ tone, children }) {
  return <span className={`badge ${tone || ''}`}>{children}</span>;
}

export function JsonBlock({ title, value, raw }) {
  return (
    <div className="jsonblock">
      {title ? <h4>{title}</h4> : null}
      <pre>{raw ? String(value) : toJson(value)}</pre>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small className="muted">{hint}</small> : null}
    </label>
  );
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil((total || 0) / (pageSize || 20)));
  return (
    <div className="pager">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button>
      <span className="muted">Page {page} of {pages} · {total || 0} total</span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
    </div>
  );
}

export function SchemaDiff({ before, after }) {
  const bProps = Object.keys((before && before.properties) || {});
  const aProps = Object.keys((after && after.properties) || {});
  const all = [...new Set([...bProps, ...aProps])];
  const changed = all.filter((k) => JSON.stringify(before?.properties?.[k]) !== JSON.stringify(after?.properties?.[k]));
  const bReq = before?.required || [];
  const aReq = after?.required || [];
  return (
    <div>
      <div className="cols">
        <JsonBlock title="Before" value={before} />
        <JsonBlock title="After" value={after} />
      </div>
      <p>
        <strong>Changed properties:</strong> {changed.length ? changed.join(', ') : '(none)'}<br />
        <strong>Required before:</strong> {bReq.join(', ') || '(none)'}<br />
        <strong>Required after:</strong> {aReq.join(', ') || '(none)'}
      </p>
    </div>
  );
}
