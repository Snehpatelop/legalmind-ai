import * as React from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useAuth } from "@/hooks/auth";
import AuthPage from "@/pages/AuthPage";
import DashboardPage from "@/pages/DashboardPage";
import AssistantPage from "@/pages/AssistantPage";
import DocumentsPage from "@/pages/DocumentsPage";
import ContractAnalysisPage from "@/pages/ContractAnalysisPage";
import ComparePage from "@/pages/ComparePage";
import SearchPage from "@/pages/SearchPage";
import HistoryPage from "@/pages/HistoryPage";
import EvaluationPage from "@/pages/EvaluationPage";
import SettingsPage from "@/pages/SettingsPage";
import { LogoMark } from "@/components/layout/Logo";
import { PagePreviewProvider } from "@/components/evidence";

function FullScreenLoader() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <LogoMark className="size-10" />
      <Loader2 className="size-5 animate-spin text-teal" />
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><AuthPage mode="login" /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><AuthPage mode="register" /></PublicOnly>} />
      <Route element={<Protected><PagePreviewProvider><AppShell /></PagePreviewProvider></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="assistant" element={<AssistantPage />} />
        <Route path="assistant/:conversationId" element={<AssistantPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="contract-analysis" element={<ContractAnalysisPage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="evaluation" element={<EvaluationPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
