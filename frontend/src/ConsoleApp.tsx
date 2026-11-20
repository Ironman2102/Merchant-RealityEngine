/** Analyst console only. No marketing pages. */
import { BrowserRouter, Navigate, Route, Routes, Outlet } from 'react-router-dom';
import { EngineShell } from './components/navigation/EngineShell';
import { AIEnginePage } from './pages/AIEnginePage';
import { UploadPage } from './pages/UploadPage';
import { ServerCasePage } from './pages/ServerCasePage';
import { PortfolioPage } from './pages/PortfolioPage';
import { ImprovementsPage } from './pages/ImprovementsPage';
import { CasePage } from './pages/CasePage';
import { InvestigationPage } from './pages/InvestigationPage';
import { TracePage } from './pages/TracePage';
import { PatternsPage } from './pages/PatternsPage';
import { MerchantPage } from './pages/MerchantPage';
import { EvidenceGraphPage } from './pages/EvidenceGraphPage';
import { DetectionPage } from './pages/DetectionPage';
import { AnalystPage } from './pages/AnalystPage';
import { ResponsePage } from './pages/ResponsePage';
import { AuditPage } from './pages/AuditPage';
import { PortfolioProvider } from './hooks/usePortfolio';
import { InvestigationProvider, useInvestigation } from './hooks/useInvestigation';

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
    </BrowserRouter>
  );
}
