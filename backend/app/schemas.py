"""Pydantic request/response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

import re

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator
from typing_extensions import Annotated

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _check_email(v: str) -> str:
    v = v.strip().lower()
    if len(v) > 255 or not _EMAIL_RE.match(v):
        raise ValueError("Enter a valid email address")
    return v


# Format check only: local/demo domains such as .local or .test are allowed.
EmailStr = Annotated[str, AfterValidator(_check_email)]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Auth ----------
class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name is required")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(ORM):
    id: str
    name: str
    email: str
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- Documents ----------
class DocumentOut(ORM):
    id: str
    filename: str
    file_size: int
    page_count: int
    chunk_count: int
    processing_status: str
    status_message: str | None = None
    ocr_pages: int = 0
    processing_ms: int | None = None
    created_at: datetime
    processed_at: datetime | None = None


class UploadResult(BaseModel):
    uploaded: list[DocumentOut]
    rejected: list[dict[str, str]]


class PageText(BaseModel):
    document_id: str
    page_number: int
    page_count: int
    text: str


# ---------- Citations / retrieval ----------
class Citation(BaseModel):
    source_id: int
    chunk_id: str
    document_id: str
    document_name: str
    page_number: int
    text: str
    score: float | None = None


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    mode: Literal["semantic", "keyword", "hybrid"] = "hybrid"
    document_ids: list[str] | None = None
    top_k: int = Field(default=10, ge=1, le=50)
    rerank: bool = True


class SearchHit(BaseModel):
    chunk_id: str
    document_id: str
    document_name: str
    page_number: int
    text: str
    score: float
    semantic_rank: int | None = None
    keyword_rank: int | None = None
    rerank_score: float | None = None


class SearchResponse(BaseModel):
    query: str
    mode: str
    results: list[SearchHit]
    latency_ms: float
    reranked: bool


class SearchHistoryItem(BaseModel):
    id: str
    query: str
    mode: str | None
    result_count: int
    total_ms: float
    created_at: datetime


# ---------- Chat ----------
class ChatQuery(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None
    document_ids: list[str] | None = None
    stream: bool = False
    regenerate: bool = False


class MessageOut(ORM):
    id: str
    role: str
    content: str
    citations: list[dict[str, Any]] | None = None
    meta: dict[str, Any] | None = None
    created_at: datetime


class ConversationOut(ORM):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0


class ConversationDetail(ConversationOut):
    document_ids: list[str] | None = None
    messages: list[MessageOut]


class ChatResponse(BaseModel):
    conversation_id: str
    message: MessageOut
    rewritten_query: str
    citations: list[Citation]
    retrieval_ms: float
    total_ms: float


# ---------- Analysis ----------
class SummarizeRequest(BaseModel):
    length: Literal["short", "medium", "detailed"] = "medium"


class CompareRequest(BaseModel):
    document_a_id: str
    document_b_id: str


class AnalysisOut(ORM):
    id: str
    document_id: str
    analysis_type: str
    result: dict[str, Any]
    created_at: datetime


# ---------- Evaluation ----------
class EvalQuestionIn(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    ground_truth: str = Field(min_length=1, max_length=4000)


class EvalQuestionOut(ORM):
    id: str
    question: str
    ground_truth: str
    created_at: datetime


class EvalDatasetIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    questions: list[EvalQuestionIn] = Field(default_factory=list)


class EvalDatasetOut(ORM):
    id: str
    name: str
    description: str | None
    is_sample: bool
    created_at: datetime
    questions: list[EvalQuestionOut]


class EvalRunRequest(BaseModel):
    dataset_id: str
    document_ids: list[str] | None = None


class EvaluationOut(ORM):
    id: str
    dataset_id: str | None
    dataset_name: str
    is_sample: bool
    status: str
    error: str | None
    metric_results: dict[str, Any] | None
    created_at: datetime
    completed_at: datetime | None
