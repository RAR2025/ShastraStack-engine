import React from 'react';
import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Registry from './pages/Registry.jsx';
import SchemaLab from './pages/SchemaLab.jsx';
import TestRecovery from './pages/TestRecovery.jsx';
import { LogList, LogTrace } from './pages/Logs.jsx';
import Metrics from './pages/Metrics.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  ['/', 'Dashboard'],
  ['/registry', 'API Registry'],
  ['/schemas', 'Schema Lab'],
  ['/test', 'Test & Recovery'],
  ['/logs', 'Logs'],
  ['/metrics', 'Metrics'],
  ['/settings', 'Settings'],
];

export default function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">ShastraStack <span>Judging Console</span></div>
        <nav className="nav">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/registry" element={<Registry />} />
          <Route path="/schemas" element={<SchemaLab />} />
          <Route path="/test" element={<TestRecovery />} />
          <Route path="/logs" element={<LogList />} />
          <Route path="/logs/:executionId" element={<LogTrace />} />
          <Route path="/metrics" element={<Metrics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="foot muted">All values are live from the Application backend — failures are shown, never hidden.</footer>
    </div>
  );
}
