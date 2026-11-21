"""Cross-encoder reranking (cross-encoder/ms-marco-MiniLM-L-6-v2) with redundancy removal."""
from __future__ import annotations

import logging
import re
import threading
from typing import Protocol

from app.config import get_settings
from app.services.retrieval_types import RetrievedChunk

logger = logging.getLogger(__name__)


class Scorer(Protocol):
    name: str

    def score(self, query: str, passages: list[str]) -> list[float]: ...


class CrossEncoderScorer:
    def __init__(self, model_name: str):
        self.name = model_name
        self._model = None
        self._lock = threading.Lock()

    def _load(self):
        if self._model is None:
            with self._lock:
                if self._model is None:
                    from sentence_transformers import CrossEncoder

                    logger.info("Loading cross-encoder %s ...", self.name)
                    self._model = CrossEncoder(self.name, device="cpu", max_length=512)
        return self._model

    def score(self, query: str, passages: list[str]) -> list[float]:
        if not passages:
            return []
        model = self._load()
        scores = model.predict([(query, p) for p in passages], batch_size=16, show_progress_bar=False)
        return [float(s) for s in scores]


class OverlapScorer:
    """Deterministic token-overlap scorer used in unit tests."""

    name = "overlap-scorer"

    def score(self, query: str, passages: list[str]) -> list[float]:
        q = set(re.findall(r"[a-z0-9]+", query.lower()))
        out = []
        for p in passages:
            t = set(re.findall(r"[a-z0-9]+", p.lower()))
            out.append(len(q & t) / (len(q) or 1))
        return out


_scorer: Scorer | None = None
_lock = threading.Lock()


def get_scorer() -> Scorer:
    global _scorer
    if _scorer is None:
        with _lock:
            if _scorer is None:
                _scorer = CrossEncoderScorer(get_settings().reranker_model)
    return _scorer


def set_scorer(scorer: Scorer | None) -> None:
    global _scorer
    _scorer = scorer


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def jaccard(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def remove_redundant(chunks: list[RetrievedChunk], threshold: float = 0.85) -> list[RetrievedChunk]:
    """Drop passages that are near-duplicates of a higher-ranked passage from the SAME document
    (e.g. chunk overlap). Similar clauses in different documents are kept: they are distinct evidence."""
    kept: list[RetrievedChunk] = []
    for c in chunks:
        if any(k.document_id == c.document_id and jaccard(c.text, k.text) >= threshold for k in kept):
            continue
        kept.append(c)
    return kept


def rerank(query: str, chunks: list[RetrievedChunk], top_n: int, scorer: Scorer | None = None) -> list[RetrievedChunk]:
    if not chunks:
        return []
    scorer = scorer or get_scorer()
    scores = scorer.score(query, [c.text for c in chunks])
    for c, s in zip(chunks, scores):
        c.rerank_score = s
    ordered = sorted(chunks, key=lambda c: c.rerank_score or 0.0, reverse=True)
    return remove_redundant(ordered)[:top_n]
