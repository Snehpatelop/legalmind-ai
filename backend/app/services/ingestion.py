"""Document ingestion pipeline, run in a background worker thread.

Upload -> validation -> extraction (per page) -> cleaning -> chunking -> metadata ->
embedding (batched) -> Qdrant -> chunk table (BM25 source) -> ready."""
from __future__ import annotations

import hashlib
import logging
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select

from app.config import get_settings
from app.database import SessionLocal
from app.models import Document, DocumentChunk
from app.services.bm25_index import bm25_store
from app.services.chunker import chunk_pages
from app.services.embeddings import get_embedder
from app.services.pdf_processor import PDFProcessingError, extract_pdf
from app.services.vector_store import get_vector_store

logger = logging.getLogger(__name__)

EMBED_BATCH = 64
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ingest")
_sync_mode = False  # tests run ingestion inline


def set_sync_mode(value: bool) -> None:
    global _sync_mode
    _sync_mode = value


_SAFE_NAME = re.compile(r"[^A-Za-z0-9._\- ()\[\]&,']+")


def sanitize_filename(name: str) -> str:
    """Display name only — never used to build a filesystem path."""
    name = unicodedata.normalize("NFKC", name or "document.pdf")
    name = Path(name.replace("\\", "/")).name  # strip any directory components
    name = _SAFE_NAME.sub("_", name).strip(" .") or "document.pdf"
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return name[:200]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def user_storage_dir(user_id: str) -> Path:
    base = Path(get_settings().storage_dir).resolve()
    # user ids are UUIDs; validate to be safe
    if not re.fullmatch(r"[0-9a-f\-]{36}", user_id):
        raise ValueError("invalid user id")
    p = (base / user_id).resolve()
    if base not in p.parents:
        raise ValueError("path traversal detected")
    p.mkdir(parents=True, exist_ok=True)
    return p


def storage_path_for(user_id: str, document_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f\-]{36}", document_id):
        raise ValueError("invalid document id")
    return user_storage_dir(user_id) / f"{document_id}.pdf"


def resolve_storage_path(stored: str) -> Path:
    """Ensure a stored path lives inside the storage directory before reading it."""
    base = Path(get_settings().storage_dir).resolve()
    p = Path(stored).resolve()
    if base not in p.parents:
        raise PermissionError("File outside storage directory")
    return p


def submit(document_id: str) -> None:
    if _sync_mode:
        process_document(document_id)
    else:
        _executor.submit(process_document, document_id)


def _set_status(document_id: str, status: str, message: str | None = None, **fields) -> None:
    with SessionLocal() as db:
        doc = db.get(Document, document_id)
        if doc is None:
            return
        doc.processing_status = status
        doc.status_message = message
        for k, v in fields.items():
            setattr(doc, k, v)
        db.commit()


def process_document(document_id: str) -> None:
    s = get_settings()
    t0 = time.perf_counter()
    with SessionLocal() as db:
        doc = db.get(Document, document_id)
        if doc is None:
            return
        user_id, filename, path = doc.user_id, doc.filename, doc.storage_path
    _set_status(document_id, "processing", "Extracting text")
    try:
        extraction = extract_pdf(str(resolve_storage_path(path)), ocr_enabled=s.ocr_enabled, ocr_language=s.ocr_language)
        _set_status(document_id, "processing", "Chunking and embedding", page_count=extraction.page_count)

        chunks = chunk_pages(
            extraction.pages,
            document_id=document_id,
            user_id=user_id,
            document_name=filename,
            chunk_size=s.chunk_size,
            chunk_overlap=s.chunk_overlap,
        )
        if not chunks:
            raise PDFProcessingError("The PDF did not contain enough text to index.")

        store = get_vector_store()
        store.delete_document(user_id, document_id)  # idempotent re-indexing
        embedder = get_embedder()
        for i in range(0, len(chunks), EMBED_BATCH):
            batch = chunks[i : i + EMBED_BATCH]
            vectors = embedder.embed_documents([c.contextual_text() for c in batch])
            store.upsert(batch, vectors)

        with SessionLocal() as db:
            db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))
            db.add_all(
                DocumentChunk(
                    id=c.chunk_id,
                    document_id=c.document_id,
                    user_id=c.user_id,
                    document_name=c.document_name,
                    page_number=c.page_number,
                    chunk_index=c.chunk_index,
                    chunk_text=c.chunk_text,
                )
                for c in chunks
            )
            doc = db.get(Document, document_id)
            if doc is None:  # deleted while processing
                db.rollback()
                store.delete_document(user_id, document_id)
                return
            doc.processing_status = "ready"
            doc.status_message = "; ".join(extraction.warnings) or None
            doc.page_count = extraction.page_count
            doc.chunk_count = len(chunks)
            doc.ocr_pages = extraction.ocr_pages
            doc.processing_ms = int((time.perf_counter() - t0) * 1000)
            doc.processed_at = datetime.now(timezone.utc)
            db.commit()
        bm25_store.invalidate(user_id)
        logger.info("Indexed document %s: %d pages, %d chunks", document_id, extraction.page_count, len(chunks))
    except PDFProcessingError as exc:
        _set_status(document_id, "failed", str(exc))
    except Exception as exc:  # never leak stack traces to the client
        logger.exception("Ingestion failed for %s", document_id)
        _set_status(document_id, "failed", f"Processing failed: {exc.__class__.__name__}. Check backend logs.")


def delete_document_data(user_id: str, document_id: str) -> None:
    try:
        get_vector_store().delete_document(user_id, document_id)
    except Exception:
        logger.exception("Failed to delete vectors for %s", document_id)
    bm25_store.invalidate(user_id)


def resume_pending() -> int:
    """Re-queue documents that were mid-processing when the server stopped."""
    with SessionLocal() as db:
        ids = list(
            db.scalars(select(Document.id).where(Document.processing_status.in_(["pending", "processing"])))
        )
    for did in ids:
        submit(did)
    return len(ids)
