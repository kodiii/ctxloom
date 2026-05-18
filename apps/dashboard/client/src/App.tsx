import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { Overview } from './pages/Overview.tsx';
import { GraphView } from './pages/GraphView.tsx';
import { RiskTable } from './pages/RiskTable.tsx';
import { Trends } from './pages/Trends.tsx';
import { Communities } from './pages/Communities.tsx';
import { Ownership } from './pages/Ownership.tsx';
import { Budget } from './pages/Budget.tsx';
import { Guide } from './pages/Guide.tsx';
import { track } from './lib/telemetry.ts';

function TelemetryGate() {
  const location = useLocation();

  useEffect(() => {
    void track('dashboard_loaded');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void track('dashboard_page_viewed', { path: location.pathname });
  }, [location.pathname]);

  return null;
}

export default function App() {
  return (
    <>
      <TelemetryGate />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="graph" element={<GraphView />} />
          <Route path="risk" element={<RiskTable />} />
          <Route path="trends" element={<Trends />} />
          <Route path="communities" element={<Communities />} />
          <Route path="ownership" element={<Ownership />} />
          <Route path="budget" element={<Budget />} />
          <Route path="guide" element={<Guide />} />
        </Route>
      </Routes>
    </>
  );
}
