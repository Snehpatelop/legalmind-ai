"""Query normalisation and conversational query rewriting."""
from __future__ import annotations

import logging
import re

from app.services.llm import LLMUnavailableError, get_llm, llm_available

logger = logging.getLogger(__name__)

_WS = re.compile(r"\s+")
_REFERENTIAL = re.compile(
    r"\b(it|its|this|that|these|those|they|them|their|above|same|former|latter|such|"
    r"the clause|the section|the agreement|the contract|what about|and the|how about)\b",
    re.IGNORECASE,
)

REWRITE_SYSTEM = (
    "You rewrite follow-up questions into standalone search queries for a legal document "
    "retrieval system. Resolve pronouns and references using the conversation. Keep legal terms, "
    "party names, clause names and quoted phrases exactly. Do not answer the question. "
    "Output only the rewritten query on one line."
)


def normalize_query(q: str) -> str:
    q = _WS.sub(" ", q.replace("“", '"').replace("”", '"')).strip()
    return q


def needs_rewrite(query: str, history: list[tuple[str, str]]) -> bool:
    if not history:
        return False
    words = query.split()
    return len(words) <= 14 or bool(_REFERENTIAL.search(query))


def heuristic_rewrite(query: str, history: list[tuple[str, str]]) -> str:
    """Fallback when no LLM is available: attach the previous user question as context."""
    last_user = next((c for r, c in reversed(history) if r == "user"), None)
    if last_user and _REFERENTIAL.search(query):
        return normalize_query(f"{query} (context: {last_user[:300]})")
    return query


def rewrite_query(query: str, history: list[tuple[str, str]]) -> tuple[str, str]:
    """Return (rewritten_query, method). history = [(role, content), ...] oldest first."""
    query = normalize_query(query)
    if not needs_rewrite(query, history):
        return query, "none"
    if llm_available():
        convo = "\n".join(f"{r.upper()}: {c[:600]}" for r, c in history[-6:])
        prompt = f"Conversation:\n{convo}\n\nFollow-up question: {query}\n\nStandalone query:"
        try:
            out = get_llm().generate(prompt, system=REWRITE_SYSTEM).strip().splitlines()[0].strip()
            out = out.strip('"').strip()
            if 3 <= len(out) <= 600:
                return out, "llm"
        except (LLMUnavailableError, IndexError) as exc:
            logger.info("LLM query rewrite failed, using heuristic: %s", exc)
    rewritten = heuristic_rewrite(query, history)
    return rewritten, "heuristic" if rewritten != query else "none"
