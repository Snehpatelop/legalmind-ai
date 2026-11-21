"""Conversational RAG: rewrite -> hybrid retrieve -> rerank -> context -> Gemini -> validate citations."""
from __future__ import annotations

import time
from collections.abc import Iterator
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.citations import Source, build_context, validate_citations
from app.services.hybrid import RetrievalResult, retrieve
from app.services.llm import LLMUnavailableError, get_llm
from app.services.query_processing import rewrite_query

SYSTEM_PROMPT = """You are LegalMind AI, an intelligent document-grounded legal research assistant.

Answer questions using the provided document context.

Never invent legal facts, clauses, dates, legal provisions or citations.

Clearly distinguish between information explicitly mentioned in uploaded documents and general explanations.

If the provided context is insufficient, state that the available documents do not contain enough information.

Cite the exact source document and page number for factual claims.

Never pretend to have reviewed a document that was not retrieved.

You provide informational assistance and are not a substitute for professional legal advice.

CITATION FORMAT: The context is a numbered list of sources [S1], [S2], ... After every factual
claim taken from the documents, add the matching marker(s), e.g. "The term is 24 months [S2]."
Only use markers for sources that appear in the context. Never cite a page or document that is
not in the context. If you add general explanation that is not from the documents, label it
clearly as "General note:" and do not attach a source marker to it.

STYLE: Use concise Markdown. Lead with the direct answer, then supporting detail as bullet points
where helpful. Quote short key phrases of the contract verbatim when they matter."""

INSUFFICIENT_ANSWER = (
    "The available documents do not contain enough information to answer this question. "
    "No relevant passages were found in your {scope}. Try rephrasing the question, selecting different "
    "documents, or uploading the relevant agreement."
)


@dataclass
class PreparedQuery:
    question: str
    rewritten: str
    rewrite_method: str
    retrieval: RetrievalResult
    context: str
    sources: list[Source]
    prompt: str
    started: float = field(default_factory=time.perf_counter)


def build_prompt(question: str, rewritten: str, context: str, history: list[tuple[str, str]]) -> str:
    convo = ""
    if history:
        convo = "CONVERSATION SO FAR (for reference resolution only):\n" + "\n".join(
            f"{r.upper()}: {c[:800]}" for r, c in history[-6:]
        ) + "\n\n"
    rq = f"\n(Interpreted as: {rewritten})" if rewritten.strip().lower() != question.strip().lower() else ""
    return (
        f"{convo}DOCUMENT CONTEXT:\n{context}\n\n"
        f"QUESTION: {question}{rq}\n\n"
        "Answer using only the document context above, with [S#] citation markers."
    )


def prepare_query(
    db: Session,
    user_id: str,
    question: str,
    history: list[tuple[str, str]],
    document_ids: list[str] | None,
) -> PreparedQuery:
    started = time.perf_counter()
    s = get_settings()
    rewritten, method = rewrite_query(question, history)
    retrieval = retrieve(db, user_id, rewritten, mode="hybrid", document_ids=document_ids)
    context, sources = build_context(retrieval.chunks, max_chars=s.max_context_chars)
    prompt = build_prompt(question, rewritten, context, history)
    return PreparedQuery(question, rewritten, method, retrieval, context, sources, prompt, started)


@dataclass
class AnswerResult:
    content: str
    citations: list[dict]
    invalid_citations: list[str]
    llm_error: str | None = None
    grounded: bool = True


def no_context_answer(document_ids: list[str] | None) -> AnswerResult:
    scope = "selected documents" if document_ids else "uploaded documents"
    return AnswerResult(INSUFFICIENT_ANSWER.format(scope=scope), [], [], grounded=False)


def llm_unavailable_answer(prep: PreparedQuery, error: str) -> AnswerResult:
    """No AI answer is fabricated — we show the retrieved evidence and the actual reason."""
    lines = [
        f"**AI answer unavailable:** {error}",
        "",
        "The most relevant passages retrieved from your documents are attached below as evidence, "
        "so you can review them directly.",
    ]
    return AnswerResult("\n".join(lines), [s.as_citation() for s in prep.sources], [], llm_error=error, grounded=False)


def answer(prep: PreparedQuery) -> AnswerResult:
    if not prep.sources:
        return no_context_answer(None)
    try:
        raw = get_llm().generate(prep.prompt, system=SYSTEM_PROMPT)
    except LLMUnavailableError as exc:
        return llm_unavailable_answer(prep, str(exc))
    cleaned, cites, invalid = validate_citations(raw, prep.sources)
    return AnswerResult(cleaned, cites, invalid)


def stream_answer(prep: PreparedQuery) -> Iterator[str]:
    """Yield raw text deltas from Gemini. Raises LLMUnavailableError on failure."""
    yield from get_llm().stream(prep.prompt, system=SYSTEM_PROMPT)
