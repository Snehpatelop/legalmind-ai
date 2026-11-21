/* Centralised API service: JWT handling, JSON requests, uploads with progress, SSE streaming. */
import type {
  Analysis,
  CompareResult,
  Conversation,
  ConversationDetail,
  DashboardActivity,
  DashboardStats,
  DocumentItem,
  EvalDataset,
  EvalQuestion,
  Evaluation,
  Message,
  RiskResult,
  SearchHistoryItem,
  SearchMode,
  SearchResponse,
  SummaryResult,
  SystemStatus,
  TokenResponse,
  UploadResult,
  User,
  Citation,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const TOKEN_KEY = "lm-token";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

function authHeaders(): Record<string, string> {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`;
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") message = data.detail;
    else if (Array.isArray(data?.detail)) message = data.detail.map((d: { msg: string }) => d.msg).join(", ");
  } catch {
    if (res.status === 502 || res.status === 504) message = "The backend is not reachable. Is it running?";
  }
  if (res.status === 401 && onUnauthorized) onUnauthorized();
  return new ApiError(res.status, message);
}

export async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...authHeaders(),
        ...(headers as Record<string, string>),
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the LegalMind AI backend. Check that it is running.");
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function fetchBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw await parseError(res);
  return res.blob();
}

export async function downloadFile(path: string, filename: string) {
  const blob = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function uploadDocuments(files: File[], onProgress?: (pct: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/documents/upload`);
    const t = tokenStore.get();
    if (t) xhr.setRequestHeader("Authorization", `Bearer ${t}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as UploadResult);
      else {
        if (xhr.status === 401 && onUnauthorized) onUnauthorized();
        reject(new ApiError(xhr.status, (data && data.detail) || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Upload failed: backend not reachable"));
    xhr.send(form);
  });
}

export type StreamEvent =
  | { type: "meta"; conversation_id: string; title: string; rewritten_query: string; retrieval_ms: number; sources: Citation[] }
  | { type: "token"; text: string }
  | { type: "final"; conversation_id: string; message: Message }
  | { type: "error"; detail: string };

export async function streamChat(
  body: { question: string; conversation_id?: string | null; document_ids?: string[] | null; regenerate?: boolean },
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/chat/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeaders() },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw new ApiError(0, "Cannot reach the LegalMind AI backend.");
  }
  if (!res.ok || !res.body) throw await parseError(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = raw.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
      } catch {
        /* ignore malformed */
      }
    }
  }
}

export const api = {
  // auth
  register: (b: { name: string; email: string; password: string }) =>
    request<TokenResponse>("/api/auth/register", { method: "POST", json: b }),
  login: (b: { email: string; password: string }) => request<TokenResponse>("/api/auth/login", { method: "POST", json: b }),
  me: () => request<User>("/api/auth/me"),
  // documents
  documents: () => request<DocumentItem[]>("/api/documents"),
  document: (id: string) => request<DocumentItem>(`/api/documents/${id}`),
  deleteDocument: (id: string) => request<void>(`/api/documents/${id}`, { method: "DELETE" }),
  reindexDocument: (id: string) => request<DocumentItem>(`/api/documents/${id}/reindex`, { method: "POST" }),
  pageText: (id: string, page: number) =>
    request<{ document_id: string; page_number: number; page_count: number; text: string }>(`/api/documents/${id}/pages/${page}`),
  // chat
  conversations: () => request<Conversation[]>("/api/chat/conversations"),
  conversation: (id: string) => request<ConversationDetail>(`/api/chat/conversations/${id}`),
  deleteConversation: (id: string) => request<void>(`/api/chat/conversations/${id}`, { method: "DELETE" }),
  // analysis
  summarize: (docId: string, length: "short" | "medium" | "detailed") =>
    request<Analysis<SummaryResult>>(`/api/analysis/summarize/${docId}`, { method: "POST", json: { length } }),
  contractRisk: (docId: string) => request<Analysis<RiskResult>>(`/api/analysis/contract-risk/${docId}`, { method: "POST" }),
  compare: (a: string, b: string) =>
    request<Analysis<CompareResult>>("/api/analysis/compare", { method: "POST", json: { document_a_id: a, document_b_id: b } }),
  analyses: <T,>(params: { document_id?: string; analysis_type?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return request<Analysis<T>[]>(`/api/analysis${q ? `?${q}` : ""}`);
  },
  deleteAnalysis: (id: string) => request<void>(`/api/analysis/${id}`, { method: "DELETE" }),
  // search
  search: (b: { query: string; mode: SearchMode; document_ids?: string[] | null; top_k?: number; rerank?: boolean }) =>
    request<SearchResponse>("/api/search", { method: "POST", json: b }),
  searchHistory: () => request<SearchHistoryItem[]>("/api/search/history"),
  clearSearchHistory: () => request<void>("/api/search/history", { method: "DELETE" }),
  // evaluation
  datasets: () => request<EvalDataset[]>("/api/evaluation/datasets"),
  createDataset: (b: { name: string; description?: string; questions?: { question: string; ground_truth: string }[] }) =>
    request<EvalDataset>("/api/evaluation/datasets", { method: "POST", json: b }),
  createSampleDataset: () => request<EvalDataset>("/api/evaluation/datasets/sample", { method: "POST" }),
  deleteDataset: (id: string) => request<void>(`/api/evaluation/datasets/${id}`, { method: "DELETE" }),
  addQuestion: (id: string, b: { question: string; ground_truth: string }) =>
    request<EvalQuestion>(`/api/evaluation/datasets/${id}/questions`, { method: "POST", json: b }),
  deleteQuestion: (id: string, qid: string) =>
    request<void>(`/api/evaluation/datasets/${id}/questions/${qid}`, { method: "DELETE" }),
  runEvaluation: (dataset_id: string, document_ids?: string[] | null) =>
    request<Evaluation>("/api/evaluation/run", { method: "POST", json: { dataset_id, document_ids } }),
  evaluations: () => request<Evaluation[]>("/api/evaluation/results"),
  deleteEvaluation: (id: string) => request<void>(`/api/evaluation/results/${id}`, { method: "DELETE" }),
  // dashboard / system
  stats: () => request<DashboardStats>("/api/dashboard/stats"),
  activity: (days = 14) => request<DashboardActivity>(`/api/dashboard/activity?days=${days}`),
  systemStatus: () => request<SystemStatus>("/api/system/status"),
};
