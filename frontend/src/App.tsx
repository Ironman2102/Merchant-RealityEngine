import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes, Outlet } from 'react-router-dom';

// Hash routing is used for static previews where the server cannot rewrite deep links.
const Router = import.meta.env.VITE_HASH_ROUTER === '1' ? HashRouter : BrowserRouter;
import { DemoShell } from './components/navigation/DemoShell';
import { HomePage } from './pages/HomePage';
import { PortfolioProvider } from './hooks/usePortfolio';
import { InvestigationProvider, useInvestigation } from './hooks/useInvestigation';
import { EngineShell } from './components/navigation/EngineShell';

const ArchitecturePage = lazy(() => import('./pages/ArchitecturePage').then(m => ({ default: m.ArchitecturePage })));
const DemoPage = lazy(() => import('./pages/DemoPage').then(m => ({ default: m.DemoPage })));
const MerchantPage = lazy(() => import('./pages/MerchantPage').then(m => ({ default: m.MerchantPage })));
const InvestigationPage = lazy(() => import('./pages/InvestigationPage').then(m => ({ default: m.InvestigationPage })));
const EvidenceGraphPage = lazy(() => import('./pages/EvidenceGraphPage').then(m => ({ default: m.EvidenceGraphPage })));
const DetectionPage = lazy(() => import('./pages/DetectionPage').then(m => ({ default: m.DetectionPage })));
const AnalystPage = lazy(() => import('./pages/AnalystPage').then(m => ({ default: m.AnalystPage })));
const ResponsePage = lazy(() => import('./pages/ResponsePage').then(m => ({ default: m.ResponsePage })));
const AuditPage = lazy(() => import('./pages/AuditPage').then(m => ({ default: m.AuditPage })));
const UploadPage = lazy(() => import('./pages/UploadPage').then(m => ({ default: m.UploadPage })));
const PatternsPage = lazy(() => import('./pages/PatternsPage').then(m => ({ default: m.PatternsPage })));
const PortfolioPage = lazy(() => import('./pages/PortfolioPage').then(m => ({ default: m.PortfolioPage })));
const CasePage = lazy(() => import('./pages/CasePage').then(m => ({ default: m.CasePage })));
const AIEnginePage = lazy(() => import('./pages/AIEnginePage').then(m => ({ default: m.AIEnginePage })));
const ImprovementsPage = lazy(() => import('./pages/ImprovementsPage').then(m => ({ default: m.ImprovementsPage })));
const ServerCasePage = lazy(() => import('./pages/ServerCasePage').then(m => ({ default: m.ServerCasePage })));
const TracePage = lazy(() => import('./pages/TracePage').then(m => ({ default: m.TracePage })));

function EngineProviders() {
  return <PortfolioProvider mode="user"><InvestigationProvider><Outlet /></InvestigationProvider></PortfolioProvider>;
}

function DemoProviders() {
  return <PortfolioProvider mode="demo"><InvestigationProvider><Outlet /></InvestigationProvider></PortfolioProvider>;
}

function RequireUserDataset() {
  const { custom, started, detailsOpen } = useInvestigation();
  return custom && started && detailsOpen ? <Outlet /> : <Navigate to="/ai-engine/analyze" replace />;
}

function RequireDemoRun() {
  const { started, detailsOpen } = useInvestigation();
  return started && detailsOpen ? <Outlet /> : <Navigate to="/demo" replace />;
}

export default function App() {
  return (
    <Router>
      <Suspense fallback={<div className="p-8 text-sm text-mute">Loading…</div>}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/architecture" element={<ArchitecturePage />} />
        <Route element={<EngineProviders />}>
          <Route path="/ai-engine" element={<EngineShell />}>
            <Route index element={<AIEnginePage />} />
            <Route path="analyze" element={<UploadPage />} />
            <Route path="cases/:id" element={<ServerCasePage />} />
            <Route path="cases/:id/:view" element={<ServerCasePage />} />
            <Route path="portfolio" element={<PortfolioPage />} />
            <Route path="portfolio/:key" element={<CasePage />} />
            <Route path="improvements" element={<ImprovementsPage />} />
            <Route element={<RequireUserDataset />}>
              <Route path="investigations" element={<InvestigationPage />} />
              <Route path="trace" element={<TracePage />} />
              <Route path="patterns" element={<PatternsPage />} />
              <Route path="merchant" element={<MerchantPage />} />
              <Route path="graph" element={<EvidenceGraphPage />} />
              <Route path="detection" element={<DetectionPage />} />
              <Route path="analyst" element={<AnalystPage />} />
              <Route path="response" element={<ResponsePage />} />
              <Route path="audit" element={<AuditPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="/engine" element={<Navigate to="/ai-engine" replace />} />
        <Route path="/simulation" element={<Navigate to="/ai-engine" replace />} />
        <Route path="/demo/upload" element={<Navigate to="/ai-engine/analyze" replace />} />
        <Route element={<DemoProviders />}>
          <Route path="/demo" element={<DemoShell />}>
            <Route index element={<DemoPage />} />
            <Route element={<RequireDemoRun />}>
              <Route path="merchant" element={<MerchantPage />} />
              <Route path="investigations" element={<InvestigationPage />} />
              <Route path="graph" element={<EvidenceGraphPage />} />
              <Route path="detection" element={<DetectionPage />} />
              <Route path="analyst" element={<AnalystPage />} />
              <Route path="response" element={<ResponsePage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="trace" element={<TracePage />} />
              <Route path="portfolio" element={<PortfolioPage />} />
              <Route path="portfolio/:key" element={<CasePage />} />
              <Route path="patterns" element={<PatternsPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </Router>
  );
}
