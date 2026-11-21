export interface User {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export type DocStatus = "pending" | "processing" | "ready" | "failed";

export interface DocumentItem {
  id: string;
  filename: string;
  file_size: number;
  page_count: number;
  chunk_count: number;
  processing_status: DocStatus;
  status_message: string | null;
  ocr_pages: number;
  processing_ms: number | null;
  created_at: string;
  processed_at: string | null;
}

export interface UploadResult {
  uploaded: DocumentItem[];
  rejected: { filename: string; reason: string }[];
}

export interface Citation {
  source_id: number;
  chunk_id: string;
  document_id?: string;
  document_name: string;
  page_number: number;
  text: string;
  score?: number | null;
}

export interface MessageMeta {
  rewritten_query?: string;
  rewrite_method?: string;
  retrieval_ms?: number;
  total_ms?: number;
  candidates?: number;
  sources_considered?: number;
  reranked?: boolean;
  invalid_citations_removed?: string[];
  llm_error?: string | null;
  grounded?: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[] | null;
  meta: MessageMeta | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface ConversationDetail extends Conversation {
  document_ids: string[] | null;
  messages: Message[];
}

export type SearchMode = "semantic" | "keyword" | "hybrid";

export interface SearchHit {
  chunk_id: string;
  document_id: string;
  document_name: string;
  page_number: number;
  text: string;
  score: number;
  semantic_rank: number | null;
  keyword_rank: number | null;
  rerank_score: number | null;
}

export interface SearchResponse {
  query: string;
  mode: SearchMode;
  results: SearchHit[];
  latency_ms: number;
  reranked: boolean;
}

export interface SearchHistoryItem {
  id: string;
  query: string;
  mode: SearchMode | null;
  result_count: number;
  total_ms: number;
  created_at: string;
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface RiskFinding {
  category: string;
  clause_name: string;
  extracted_text: string;
  quote_verified: boolean;
  potential_risk: string;
  explanation: string;
  risk_level: RiskLevel;
  document_name: string;
  page_number: number;
  citations: Citation[];
}

export interface RiskResult {
  document_id: string;
  document_name: string;
  overall_risk: RiskLevel;
  overview: string;
  counts: Record<RiskLevel, number>;
  findings: RiskFinding[];
  missing_clauses: { category: string; note: string }[];
  categories: { key: string; name: string }[];
  unsupported_findings_removed: number;
  sources_reviewed: number;
  duration_ms: number;
  disclaimer: string;
}

export interface CitedItem {
  text?: string;
  name?: string;
  role?: string;
  date?: string;
  description?: string;
  citations: Citation[];
}

export interface SummaryResult {
  document_id: string;
  document_name: string;
  length: "short" | "medium" | "detailed";
  coverage: "full" | "partial";
  executive_summary: string;
  executive_summary_citations: Citation[];
  parties: CitedItem[];
  important_dates: CitedItem[];
  key_obligations: CitedItem[];
  financial_obligations: CitedItem[];
  termination_provisions: CitedItem[];
  liability_conditions: CitedItem[];
  confidentiality_provisions: CitedItem[];
  potential_risks: CitedItem[];
  unsupported_items_removed: number;
  duration_ms: number;
  disclaimer: string;
}

export interface CompareSide {
  summary: string;
  citations: Citation[];
}

export interface CompareAspect {
  aspect: string;
  status: "common" | "different" | "missing_in_a" | "missing_in_b" | "missing_in_both";
  document_a: CompareSide;
  document_b: CompareSide;
  key_differences: string;
  wording_changes: string[];
  inconsistencies: string[];
}

export interface CompareResult {
  document_a: { id: string; name: string };
  document_b: { id: string; name: string };
  overview: string;
  aspects: CompareAspect[];
  counts: { common: number; different: number; missing: number };
  duration_ms: number;
  disclaimer: string;
}

export interface Analysis<T = unknown> {
  id: string;
  document_id: string;
  analysis_type: "summary" | "contract_risk" | "comparison";
  result: T;
  created_at: string;
}

export interface EvalQuestion {
  id: string;
  question: string;
  ground_truth: string;
  created_at: string;
}

export interface EvalDataset {
  id: string;
  name: string;
  description: string | null;
  is_sample: boolean;
  created_at: string;
  questions: EvalQuestion[];
}

export interface EvalRow {
  question: string;
  ground_truth: string;
  answer: string;
  contexts: { document_name: string; page_number: number; text: string }[];
  scores: Record<string, number | null>;
  failed: boolean;
  failure_reasons: string[];
  error?: string | null;
}

export interface EvalMetricResults {
  progress?: { done: number; total: number; stage: string };
  aggregate?: Record<string, number | null>;
  rows?: EvalRow[];
  config?: Record<string, unknown>;
  ragas_version?: string;
}

export interface Evaluation {
  id: string;
  dataset_id: string | null;
  dataset_name: string;
  is_sample: boolean;
  status: "running" | "completed" | "failed";
  error: string | null;
  metric_results: EvalMetricResults | null;
  created_at: string;
  completed_at: string | null;
}

export interface DashboardStats {
  total_documents: number;
  total_pages: number;
  total_chunks: number;
  storage_bytes: number;
  documents_by_status: Record<DocStatus, number>;
  total_queries: number;
  chat_queries: number;
  search_queries: number;
  avg_retrieval_ms: number | null;
  avg_response_ms: number | null;
  total_conversations: number;
  analyses: Record<string, number>;
  avg_processing_ms: number | null;
}

export interface DashboardActivity {
  series: { date: string; uploads: number; chat: number; search: number; avg_retrieval_ms: number | null }[];
  recent_documents: { id: string; filename: string; status: DocStatus; page_count: number; created_at: string }[];
  recent_activity: { type: string; label: string; created_at: string; meta: Record<string, unknown> }[];
  recent_conversations: { id: string; title: string; last_message_at: string }[];
}

export interface SystemStatus {
  gemini_configured: boolean;
  gemini_model: string;
  embedding_model: string;
  reranker_model: string;
  reranker_enabled: boolean;
  vector_store: string;
  qdrant_healthy: boolean;
  database: string;
  ocr_available: boolean;
  chunk_size: number;
  chunk_overlap: number;
  retrieval_top_k: number;
  rerank_top_n: number;
  rrf_k: number;
  max_upload_mb: number;
}
