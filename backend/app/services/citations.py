"""Context construction with numbered sources, and citation validation.

The LLM must cite sources as [S1], [S2] ... Each marker is validated against the list of
chunks that were actually retrieved; invalid markers are removed so no citation can point to
a passage (or page) that the system did not retrieve."""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.reranker import jaccard
from app.services.retrieval_types import RetrievedChunk

_MARKER_GROUP = re.compile(r"\[(\s*S\d+\s*(?:[,;]\s*S?\d+\s*)*)\]", re.IGNORECASE)
_NUM = re.compile(r"\d+")


@dataclass
class Source:
    source_id: int
    chunk: RetrievedChunk

    def as_citation(self) -> dict:
        c = self.chunk
        return {
            "source_id": self.source_id,
            "chunk_id": c.chunk_id,
            "document_id": c.document_id,
            "document_name": c.document_name,
            "page_number": c.page_number,
            "text": c.text,
            "score": c.rerank_score if c.rerank_score is not None else c.score,
        }


def build_context(chunks: list[RetrievedChunk], max_chars: int = 14000) -> tuple[str, list[Source]]:
    """Number passages, drop duplicates, keep document/page metadata, respect a char budget."""
    sources: list[Source] = []
    parts: list[str] = []
    used = 0
    for c in chunks:
        if any(s.chunk.document_id == c.document_id and jaccard(c.text, s.chunk.text) > 0.9 for s in sources):
            continue
        sid = len(sources) + 1
        block = f"[S{sid}] Document: {c.document_name} | Page: {c.page_number}\n{c.text.strip()}\n"
        if used + len(block) > max_chars and sources:
            break
        sources.append(Source(sid, c))
        parts.append(block)
        used += len(block)
    return "\n".join(parts), sources


def validate_citations(answer: str, sources: list[Source]) -> tuple[str, list[dict], list[str]]:
    """Return (cleaned_answer, citations_used, invalid_markers)."""
    valid_ids = {s.source_id for s in sources}
    by_id = {s.source_id: s for s in sources}
    used: list[int] = []
    invalid: list[str] = []

    def _replace(m: re.Match) -> str:
        nums = [int(n) for n in _NUM.findall(m.group(1))]
        good = [n for n in nums if n in valid_ids]
        for n in nums:
            if n not in valid_ids:
                invalid.append(f"S{n}")
        for n in good:
            if n not in used:
                used.append(n)
        if not good:
            return ""
        return "".join(f"[S{n}]" for n in dict.fromkeys(good))

    cleaned = _MARKER_GROUP.sub(_replace, answer)
    cleaned = re.sub(r"[ \t]+([.,;:])", r"\1", cleaned)
    citations = [by_id[n].as_citation() for n in sorted(used)]
    return cleaned.strip(), citations, invalid


def validate_source_ids(ids: list, sources: list[Source]) -> list[dict]:
    """Map a list of source ids (ints or 'S3' strings) from structured LLM output to real citations."""
    by_id = {s.source_id: s for s in sources}
    out: list[dict] = []
    seen: set[int] = set()
    for raw in ids or []:
        m = _NUM.search(str(raw))
        if not m:
            continue
        n = int(m.group())
        if n in by_id and n not in seen:
            seen.add(n)
            out.append(by_id[n].as_citation())
    return out


def verify_quote(quote: str, sources: list[Source], citation_ids: list[int]) -> tuple[str, bool]:
    """Check that an 'extracted text' quote really appears in a cited source.
    If not verifiable, fall back to the cited passage text so we never show fabricated wording."""
    norm = lambda s: re.sub(r"\s+", " ", s).strip().lower()  # noqa: E731
    q = norm(quote or "")
    by_id = {s.source_id: s for s in sources}
    cited = [by_id[i] for i in citation_ids if i in by_id]
    for s in cited:
        if q and q[:200] in norm(s.chunk.text):
            return quote.strip(), True
    for s in cited:
        if q and jaccard(q, s.chunk.text) > 0.6:
            return quote.strip(), True
    if cited:
        text = cited[0].chunk.text.strip()
        return (text[:600] + ("…" if len(text) > 600 else "")), False
    return "", False
