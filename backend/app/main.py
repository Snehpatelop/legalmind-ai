"""LegalMind AI — FastAPI application entrypoint."""
from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.deps import get_current_user
from app.models import User

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("legalmind")

if settings.hf_home:
    import os

    os.environ.setdefault("HF_HOME", settings.hf_home)


def run_migrations() -> None:
    """Apply Alembic migrations on startup so a fresh checkout 'just works'."""
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    from app.config import BACKEND_DIR

    cfg = Config(str(Path(BACKEND_DIR) / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(BACKEND_DIR) / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(cfg, "head")


def _preload_models() -> None:
    try:
        from app.services.embeddings import get_embedder
        from app.services.reranker import get_scorer

        get_embedder().embed_query("warm up")
        if settings.reranker_enabled:
            get_scorer().score("warm up", ["warm up"])
        logger.info("ML models preloaded")
    except Exception:
        logger.exception("Model preload failed (models will load on first use)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations()
    from app.services.evaluation import fail_stale_runs
    from app.services.ingestion import resume_pending

    fail_stale_runs()
    n = resume_pending()
    if n:
        logger.info("Re-queued %d unfinished document(s)", n)
    if not settings.gemini_configured:
        logger.warning("GEMINI_API_KEY is not set: retrieval works, AI generation features will report it as unavailable.")
    if settings.preload_models:
        threading.Thread(target=_preload_models, daemon=True).start()
    yield


app = FastAPI(
    title="LegalMind AI API",
    version="1.0.0",
    description="Intelligent legal research & contract intelligence platform (advanced hybrid RAG).",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    errors = [
        {"field": ".".join(str(p) for p in e.get("loc", [])[1:]), "message": e.get("msg", "Invalid value")}
        for e in exc.errors()
    ]
    first = errors[0] if errors else {"field": "", "message": "Invalid request"}
    detail = f"{first['field']}: {first['message']}" if first["field"] else first["message"]
    return JSONResponse(status_code=422, content={"detail": detail, "errors": errors})


@app.exception_handler(Exception)
async def unhandled_handler(_: Request, exc: Exception):
    logger.exception("Unhandled error")
    return JSONResponse(status_code=500, content={"detail": "Internal server error. Check the backend logs."})


from app.api import analysis, auth, chat, dashboard, documents, evaluation, search  # noqa: E402

for r in (auth.router, documents.router, chat.router, analysis.router, search.router, evaluation.router, dashboard.router):
    app.include_router(r)


@app.get("/api/health", tags=["system"])
def health():
    from app.services.vector_store import get_vector_store

    return {"status": "ok", "qdrant": get_vector_store().healthy()}


@app.get("/api/system/status", tags=["system"])
def system_status(_: User = Depends(get_current_user)):
    """Non-secret runtime configuration shown on the Settings page."""
    from app.services.pdf_processor import ocr_available
    from app.services.vector_store import get_vector_store

    return {
        "gemini_configured": settings.gemini_configured,
        "gemini_model": settings.gemini_model,
        "embedding_model": settings.embedding_model,
        "reranker_model": settings.reranker_model,
        "reranker_enabled": settings.reranker_enabled,
        "vector_store": "qdrant-server" if settings.qdrant_url else "qdrant-embedded",
        "qdrant_healthy": get_vector_store().healthy(),
        "database": "sqlite" if settings.is_sqlite else "postgresql",
        "ocr_available": ocr_available(),
        "chunk_size": settings.chunk_size,
        "chunk_overlap": settings.chunk_overlap,
        "retrieval_top_k": settings.retrieval_top_k,
        "rerank_top_n": settings.rerank_top_n,
        "rrf_k": settings.rrf_k,
        "max_upload_mb": settings.max_upload_mb,
    }
