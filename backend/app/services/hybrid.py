"""Semantic, keyword and hybrid retrieval with Reciprocal Rank Fusion."""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.bm25_index import bm25_store
from app.services.embeddings import get_embedder
from app.services.reranker import rerank
from app.services.retrieval_types import RetrievedChunk
from app.services.vector_store import get_vector_store


def reciprocal_rank_fusion(
    result_lists: list[list[RetrievedChunk]], k: int = 60, weights: list[float] | None = None
) -> list[RetrievedChunk]:
    """RRF: score(d) = sum_i w_i / (k + rank_i(d)). Ranks are 1-based."""
    weights = weights or [1.0] * len(result_lists)
    fused: dict[str, RetrievedChunk] = {}
    scores: dict[str, float] = {}
    for weight, results in zip(weights, result_lists):
        for rank, item in enumerate(results, start=1):
            scores[item.chunk_id] = scores.get(item.chunk_id, 0.0) + weight / (k + rank)
            existing = fused.get(item.chunk_id)
            if existing is None:
                fused[item.chunk_id] = item
            else:  # merge rank information from both retrievers
                existing.semantic_rank = existing.semantic_rank or item.semantic_rank
                existing.keyword_rank = existing.keyword_rank or item.keyword_rank
                existing.semantic_score = existing.semantic_score if existing.semantic_score is not None else item.semantic_score
                existing.keyword_score = existing.keyword_score if existing.keyword_score is not None else item.keyword_score
    out = []
    for cid, item in fused.items():
        item.rrf_score = scores[cid]
        item.score = scores[cid]
        out.append(item)
    out.sort(key=lambda c: c.score, reverse=True)
    return out


@dataclass
class RetrievalResult:
    chunks: list[RetrievedChunk]
    retrieval_ms: float
    reranked: bool
    candidates: int = 0
    timings: dict[str, float] = field(default_factory=dict)


def semantic_search(user_id: str, query: str, document_ids: list[str] | None, limit: int) -> list[RetrievedChunk]:
    vec = get_embedder().embed_query(query)
    return get_vector_store().search(vec, user_id, document_ids, limit)


def keyword_search(db: Session, user_id: str, query: str, document_ids: list[str] | None, limit: int) -> list[RetrievedChunk]:
    return bm25_store.search(db, user_id, query, document_ids, limit)


def retrieve(
    db: Session,
    user_id: str,
    query: str,
    *,
    mode: str = "hybrid",
    document_ids: list[str] | None = None,
    top_k: int | None = None,
    use_rerank: bool = True,
    rerank_top_n: int | None = None,
) -> RetrievalResult:
    s = get_settings()
    top_k = top_k or s.retrieval_top_k
    timings: dict[str, float] = {}
    t0 = time.perf_counter()

    if mode == "semantic":
        t = time.perf_counter()
        candidates = semantic_search(user_id, query, document_ids, top_k)
        timings["semantic_ms"] = (time.perf_counter() - t) * 1000
    elif mode == "keyword":
        t = time.perf_counter()
        candidates = keyword_search(db, user_id, query, document_ids, top_k)
        timings["keyword_ms"] = (time.perf_counter() - t) * 1000
    else:
        t = time.perf_counter()
        sem = semantic_search(user_id, query, document_ids, top_k)
        timings["semantic_ms"] = (time.perf_counter() - t) * 1000
        t = time.perf_counter()
        kw = keyword_search(db, user_id, query, document_ids, top_k)
        timings["keyword_ms"] = (time.perf_counter() - t) * 1000
        candidates = reciprocal_rank_fusion([sem, kw], k=s.rrf_k)[:top_k]

    n_candidates = len(candidates)
    reranked = False
    final_n = rerank_top_n or s.rerank_top_n
    if use_rerank and s.reranker_enabled and candidates:
        t = time.perf_counter()
        chunks = rerank(query, candidates, top_n=final_n)
        timings["rerank_ms"] = (time.perf_counter() - t) * 1000
        reranked = True
    else:
        chunks = candidates[:final_n]

    return RetrievalResult(
        chunks=chunks,
        retrieval_ms=(time.perf_counter() - t0) * 1000,
        reranked=reranked,
        candidates=n_candidates,
        timings=timings,
    )
