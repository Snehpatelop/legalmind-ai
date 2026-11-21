"""Test configuration: isolated SQLite DB, in-memory Qdrant, deterministic embedder/reranker
and a mocked Gemini LLM, so tests are fast, offline and deterministic."""
from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="legalmind-test-"))
os.environ.update(
    {
        "DATABASE_URL": f"sqlite:///{(_TMP / 'test.db').as_posix()}",
        "STORAGE_DIR": str(_TMP / "uploads"),
        "QDRANT_URL": "",
        "QDRANT_PATH": str(_TMP / "qdrant"),
        "GEMINI_API_KEY": "",
        "JWT_SECRET": "test-secret-key-that-is-long-enough-for-hs256",
        "RATE_LIMIT_PER_MINUTE": "0",
        "AI_RATE_LIMIT_PER_MINUTE": "0",
        "OCR_ENABLED": "false",
        "PRELOAD_MODELS": "false",
        "CHUNK_SIZE": "400",
        "CHUNK_OVERLAP": "60",
    }
)

import pymupdf as fitz  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from qdrant_client import QdrantClient  # noqa: E402

from app.config import get_settings  # noqa: E402

get_settings.cache_clear()

from app.main import app  # noqa: E402
from app.services import evaluation as eval_svc  # noqa: E402
from app.services import ingestion  # noqa: E402
from app.services.bm25_index import bm25_store  # noqa: E402
from app.services.embeddings import HashEmbedder, set_embedder  # noqa: E402
from app.services.llm import set_llm  # noqa: E402
from app.services.reranker import OverlapScorer, set_scorer  # noqa: E402
from app.services.vector_store import VectorStore, set_vector_store  # noqa: E402


class FakeLLM:
    """Deterministic stand-in for Gemini. Cites real and fake sources to exercise validation."""

    name = "fake-gemini"

    def __init__(self):
        self.calls: list[str] = []

    @staticmethod
    def _first_source(prompt: str, prefix: str = "") -> str:
        m = re.search(r"\[S(\d+)\]" + re.escape(prefix), prompt)
        return f"S{m.group(1)}" if m else "S1"

    def generate(self, prompt: str, *, system: str | None = None, json_mode: bool = False) -> str:
        self.calls.append(prompt)
        if not json_mode:
            if "Standalone query" in prompt:
                return "What is the notice period for termination of the agreement?"
            return "The agreement may be terminated with ninety days written notice [S1]. Fees are payable monthly [S1, S99]."
        if "Review the contract passages" in prompt:
            return json.dumps(
                {
                    "overall_risk": "HIGH",
                    "overview": "The agreement contains a broad suspension right.",
                    "findings": [
                        {
                            "category": "termination",
                            "clause_name": "Termination for convenience",
                            "extracted_text": "terminate this Agreement for convenience",
                            "potential_risk": "Short notice",
                            "explanation": "Either party may exit quickly.",
                            "risk_level": "HIGH",
                            "source_ids": ["S1"],
                        },
                        {
                            "category": "payment",
                            "clause_name": "Invented clause",
                            "extracted_text": "made up",
                            "potential_risk": "x",
                            "explanation": "x",
                            "risk_level": "LOW",
                            "source_ids": ["S999"],
                        },
                    ],
                    "missing_clauses": [{"category": "penalties", "note": "not found in retrieved passages"}],
                }
            )
        if "Compare Document A" in prompt:
            a = self._first_source(prompt, " | Document A")
            b = self._first_source(prompt, " | Document B")
            return json.dumps(
                {
                    "overview": "Payment terms differ.",
                    "aspects": [
                        {
                            "aspect": "Payment conditions",
                            "status": "different",
                            "document_a": {"summary": "Net 30", "source_ids": [a]},
                            "document_b": {"summary": "Net 45", "source_ids": [b, a]},
                            "key_differences": "Longer payment window in B",
                            "wording_changes": ["thirty -> forty-five"],
                            "inconsistencies": [],
                        }
                    ],
                }
            )
        if "Summarise the document" in prompt:
            return json.dumps(
                {
                    "executive_summary": "A services agreement.",
                    "executive_summary_source_ids": ["S1"],
                    "parties": [{"name": "Northwind Analytics Ltd", "role": "Provider", "source_ids": ["S1"]}],
                    "important_dates": [{"date": "1 March 2025", "description": "Effective date", "source_ids": ["S1"]}],
                    "key_obligations": [{"text": "Provide services", "source_ids": ["S1"]}, {"text": "Unsupported", "source_ids": []}],
                    "financial_obligations": [], "termination_provisions": [], "liability_conditions": [],
                    "confidentiality_provisions": [], "potential_risks": [],
                }
            )
        return "{}"

    def stream(self, prompt: str, *, system: str | None = None):
        self.calls.append(prompt)
        for piece in ["The notice period ", "is ninety days ", "[S1]."]:
            yield piece


