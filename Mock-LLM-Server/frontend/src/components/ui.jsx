import React from 'react';

export function Status({ state, children }) {
  if (state === 'loading') return <p className="muted">Loading…</p>;
  if (state === 'empty') return <p className="muted">Nothing here yet.</p>;
  return children || null;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <pre className="error">{String(error.message || error)}</pre>;
}

export function JsonBlock({ value, title }) {
  return (
    <div className="jsonblock">
      {title ? <h4>{title}</h4> : null}
      <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
