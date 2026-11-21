"""Embedding models. The real model (BAAI/bge-small-en-v1.5) is lazy-loaded on first use."""
from __future__ import annotations

import hashlib
import logging
import math
import re
import threading
from typing import Protocol

from app.config import get_settings

logger = logging.getLogger(__name__)

BGE_QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "


class Embedder(Protocol):
    dim: int
    name: str

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class SentenceTransformerEmbedder:
    def __init__(self, model_name: str, batch_size: int = 32):
        self.name = model_name
        self.batch_size = batch_size
        self._model = None
        self._lock = threading.Lock()
        self.dim = 384 if "small" in model_name else 768

    def _load(self):
        if self._model is None:
            with self._lock:
                if self._model is None:
                    from sentence_transformers import SentenceTransformer

                    logger.info("Loading embedding model %s ...", self.name)
                    self._model = SentenceTransformer(self.name, device="cpu")
                    self.dim = int(self._model.get_sentence_embedding_dimension())
        return self._model

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        model = self._load()
        vecs = model.encode(
            texts, batch_size=self.batch_size, normalize_embeddings=True, show_progress_bar=False
        )
        return [v.tolist() for v in vecs]

    def embed_query(self, text: str) -> list[float]:
        model = self._load()
        prefix = BGE_QUERY_INSTRUCTION if "bge" in self.name.lower() else ""
        return model.encode(prefix + text, normalize_embeddings=True, show_progress_bar=False).tolist()


class HashEmbedder:
    """Deterministic bag-of-words hashing embedder — used in unit tests (no model download)."""

    name = "hash-embedder"

    def __init__(self, dim: int = 384):
        self.dim = dim

    def _vec(self, text: str) -> list[float]:
        v = [0.0] * self.dim
        for tok in re.findall(r"[a-z0-9]+", text.lower()):
            h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
            v[h % self.dim] += 1.0
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / norm for x in v]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vec(text)


_embedder: Embedder | None = None
_lock = threading.Lock()


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        with _lock:
            if _embedder is None:
                _embedder = SentenceTransformerEmbedder(get_settings().embedding_model)
    return _embedder


def set_embedder(embedder: Embedder | None) -> None:
    """Override the embedder (tests)."""
    global _embedder
    _embedder = embedder