CONTRACT_PAGES = [
    "MASTER SERVICES AGREEMENT\n\nThis Agreement is made between Northwind Analytics Ltd (the Provider) and "
    "Brightline Retail Inc (the Client), effective 1 March 2025.\n\n1. SERVICES. The Provider shall provide data "
    "analytics services described in Schedule A.",
    "2. FEES AND PAYMENT. The Client shall pay a monthly fee of USD 18,500. Invoices are payable within thirty (30) "
    "days. Late payments accrue interest at 1.5% per month.\n\n3. TERMINATION. The Client may terminate this Agreement "
    "for convenience on ninety (90) days written notice. Either party may terminate for material breach not cured "
    "within thirty days.",
    "4. LIMITATION OF LIABILITY. The Provider's total liability shall not exceed the fees paid in the twelve months "
    "preceding the claim. Neither party is liable for indirect or consequential loss.\n\n5. CONFIDENTIALITY. Each "
    "party shall keep Confidential Information secret for five years after termination.",
]


def make_pdf(path: Path, pages: list[str]) -> Path:
    doc = fitz.open()
    for text in pages:
        page = doc.new_page()
        page.insert_textbox(fitz.Rect(56, 56, 540, 790), text, fontsize=10)
    doc.save(str(path))
    doc.close()
    return path


@pytest.fixture(scope="session", autouse=True)
def _wire_services():
    set_embedder(HashEmbedder(384))
    set_scorer(OverlapScorer())
    set_vector_store(VectorStore(QdrantClient(":memory:"), "test_chunks"))
    ingestion.set_sync_mode(True)
    eval_svc.set_sync_mode(True)
    yield
    shutil.rmtree(_TMP, ignore_errors=True)


@pytest.fixture
def fake_llm():
    llm = FakeLLM()
    set_llm(llm)
    yield llm
    set_llm(None)


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:  # runs lifespan -> Alembic migrations on the test DB
        yield c


@pytest.fixture(scope="session")
def pdf_dir():
    d = _TMP / "pdfs"
    d.mkdir(exist_ok=True)
    return d


@pytest.fixture(scope="session")
def contract_pdf(pdf_dir) -> Path:
    return make_pdf(pdf_dir / "msa.pdf", CONTRACT_PAGES)


_counter = {"n": 0}


def register(client, name="Test User") -> dict:
    _counter["n"] += 1
    email = f"user{_counter['n']}@example.com"
    r = client.post("/api/auth/register", json={"name": name, "email": email, "password": "Sup3rSecret!"})
    assert r.status_code == 201, r.text
    data = r.json()
    return {"headers": {"Authorization": f"Bearer {data['access_token']}"}, "user": data["user"], "email": email}


@pytest.fixture
def user(client):
    return register(client)


@pytest.fixture
def other_user(client):
    return register(client, "Other User")


def upload(client, headers, path: Path, name: str | None = None):
    with open(path, "rb") as f:
        return client.post(
            "/api/documents/upload",
            headers=headers,
            files=[("files", (name or path.name, f.read(), "application/pdf"))],
        )


@pytest.fixture
def ready_doc(client, user, contract_pdf):
    r = upload(client, user["headers"], contract_pdf)
    assert r.status_code == 201, r.text
    doc = r.json()["uploaded"][0]
    assert doc["processing_status"] == "ready", doc
    return doc


@pytest.fixture(autouse=True)
def _reset_bm25():
    yield
    bm25_store.clear()
