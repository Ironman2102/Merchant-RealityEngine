/** Analyst console only. No marketing pages. */
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, Outlet } from 'react-router-dom';
import { EngineShell } from './components/navigation/EngineShell';
import { PortfolioProvider } from './hooks/usePortfolio';
import { InvestigationProvider, useInvestigation } from './hooks/useInvestigation';

const AIEnginePage = lazy(() => import('./pages/AIEnginePage').then(m => ({ default: m.AIEnginePage })));
const UploadPage = lazy(() => import('./pages/UploadPage').then(m => ({ default: m.UploadPage })));
const ServerCasePage = lazy(() => import('./pages/ServerCasePage').then(m => ({ default: m.ServerCasePage })));
const PortfolioPage = lazy(() => import('./pages/PortfolioPage').then(m => ({ default: m.PortfolioPage })));
const ImprovementsPage = lazy(() => import('./pages/ImprovementsPage').then(m => ({ default: m.ImprovementsPage })));
const CasePage = lazy(() => import('./pages/CasePage').then(m => ({ default: m.CasePage })));
const InvestigationPage = lazy(() => import('./pages/InvestigationPage').then(m => ({ default: m.InvestigationPage })));
const TracePage = lazy(() => import('./pages/TracePage').then(m => ({ default: m.TracePage })));
const PatternsPage = lazy(() => import('./pages/PatternsPage').then(m => ({ default: m.PatternsPage })));
const MerchantPage = lazy(() => import('./pages/MerchantPage').then(m => ({ default: m.MerchantPage })));
const EvidenceGraphPage = lazy(() => import('./pages/EvidenceGraphPage').then(m => ({ default: m.EvidenceGraphPage })));
const DetectionPage = lazy(() => import('./pages/DetectionPage').then(m => ({ default: m.DetectionPage })));
const AnalystPage = lazy(() => import('./pages/AnalystPage').then(m => ({ default: m.AnalystPage })));
const ResponsePage = lazy(() => import('./pages/ResponsePage').then(m => ({ default: m.ResponsePage })));
const AuditPage = lazy(() => import('./pages/AuditPage').then(m => ({ default: m.AuditPage })));

function EngineProviders() {
  return <PortfolioProvider mode="user"><InvestigationProvider><Outlet /></InvestigationProvider></PortfolioProvider>;
}
function RequireUserDataset() {
  const { custom, started, detailsOpen } = useInvestigation();
  return custom && started && detailsOpen ? <Outlet /> : <Navigate to="/ai-engine" replace />;
}

export default function ConsoleApp() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="p-8 text-sm text-mute">Loading…</div>}>
        <Routes>
          <Route element={<EngineProviders />}>
            <Route path="/ai-engine" element={<EngineShell />}>
              <Route index element={<AIEnginePage />} />
              <Route path="analyze" element={<UploadPage />} />
              <Route path="cases/:id" element={<ServerCasePage />} />
              <Route path="cases/:id/:view" element={<ServerCasePage />} />
              <Route path="portfolio" element={<PortfolioPage />} />
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
                <Route path="portfolio/:key" element={<CasePage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/ai-engine" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
