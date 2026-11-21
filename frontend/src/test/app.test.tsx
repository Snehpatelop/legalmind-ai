import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, readyDoc, testUser } from "./utils";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    api: {
      me: vi.fn(),
      login: vi.fn(),
      register: vi.fn(),
      documents: vi.fn(),
      stats: vi.fn(),
      activity: vi.fn(),
      systemStatus: vi.fn(),
      conversations: vi.fn(),
      conversation: vi.fn(),
      evaluations: vi.fn(),
      search: vi.fn(),
      searchHistory: vi.fn(),
      deleteConversation: vi.fn(),
    },
    uploadDocuments: vi.fn(),
    streamChat: vi.fn(),
  };
});

import { api, ApiError, streamChat, uploadDocuments } from "@/api/client";
import AuthPage from "@/pages/AuthPage";
import DashboardPage from "@/pages/DashboardPage";
import DocumentsPage from "@/pages/DocumentsPage";
import AssistantPage from "@/pages/AssistantPage";
import SearchPage from "@/pages/SearchPage";

const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const status = {
  gemini_configured: true, gemini_model: "gemini-2.5-flash", embedding_model: "bge", reranker_model: "ce", reranker_enabled: true,
  vector_store: "qdrant-embedded", qdrant_healthy: true, database: "sqlite", ocr_available: true, chunk_size: 1000,
  chunk_overlap: 150, retrieval_top_k: 20, rerank_top_n: 6, rrf_k: 60, max_upload_mb: 25,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.me.mockResolvedValue(testUser);
  m.documents.mockResolvedValue([readyDoc]);
  m.systemStatus.mockResolvedValue(status);
  m.conversations.mockResolvedValue([]);
  m.evaluations.mockResolvedValue([]);
  m.searchHistory.mockResolvedValue([]);
});

