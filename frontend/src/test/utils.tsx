import * as React from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/hooks/auth";
import { TooltipProvider } from "@/components/ui/primitives";
import { PagePreviewProvider } from "@/components/evidence";

export const testUser = { id: "u1", name: "Jordan Avery", email: "jordan@firm.com", created_at: "2026-01-01T00:00:00Z" };

export function renderPage(ui: React.ReactElement, { route = "/", path = "*", authed = true } = {}) {
  if (authed) localStorage.setItem("lm-token", "test-token");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <TooltipProvider>
            <PagePreviewProvider>
              <Routes>
                <Route path={path} element={ui} />
                <Route path="*" element={<div>other route</div>} />
              </Routes>
            </PagePreviewProvider>
          </TooltipProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export const readyDoc = {
  id: "d1",
  filename: "msa.pdf",
  file_size: 120000,
  page_count: 3,
  chunk_count: 11,
  processing_status: "ready" as const,
  status_message: null,
  ocr_pages: 0,
  processing_ms: 900,
  created_at: "2026-11-20T10:00:00Z",
  processed_at: "2026-11-20T10:00:01Z",
};
