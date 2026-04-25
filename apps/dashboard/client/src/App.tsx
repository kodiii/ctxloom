import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { Overview } from './pages/Overview.tsx';
import { GraphView } from './pages/GraphView.tsx';
import { RiskTable } from './pages/RiskTable.tsx';
import { Trends } from './pages/Trends.tsx';
import { Communities } from './pages/Communities.tsx';
import { Ownership } from './pages/Ownership.tsx';
import { Guide } from './pages/Guide.tsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="graph" element={<GraphView />} />
        <Route path="risk" element={<RiskTable />} />
        <Route path="trends" element={<Trends />} />
        <Route path="communities" element={<Communities />} />
        <Route path="ownership" element={<Ownership />} />
        <Route path="guide" element={<Guide />} />
      </Route>
    </Routes>
  );
}
