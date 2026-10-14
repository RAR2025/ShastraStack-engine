import React, { useState } from 'react';
import './App.css';
import { MOCK_API_URL, ENGINE_BASE_URL } from './api.js';
import Endpoints from './components/Endpoints.jsx';
import SchemaSection from './components/SchemaSection.jsx';
import MutationLab from './components/MutationLab.jsx';
import Simulator from './components/Simulator.jsx';
import Scenarios from './components/Scenarios.jsx';
import Activity from './components/Activity.jsx';

const TABS = [
  ['endpoints', 'Endpoints'],
  ['schemas', 'Schemas'],
  ['mutations', 'Mutation Lab'],
  ['simulator', 'Simulator'],
  ['scenarios', 'Scenarios'],
  ['activity', 'Activity'],
];

export default function App() {
  const [tab, setTab] = useState('endpoints');
  const [selected, setSelected] = useState('customers');
  const [refreshKey, setRefreshKey] = useState(0);

  function notifyChange() {
    setRefreshKey((k) => k + 1);
  }

  return (
    <main className="page wide">
      <header>
        <h1>Mock API Simulation Platform</h1>
        <p className="muted">
          Mock server: <code>{MOCK_API_URL}</code> · Engine (notify only): <code>{ENGINE_BASE_URL}</code>
        </p>
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
      </header>
      {tab === 'endpoints' ? <Endpoints selected={selected} onSelect={setSelected} refreshKey={refreshKey} notifyChange={notifyChange} /> : null}
      {tab === 'schemas' ? <SchemaSection selected={selected} /> : null}
      {tab === 'mutations' ? <MutationLab selected={selected} notifyChange={notifyChange} /> : null}
      {tab === 'simulator' ? <Simulator selected={selected} notifyChange={notifyChange} /> : null}
      {tab === 'scenarios' ? <Scenarios selected={selected} notifyChange={notifyChange} /> : null}
      {tab === 'activity' ? <Activity refreshKey={refreshKey} /> : null}
    </main>
  );
}