describe("Login", () => {
  it("validates input and signs in", async () => {
    m.login.mockResolvedValue({ access_token: "t", token_type: "bearer", user: testUser });
    renderPage(<AuthPage mode="login" />, { route: "/login", authed: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(m.login).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Work email"), "jordan@firm.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(m.login).toHaveBeenCalledWith({ email: "jordan@firm.com", password: "secret123" }));
    expect(localStorage.getItem("lm-token")).toBe("t");
  });
});

describe("Dashboard", () => {
  it("shows real stats from the backend", async () => {
    m.stats.mockResolvedValue({
      total_documents: 2, total_pages: 6, total_chunks: 22, storage_bytes: 1, documents_by_status: { ready: 2, processing: 0, pending: 0, failed: 0 },
      total_queries: 5, chat_queries: 3, search_queries: 2, avg_retrieval_ms: 412.4, avg_response_ms: 2100, total_conversations: 1,
      analyses: {}, avg_processing_ms: 1200,
    });
    m.activity.mockResolvedValue({ series: [], recent_documents: [], recent_activity: [], recent_conversations: [] });
    renderPage(<DashboardPage />);
    expect(await screen.findByText("412 ms")).toBeInTheDocument();
    expect(screen.getByText("3 assistant · 2 search")).toBeInTheDocument();
    expect(screen.getByText(/Good (morning|afternoon|evening), Jordan/)).toBeInTheDocument();
  });

  it("shows an empty state for a new account instead of fake data", async () => {
    m.stats.mockResolvedValue({
      total_documents: 0, total_pages: 0, total_chunks: 0, storage_bytes: 0, documents_by_status: { ready: 0, processing: 0, pending: 0, failed: 0 },
      total_queries: 0, chat_queries: 0, search_queries: 0, avg_retrieval_ms: null, avg_response_ms: null, total_conversations: 0, analyses: {}, avg_processing_ms: null,
    });
    m.activity.mockResolvedValue({ series: [], recent_documents: [], recent_activity: [], recent_conversations: [] });
    renderPage(<DashboardPage />);
    expect(await screen.findByText("Your workspace is ready")).toBeInTheDocument();
    expect(screen.getByText("No queries yet")).toBeInTheDocument();
  });

  it("shows an error state when the API fails", async () => {
    m.stats.mockRejectedValue(new ApiError(500, "Internal server error. Check the backend logs."));
    m.activity.mockResolvedValue({ series: [], recent_documents: [], recent_activity: [], recent_conversations: [] });
    renderPage(<DashboardPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Internal server error");
  });
});

describe("Documents", () => {
  it("lists documents and uploads a PDF", async () => {
    (uploadDocuments as any).mockResolvedValue({ uploaded: [readyDoc], rejected: [] });
    renderPage(<DocumentsPage />);
    expect(await screen.findByText("msa.pdf")).toBeInTheDocument();
    const file = new File(["%PDF-1.4"], "contract.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Choose PDF files"), { target: { files: [file] } });
    await waitFor(() => expect(uploadDocuments).toHaveBeenCalled());
    expect((uploadDocuments as any).mock.calls[0][0][0].name).toBe("contract.pdf");
  });

  it("rejects non-PDF files client-side", async () => {
    renderPage(<DocumentsPage />);
    await screen.findByText("msa.pdf");
    const file = new File(["hi"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Choose PDF files"), { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 20));
    expect(uploadDocuments).not.toHaveBeenCalled();
  });
});

describe("Assistant chat", () => {
  it("streams an answer and renders citations", async () => {
    (streamChat as any).mockImplementation(async (_body: unknown, onEvent: (e: any) => void) => {
      onEvent({ type: "meta", conversation_id: "c1", title: "t", rewritten_query: "q", retrieval_ms: 10, sources: [] });
      onEvent({ type: "token", text: "Notice is ninety days " });
      onEvent({
        type: "final",
        conversation_id: "c1",
        message: {
          id: "m1", role: "assistant", content: "Notice is ninety days [S1].", created_at: "2026-11-21T00:00:00Z",
          meta: { total_ms: 900 },
          citations: [{ source_id: 1, chunk_id: "abc12345", document_id: "d1", document_name: "msa.pdf", page_number: 2, text: "ninety (90) days notice", score: 7.1 }],
        },
      });
    });
    m.conversation.mockResolvedValue({ id: "c1", title: "t", created_at: "", updated_at: "", message_count: 2, document_ids: null, messages: [] });
    renderPage(<AssistantPage />, { route: "/assistant", path: "/assistant/:conversationId?" });
    const user = userEvent.setup();
    const box = await screen.findByLabelText("Ask a question");
    await waitFor(() => expect(box).not.toBeDisabled());
    await user.type(box, "What is the notice period?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() => expect(streamChat).toHaveBeenCalled());
    expect((streamChat as any).mock.calls[0][0].question).toBe("What is the notice period?");
    expect(await screen.findByText("What is the notice period?")).toBeInTheDocument();
    expect(await screen.findByText("Sources cited")).toBeInTheDocument();
    expect(screen.getAllByTitle("msa.pdf, page 2").length).toBeGreaterThanOrEqual(2); // inline [S1] marker + source chip
  });
});

describe("Search", () => {
  it("runs a hybrid search and shows page-level results", async () => {
    m.search.mockResolvedValue({
      query: "liability cap", mode: "hybrid", latency_ms: 120, reranked: true,
      results: [{ chunk_id: "c1", document_id: "d1", document_name: "msa.pdf", page_number: 3, text: "The liability cap is twelve months of fees.", score: 6.2, semantic_rank: 1, keyword_rank: 2, rerank_score: 6.2 }],
    });
    renderPage(<SearchPage />, { route: "/search" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Search query"), "liability cap");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("page 3")).toBeInTheDocument();
    expect(screen.getByText("sem #1")).toBeInTheDocument();
    expect(screen.getByText("bm25 #2")).toBeInTheDocument();
    expect(m.search).toHaveBeenCalledWith(expect.objectContaining({ query: "liability cap", mode: "hybrid" }));
  });

  it("shows API errors", async () => {
    m.search.mockRejectedValue(new ApiError(429, "Rate limit exceeded. Try again in 30s."));
    renderPage(<SearchPage />, { route: "/search" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Search query"), "x");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Rate limit exceeded");
  });
});
