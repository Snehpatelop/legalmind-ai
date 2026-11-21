import math
import os

import pytest
from qdrant_client import QdrantClient

from app.services.bm25_index import extract_phrases, tokenize
from app.services.chunker import Chunk
from app.services.citations import Source, build_context, validate_citations, validate_source_ids, verify_quote
from app.services.embeddings import HashEmbedder
from app.services.hybrid import reciprocal_rank_fusion
from app.services.reranker import OverlapScorer, remove_redundant, rerank
from app.services.retrieval_types import RetrievedChunk
from app.services.vector_store import VectorStore
from tests.conftest import upload


def rc(cid, text="x", **kw):
    return RetrievedChunk(chunk_id=cid, document_id="d", document_name="doc.pdf", page_number=1, text=text, **kw)


def test_hash_embedder_is_deterministic_and_normalised():
    e = HashEmbedder(64)
    a, b = e.embed_query("termination notice"), e.embed_query("termination notice")
    assert a == b and len(a) == 64
    assert math.isclose(sum(x * x for x in a), 1.0, rel_tol=1e-6)


def test_vector_store_filters_by_user_and_document():
    store = VectorStore(QdrantClient(":memory:"), "t")
    e = HashEmbedder(64)
    chunks = [
        Chunk("00000000-0000-0000-0000-000000000001", "doc-a", "user-1", "a.pdf", 1, 0, "termination notice ninety days"),
        Chunk("00000000-0000-0000-0000-000000000002", "doc-b", "user-1", "b.pdf", 2, 0, "payment within thirty days"),
        Chunk("00000000-0000-0000-0000-000000000003", "doc-c", "user-2", "c.pdf", 1, 0, "termination notice ninety days"),
    ]
    store.upsert(chunks, e.embed_documents([c.chunk_text for c in chunks]))
    q = e.embed_query("termination notice")
    res = store.search(q, "user-1", None, 10)
    assert {r.document_id for r in res} == {"doc-a", "doc-b"}  # never user-2's chunk
    assert res[0].document_id == "doc-a" and res[0].semantic_rank == 1
    only_b = store.search(q, "user-1", ["doc-b"], 10)
    assert [r.document_id for r in only_b] == ["doc-b"]
    store.delete_document("user-1", "doc-a")
    assert store.count("user-1") == 1


def test_rrf_rewards_agreement_between_retrievers():
    sem = [rc("a", semantic_rank=1), rc("b", semantic_rank=2), rc("c", semantic_rank=3)]
    kw = [rc("c", keyword_rank=1), rc("a", keyword_rank=2), rc("d", keyword_rank=3)]
    fused = reciprocal_rank_fusion([sem, kw], k=60)
    ids = [f.chunk_id for f in fused]
    assert ids[0] == "a"  # ranks 1 & 2 -> highest fused score
    assert set(ids) == {"a", "b", "c", "d"}
    a = fused[0]
    assert a.semantic_rank == 1 and a.keyword_rank == 2
    assert math.isclose(a.rrf_score, 1 / 61 + 1 / 62)


def test_rerank_orders_by_relevance_and_removes_duplicates():
    chunks = [
        rc("1", "payment fees invoice"),
        rc("2", "termination notice period ninety days"),
        rc("3", "termination notice period ninety days"),  # duplicate
    ]
    out = rerank("termination notice period", chunks, top_n=5, scorer=OverlapScorer())
    assert out[0].chunk_id == "2"
    assert [c.chunk_id for c in out].count("3") == 0
    assert len(remove_redundant([rc("a", "same text"), rc("b", "same text")])) == 1
    other_doc = RetrievedChunk(chunk_id="z", document_id="other", document_name="v2.pdf", page_number=1, text="same text")
    assert len(remove_redundant([rc("a", "same text"), other_doc])) == 2  # cross-document evidence is kept


def test_tokenizer_and_phrases():
    assert "terminat" in tokenize("Termination") or "termin" in "".join(tokenize("Termination"))
    assert "the" not in tokenize("the agreement")
    assert extract_phrases('find "limitation of liability" clause') == ["limitation of liability"]


def test_citation_validation_removes_fabricated_markers():
    sources = [Source(1, rc("c1", "ninety days notice")), Source(2, rc("c2", "fees monthly"))]
    cleaned, cites, invalid = validate_citations("Notice is 90 days [S1]. Fees [S2, S7]. Made up [S9].", sources)
    assert "[S9]" not in cleaned and "[S7]" not in cleaned
    assert "[S1]" in cleaned and "[S2]" in cleaned
    assert [c["chunk_id"] for c in cites] == ["c1", "c2"]
    assert set(invalid) == {"S7", "S9"}
    assert validate_source_ids(["S2", "S5", 1], sources)[0]["chunk_id"] == "c2"


