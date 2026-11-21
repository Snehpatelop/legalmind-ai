"""BM25 keyword retrieval with exact-phrase support.

Indexes are built per user from the document_chunks table (the source of truth), cached in
memory and invalidated whenever that user's documents change."""
from __future__ import annotations

import re
import threading
from dataclasses import dataclass

from rank_bm25 import BM25Okapi
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Document, DocumentChunk
from app.services.retrieval_types import RetrievedChunk

STOPWORDS = frozenset(
    """a an and are as at be been but by for from has have he her his i if in into is it its
    of on or our she such that the their them then there these they this those to was were
    which while who will with you your shall""".split()
)
_TOKEN = re.compile(r"[a-z0-9]+(?:['’][a-z]+)?")
_PHRASE = re.compile(r'"([^"]{2,})"')


def tokenize(text: str) -> list[str]:
    toks = _TOKEN.findall(text.lower())
    return [_stem(t) for t in toks if t not in STOPWORDS]


def _stem(tok: str) -> str:
    """Very light suffix stripping so 'terminate'/'termination'/'terminated' share a root."""
    for suf in ("ations", "ation", "ings", "ing", "ies", "ed", "es", "s"):
        if len(tok) > len(suf) + 3 and tok.endswith(suf):
            return tok[: -len(suf)]
    return tok


def extract_phrases(query: str) -> list[str]:
    return [p.strip().lower() for p in _PHRASE.findall(query) if p.strip()]


@dataclass
class _UserIndex:
    bm25: BM25Okapi | None
    meta: list[tuple[str, str, str, int, int]]  # chunk_id, document_id, document_name, page, chunk_index


class BM25Store:
    def __init__(self) -> None:
        self._cache: dict[str, _UserIndex] = {}
        self._lock = threading.Lock()

    def invalidate(self, user_id: str) -> None:
        with self._lock:
            self._cache.pop(user_id, None)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()

    def _build(self, db: Session, user_id: str) -> _UserIndex:
        rows = db.execute(
            select(
                DocumentChunk.id,
                DocumentChunk.document_id,
                DocumentChunk.document_name,
                DocumentChunk.page_number,
                DocumentChunk.chunk_index,
                DocumentChunk.chunk_text,
            )
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(DocumentChunk.user_id == user_id, Document.processing_status == "ready")
            .order_by(DocumentChunk.document_id, DocumentChunk.chunk_index)
        ).all()
        corpus = [tokenize(r.chunk_text) or ["__empty__"] for r in rows]
        meta = [(r.id, r.document_id, r.document_name, r.page_number, r.chunk_index) for r in rows]
        return _UserIndex(bm25=BM25Okapi(corpus) if corpus else None, meta=meta)

    def _get(self, db: Session, user_id: str) -> _UserIndex:
        with self._lock:
            idx = self._cache.get(user_id)
        if idx is None:
            idx = self._build(db, user_id)
            with self._lock:
                self._cache[user_id] = idx
        return idx

    def search(
        self, db: Session, user_id: str, query: str, document_ids: list[str] | None, limit: int
    ) -> list[RetrievedChunk]:
        idx = self._get(db, user_id)
        if idx.bm25 is None:
            return []
        q_tokens = tokenize(query)
        phrases = extract_phrases(query)
        if not q_tokens and not phrases:
            return []
        scores = idx.bm25.get_scores(q_tokens) if q_tokens else [0.0] * len(idx.meta)
        allowed = set(document_ids) if document_ids else None

        candidates = [
            (i, float(s))
            for i, s in enumerate(scores)
            if (allowed is None or idx.meta[i][1] in allowed)
        ]
        # Pull more than needed when phrases must be verified against full text.
        candidates.sort(key=lambda x: x[1], reverse=True)
        pool = candidates if phrases else [c for c in candidates if c[1] > 0][: limit]
        if not pool:
            return []

        ids = [idx.meta[i][0] for i, _ in pool]
        texts = self._texts(db, user_id, ids)
        results: list[RetrievedChunk] = []
        for i, score in pool:
            cid, did, dname, page, cidx = idx.meta[i]
            text = texts.get(cid)
            if text is None:
                continue
            if phrases:
                low = text.lower()
                matched = sum(1 for p in phrases if p in low)
                if matched == 0:
                    continue
                score = score + 10.0 * matched  # exact phrase matches dominate
            results.append(
                RetrievedChunk(
                    chunk_id=cid, document_id=did, document_name=dname, page_number=page,
                    text=text, score=score, keyword_score=score, chunk_index=cidx,
                )
            )
        results.sort(key=lambda r: r.score, reverse=True)
        results = results[:limit]
        for rank, r in enumerate(results, start=1):
            r.keyword_rank = rank
        return results

    @staticmethod
    def _texts(db: Session, user_id: str, ids: list[str]) -> dict[str, str]:
        out: dict[str, str] = {}
        for i in range(0, len(ids), 500):
            batch = ids[i : i + 500]
            for cid, text in db.execute(
                select(DocumentChunk.id, DocumentChunk.chunk_text).where(
                    DocumentChunk.id.in_(batch), DocumentChunk.user_id == user_id
                )
            ):
                out[cid] = text
        return out


bm25_store = BM25Store()
