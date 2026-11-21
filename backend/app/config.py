"""Application configuration loaded from environment variables / .env file."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Looks for .env in the repo root first, then in backend/
        env_file=(str(REPO_ROOT / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- General ---
    app_name: str = "LegalMind AI"
    environment: str = "development"
    log_level: str = "INFO"

    # --- Security ---
    jwt_secret: str = "change-me-in-production-please-use-a-long-random-string"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    cors_origins: str = "http://localhost:5173,http://localhost:8080,http://127.0.0.1:5173"
    rate_limit_per_minute: int = 120
    ai_rate_limit_per_minute: int = 20

    # --- Database ---
    # Docker uses PostgreSQL. Local (no-Docker) mode falls back to SQLite automatically.
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'data' / 'legalmind.db').as_posix()}"

    # --- Storage ---
    storage_dir: str = str(BACKEND_DIR / "data" / "uploads")
    max_upload_mb: int = 25
    max_files_per_upload: int = 10

    # --- Vector database ---
    # If qdrant_url is set, a Qdrant server is used. Otherwise an embedded on-disk Qdrant is used.
    qdrant_url: str = ""
    qdrant_api_key: str = ""
    qdrant_path: str = str(BACKEND_DIR / "data" / "qdrant")
    qdrant_collection: str = "legalmind_chunks"

    # --- Models ---
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    reranker_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    reranker_enabled: bool = True
    preload_models: bool = False
    hf_home: str = ""

    # --- Gemini ---
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_temperature: float = 0.2

    # --- Chunking / retrieval ---
    chunk_size: int = 1000
    chunk_overlap: int = 150
    retrieval_top_k: int = 20
    rerank_top_n: int = 6
    rrf_k: int = 60
    max_context_chars: int = 14000
    ocr_enabled: bool = True
    ocr_language: str = "eng"

    @field_validator("database_url")
    @classmethod
    def _fix_postgres_scheme(cls, v: str) -> str:
        # Allow plain postgres:// URLs and use the psycopg3 driver.
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://"):]
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def gemini_configured(self) -> bool:
        key = self.gemini_api_key.strip()
        return bool(key) and not key.lower().startswith("your")

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    max_upload_bytes: int = Field(default=0, exclude=True)

    def model_post_init(self, __context) -> None:  # noqa: D401
        self.max_upload_bytes = self.max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
