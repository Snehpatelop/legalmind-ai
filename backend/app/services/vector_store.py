"""Qdrant vector store. Uses a Qdrant server when QDRANT_URL is set (Docker), otherwise an
embedded on-disk Qdrant (no extra service needed for local development)."""
from __future__ import annotations

import logging
import threading
from pathlib import Path

from qdrant_client import QdrantClient
from qdrant_client.http import models as qm

from app.config import get_settings
from app.services.chunker import Chunk
from app.services.retrieval_types import RetrievedChunk

logger = logging.getLogger(__name__)


class VectorStore:
    def __init__(self, client: QdrantClient, collection: str):
        self.client = client
        self.collection = collection
        self._lock = threading.RLock()
        self._ready_dim: int | None = None

    # ---- setup ----
    def ensure_collection(self, dim: int) -> None:
        if self._ready_dim == dim:
            return
        with self._lock:
            if not self.client.collection_exists(self.collection):
                self.client.create_collection(
                    self.collection,
                    vectors_config=qm.VectorParams(size=dim, distance=qm.Distance.COSINE),
                )
                for field in ("user_id", "document_id") if get_settings().qdrant_url else ():
                    try:
                        self.client.create_payload_index(
                            self.collection, field_name=field, field_schema=qm.PayloadSchemaType.KEYWORD
                        )
                    except Exception:  # embedded mode doesn't support payload indexes
                        pass
            else:
                info = self.client.get_collection(self.collection)
                params = info.config.params.vectors
                existing = params.size if isinstance(params, qm.VectorParams) else None
                if existing is not None and existing != dim:
                    raise RuntimeError(
                        f"Qdrant collection '{self.collection}' has dimension {existing} but the embedding "
                        f"model produces {dim}. Change QDRANT_COLLECTION or delete the collection."
                    )
            self._ready_dim = dim

    # ---- write ----
    def upsert(self, chunks: list[Chunk], vectors: list[list[float]], batch_size: int = 128) -> None:
        if not chunks:
            return
        self.ensure_collection(len(vectors[0]))
        with self._lock:
            for i in range(0, len(chunks), batch_size):
                points = [
                    qm.PointStruct(id=c.chunk_id, vector=v, payload=c.payload())
                    for c, v in zip(chunks[i : i + batch_size], vectors[i : i + batch_size])
                ]
                self.client.upsert(self.collection, points=points, wait=True)

    def delete_document(self, user_id: str, document_id: str) -> None:
        with self._lock:
            if not self.client.collection_exists(self.collection):
                return
            self.client.delete(
                self.collection,
                points_selector=qm.FilterSelector(filter=self._filter(user_id, [document_id])),
                wait=True,
            )

    # ---- read ----
    @staticmethod
    def _filter(user_id: str, document_ids: list[str] | None) -> qm.Filter:
        must: list[qm.Condition] = [qm.FieldCondition(key="user_id", match=qm.MatchValue(value=user_id))]
        if document_ids:
            must.append(qm.FieldCondition(key="document_id", match=qm.MatchAny(any=list(document_ids))))
        return qm.Filter(must=must)

    def search(
        self, vector: list[float], user_id: str, document_ids: list[str] | None, limit: int
    ) -> list[RetrievedChunk]:
        with self._lock:
            if not self.client.collection_exists(self.collection):
                return []
            self.ensure_collection(len(vector))
            res = self.client.query_points(
                self.collection,
                query=vector,
                query_filter=self._filter(user_id, document_ids),
                limit=limit,
                with_payload=True,
            ).points
        out: list[RetrievedChunk] = []
        for rank, p in enumerate(res, start=1):
            pl = p.payload or {}
            # Defence in depth: never return another user's chunk even if a filter misbehaves.
            if pl.get("user_id") != user_id:
                continue
            out.append(
                RetrievedChunk(
                    chunk_id=str(pl.get("chunk_id", p.id)),
                    document_id=pl["document_id"],
                    document_name=pl.get("document_name", ""),
                    page_number=int(pl.get("page_number", 0)),
                    text=pl.get("chunk_text", ""),
                    score=float(p.score),
                    semantic_score=float(p.score),
                    semantic_rank=rank,
                    chunk_index=int(pl.get("chunk_index", 0)),
                )
            )
        return out

    def count(self, user_id: str | None = None) -> int:
        with self._lock:
            if not self.client.collection_exists(self.collection):
                return 0
            flt = self._filter(user_id, None) if user_id else None
            return self.client.count(self.collection, count_filter=flt, exact=True).count

    def healthy(self) -> bool:
        try:
            with self._lock:
                self.client.get_collections()
            return True
        except Exception:
            return False


_store: VectorStore | None = None
_lock = threading.Lock()


def get_vector_store() -> VectorStore:
    global _store
    if _store is None:
        with _lock:
            if _store is None:
                s = get_settings()
                if s.qdrant_url:
                    client = QdrantClient(url=s.qdrant_url, api_key=s.qdrant_api_key or None, timeout=30)
                    logger.info("Using Qdrant server at %s", s.qdrant_url)
                else:
                    Path(s.qdrant_path).mkdir(parents=True, exist_ok=True)
                    client = QdrantClient(path=s.qdrant_path)
                    logger.info("Using embedded Qdrant at %s", s.qdrant_path)
                _store = VectorStore(client, s.qdrant_collection)
    return _store


def set_vector_store(store: VectorStore | None) -> None:
    global _store
    _store = store
