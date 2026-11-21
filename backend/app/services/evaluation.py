"""RAG evaluation with Ragas (Faithfulness, Answer Relevancy, Context Precision, Context Recall).

Each question is run through the real LegalMind RAG pipeline; the generated answer and the
retrieved contexts are then scored by Ragas using Gemini as the judge LLM and the local
bge-small embedding model. Scores are never fabricated: if a run cannot execute, the run is
marked failed with the actual reason."""
from __future__ import annotations

import logging
import math
import warnings
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from app.config import get_settings
from app.database import SessionLocal
from app.models import Evaluation, EvaluationDataset
from app.services.llm import LLMUnavailableError, get_llm, llm_available
from app.services.rag_pipeline import answer, no_context_answer, prepare_query

logger = logging.getLogger(__name__)

METRICS = ["faithfulness", "answer_relevancy", "context_precision", "context_recall"]
FAIL_THRESHOLD = 0.5

SAMPLE_DATASET = {
    "name": "Sample · Northwind–Brightline MSA (2025)",
    "description": (
        "SAMPLE dataset written for the bundled sample contract "
        "'Northwind_Brightline_Master_Services_Agreement_2025.pdf' (see sample_data/). Upload that PDF "
        "before running. Results are real Ragas scores, but they measure the system on sample data only."
    ),
    "questions": [
        ("What is the monthly service fee under the Master Services Agreement and when are invoices due?",
         "The Client pays a fixed monthly fee of USD 18,500. Invoices are issued monthly in advance and are payable within thirty (30) days of the invoice date."),
        ("How much notice must the Client give to terminate the agreement for convenience?",
         "The Client may terminate for convenience by giving at least ninety (90) days' prior written notice to the Provider."),
        ("What is the cap on the Provider's total liability?",
         "The Provider's aggregate liability is limited to the total fees paid by the Client in the twelve (12) months preceding the event giving rise to the claim, and indirect or consequential losses are excluded."),
        ("How long do the confidentiality obligations last after the agreement ends?",
         "The confidentiality obligations survive for five (5) years after termination or expiry of the agreement."),
        ("How are disputes resolved and which law governs the agreement?",
         "Disputes are finally resolved by arbitration in London under the LCIA Rules, and the agreement is governed by the laws of England and Wales."),
        ("What uptime does the Provider commit to and what happens if it is missed?",
         "The Provider commits to 99.5% monthly availability. For each 0.5% below that, the Client receives a service credit of 5% of the monthly fee, capped at 25% of the monthly fee."),
    ],
}

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ragas")
_sync = False


def set_sync_mode(v: bool) -> None:
    global _sync
    _sync = v


def submit(evaluation_id: str, document_ids: list[str] | None) -> None:
    if _sync:
        run_evaluation(evaluation_id, document_ids)
    else:
        _executor.submit(run_evaluation, evaluation_id, document_ids)


def _update(evaluation_id: str, **fields) -> None:
    with SessionLocal() as db:
        ev = db.get(Evaluation, evaluation_id)
        if ev is None:
            return
        for k, v in fields.items():
            setattr(ev, k, v)
        db.commit()