def test_verify_quote_falls_back_to_real_text():
    sources = [Source(1, rc("c1", "The Client may terminate for convenience on ninety days notice."))]
    q, ok = verify_quote("terminate for convenience", sources, [1])
    assert ok and q == "terminate for convenience"
    q2, ok2 = verify_quote("totally invented wording here", sources, [1])
    assert not ok2 and q2.startswith("The Client may terminate")


def test_build_context_respects_budget_and_numbers_sources():
    chunks = [rc(str(i), f"passage number {i} " * 20) for i in range(10)]
    ctx, sources = build_context(chunks, max_chars=900)
    assert sources[0].source_id == 1 and "[S1]" in ctx
    assert len(ctx) <= 1100 and len(sources) < 10


def test_bm25_and_hybrid_search_endpoint(client, user, ready_doc):
    h = user["headers"]
    kw = client.post("/api/search", headers=h, json={"query": "limitation of liability", "mode": "keyword", "rerank": False})
    assert kw.status_code == 200
    res = kw.json()["results"]
    assert res and res[0]["page_number"] == 3 and res[0]["keyword_rank"] == 1

    phrase = client.post("/api/search", headers=h, json={"query": '"ninety (90) days"', "mode": "keyword", "rerank": False})
    assert phrase.json()["results"][0]["page_number"] == 2

    sem = client.post("/api/search", headers=h, json={"query": "confidential information secret", "mode": "semantic"})
    assert sem.status_code == 200 and sem.json()["results"]

    hyb = client.post("/api/search", headers=h, json={"query": "monthly fee invoices payable", "mode": "hybrid", "top_k": 3})
    body = hyb.json()
    assert body["reranked"] is True and len(body["results"]) <= 3
    assert body["results"][0]["page_number"] == 2
    assert client.get("/api/search/history", headers=h).json()[0]["query"] == "monthly fee invoices payable"


@pytest.mark.skipif(os.getenv("RUN_MODEL_TESTS") != "1", reason="set RUN_MODEL_TESTS=1 to test the real models")
def test_real_embedding_and_cross_encoder_models():
    from app.services.embeddings import SentenceTransformerEmbedder
    from app.services.reranker import CrossEncoderScorer

    emb = SentenceTransformerEmbedder("BAAI/bge-small-en-v1.5")
    docs = emb.embed_documents(["The tenant must pay rent monthly.", "Either party may terminate with 30 days notice."])
    q = emb.embed_query("How can the contract be ended?")
    assert len(q) == 384
    sims = [sum(a * b for a, b in zip(q, d)) for d in docs]
    assert sims[1] > sims[0]
    scores = CrossEncoderScorer("cross-encoder/ms-marco-MiniLM-L-6-v2").score(
        "How can the contract be ended?", ["The tenant must pay rent monthly.", "Either party may terminate with 30 days notice."]
    )
    assert scores[1] > scores[0]


def test_user_isolation_in_search(client, other_user, ready_doc):
    r = client.post("/api/search", headers=other_user["headers"], json={"query": "limitation of liability", "mode": "hybrid"})
    assert r.status_code == 200 and r.json()["results"] == []
    r2 = client.post("/api/search", headers=other_user["headers"], json={"query": "x", "document_ids": [ready_doc["id"]]})
    assert r2.status_code == 404


def test_upload_rejections(client, user, contract_pdf, pdf_dir):
    h = user["headers"]
    assert upload(client, h, contract_pdf).json()["uploaded"]
    dup = upload(client, h, contract_pdf, "copy.pdf").json()
    assert dup["uploaded"] == [] and "Duplicate" in dup["rejected"][0]["reason"]
    txt = pdf_dir / "notes.txt"
    txt.write_text("hello")
    r = client.post("/api/documents/upload", headers=h, files=[("files", ("notes.txt", b"hello", "text/plain"))])
    assert r.json()["rejected"][0]["reason"] == "Only PDF files are supported"
    fake = client.post("/api/documents/upload", headers=h, files=[("files", ("fake.pdf", b"not a pdf", "application/pdf"))])
    assert "not a valid PDF" in fake.json()["rejected"][0]["reason"]
