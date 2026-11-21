from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RetrievedChunk:
    chunk_id: str
    document_id: str
    document_name: str
    page_number: int
    text: str
    score: float = 0.0
    semantic_rank: int | None = None
    keyword_rank: int | None = None
    semantic_score: float | None = None
    keyword_score: float | None = None
    rrf_score: float | None = None
    rerank_score: float | None = None
    chunk_index: int = 0

    def to_hit(self) -> dict:
        return {
            "chunk_id": self.chunk_id,
            "document_id": self.document_id,
            "document_name": self.document_name,
            "page_number": self.page_number,
            "text": self.text,
            "score": float(self.rerank_score if self.rerank_score is not None else self.score),
            "semantic_rank": self.semantic_rank,
            "keyword_rank": self.keyword_rank,
            "rerank_score": self.rerank_score,
        }