def _clean(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else round(f, 4)


def _build_ragas_judges():
    """Gemini (via LangChain) as judge LLM + local bge-small embeddings."""
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_huggingface import HuggingFaceEmbeddings
    from ragas.embeddings import LangchainEmbeddingsWrapper
    from ragas.llms import LangchainLLMWrapper

    s = get_settings()
    chat = ChatGoogleGenerativeAI(model=s.gemini_model, google_api_key=s.gemini_api_key.strip(), temperature=0)
    emb = HuggingFaceEmbeddings(model_name=s.embedding_model, encode_kwargs={"normalize_embeddings": True})
    return LangchainLLMWrapper(chat), LangchainEmbeddingsWrapper(emb)


def score_with_ragas(rows: list[dict]) -> tuple[list[dict[str, float | None]], str]:
    """Run Ragas on rows of {question, answer, contexts, ground_truth}. Returns per-row scores."""
    import ragas
    from ragas import EvaluationDataset, RunConfig, evaluate

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        from ragas.metrics import Faithfulness, LLMContextPrecisionWithReference, LLMContextRecall, ResponseRelevancy

        judge_llm, judge_emb = _build_ragas_judges()
        dataset = EvaluationDataset.from_list(
            [
                {
                    "user_input": r["question"],
                    "response": r["answer"],
                    "retrieved_contexts": r["contexts"] or [""],
                    "reference": r["ground_truth"],
                }
                for r in rows
            ]
        )
        metrics = [
            Faithfulness(),
            ResponseRelevancy(strictness=1),
            LLMContextPrecisionWithReference(),
            LLMContextRecall(),
        ]
        result = evaluate(
            dataset=dataset,
            metrics=metrics,
            llm=judge_llm,
            embeddings=judge_emb,
            run_config=RunConfig(max_workers=2, timeout=180, max_retries=3),
            raise_exceptions=False,
            show_progress=False,
        )
    df = result.to_pandas()
    colmap = {
        "faithfulness": "faithfulness",
        "answer_relevancy": "answer_relevancy",
        "llm_context_precision_with_reference": "context_precision",
        "context_precision": "context_precision",
        "context_recall": "context_recall",
    }
    out: list[dict[str, float | None]] = []
    for _, row in df.iterrows():
        scores: dict[str, float | None] = {m: None for m in METRICS}
        for col, key in colmap.items():
            if col in df.columns:
                scores[key] = _clean(row[col])
        out.append(scores)
    return out, ragas.__version__


def run_evaluation(evaluation_id: str, document_ids: list[str] | None, scorer=None) -> None:
    """Executes a run. `scorer` can be injected in tests (same signature as score_with_ragas)."""
    with SessionLocal() as db:
        ev = db.get(Evaluation, evaluation_id)
        if ev is None:
            return
        ds = db.get(EvaluationDataset, ev.dataset_id) if ev.dataset_id else None
        user_id = ev.user_id
        questions = [(q.question, q.ground_truth) for q in (ds.questions if ds else [])]
    total = len(questions)
    try:
        if not llm_available():
            get_llm()  # raises LLMUnavailableError with an actionable message
        rows: list[dict] = []
        for i, (question, gt) in enumerate(questions, start=1):
            _update(evaluation_id, metric_results={"progress": {"done": i - 1, "total": total, "stage": "generating answers"}})
            with SessionLocal() as db:
                prep = prepare_query(db, user_id, question, [], document_ids)
            result = answer(prep) if prep.sources else no_context_answer(document_ids)
            if result.llm_error:
                raise LLMUnavailableError(result.llm_error)
            rows.append(
                {
                    "question": question,
                    "ground_truth": gt,
                    "answer": result.content,
                    "contexts": [s.chunk.text for s in prep.sources],
                    "context_meta": [
                        {"document_name": s.chunk.document_name, "page_number": s.chunk.page_number, "text": s.chunk.text}
                        for s in prep.sources
                    ],
                    "retrieval_ms": round(prep.retrieval.retrieval_ms, 1),
                }
            )
        _update(evaluation_id, metric_results={"progress": {"done": total, "total": total, "stage": "scoring with Ragas"}})
        scores, version = (scorer or score_with_ragas)(rows)

        out_rows = []
        for r, sc in zip(rows, scores):
            reasons = []
            for m in METRICS:
                v = sc.get(m)
                if v is None:
                    reasons.append(f"{m} could not be computed")
                elif v < FAIL_THRESHOLD:
                    reasons.append(f"{m} below {FAIL_THRESHOLD}")
            if not r["contexts"]:
                reasons.insert(0, "no passages retrieved")
            out_rows.append(
                {
                    "question": r["question"],
                    "ground_truth": r["ground_truth"],
                    "answer": r["answer"],
                    "contexts": r["context_meta"],
                    "retrieval_ms": r["retrieval_ms"],
                    "scores": sc,
                    "failed": bool(reasons),
                    "failure_reasons": reasons,
                }
            )
        aggregate: dict[str, float | None] = {}
        for m in METRICS:
            vals = [r["scores"][m] for r in out_rows if r["scores"].get(m) is not None]
            aggregate[m] = round(sum(vals) / len(vals), 4) if vals else None
        if all(v is None for v in aggregate.values()):
            raise RuntimeError("Ragas could not compute any metric (judge LLM calls failed). Check the Gemini key/quota and backend logs.")
        s = get_settings()
        _update(
            evaluation_id,
            status="completed",
            completed_at=datetime.now(timezone.utc),
            metric_results={
                "aggregate": aggregate,
                "rows": out_rows,
                "ragas_version": version,
                "config": {
                    "judge_llm": s.gemini_model,
                    "embedding_model": s.embedding_model,
                    "retrieval": "hybrid (semantic + BM25, RRF) + cross-encoder rerank" if s.reranker_enabled else "hybrid (semantic + BM25, RRF)",
                    "top_k": s.retrieval_top_k,
                    "rerank_top_n": s.rerank_top_n,
                    "fail_threshold": FAIL_THRESHOLD,
                    "document_ids": document_ids,
                },
            },
        )
    except LLMUnavailableError as exc:
        _update(evaluation_id, status="failed", error=str(exc), completed_at=datetime.now(timezone.utc), metric_results=None)
    except Exception as exc:
        logger.exception("Evaluation %s failed", evaluation_id)
        _update(evaluation_id, status="failed", error=f"{exc.__class__.__name__}: {str(exc)[:400]}",
                completed_at=datetime.now(timezone.utc), metric_results=None)


def fail_stale_runs() -> None:
    """Runs interrupted by a restart can't resume; mark them failed with the real reason."""
    from sqlalchemy import update

    with SessionLocal() as db:
        db.execute(
            update(Evaluation).where(Evaluation.status == "running").values(
                status="failed", error="Interrupted: the backend restarted while this evaluation was running.",
                completed_at=datetime.now(timezone.utc),
            )
        )
        db.commit()
