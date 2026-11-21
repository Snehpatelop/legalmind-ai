import json

from tests.conftest import upload


def test_document_lifecycle_and_permissions(client, user, other_user, ready_doc):
    h, oh = user["headers"], other_user["headers"]
    doc_id = ready_doc["id"]
    assert ready_doc["page_count"] == 3 and ready_doc["chunk_count"] > 0

    assert [d["id"] for d in client.get("/api/documents", headers=h).json()] == [doc_id]
    assert client.get("/api/documents", headers=oh).json() == []

    # Another user can't read, preview, re-index or delete it (404 — no existence leak)
    for method, path in [
        ("get", f"/api/documents/{doc_id}"),
        ("get", f"/api/documents/{doc_id}/file"),
        ("get", f"/api/documents/{doc_id}/pages/1"),
        ("get", f"/api/documents/{doc_id}/pages/1/image"),
        ("post", f"/api/documents/{doc_id}/reindex"),
        ("delete", f"/api/documents/{doc_id}"),
    ]:
        assert getattr(client, method)(path, headers=oh).status_code == 404, path

    page = client.get(f"/api/documents/{doc_id}/pages/2", headers=h).json()
    assert "FEES AND PAYMENT" in page["text"]
    img = client.get(f"/api/documents/{doc_id}/pages/1/image", headers=h)
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    assert client.get(f"/api/documents/{doc_id}/file", headers=h).content[:5] == b"%PDF-"

    re = client.post(f"/api/documents/{doc_id}/reindex", headers=h)
    assert re.status_code == 202
    assert client.get(f"/api/documents/{doc_id}", headers=h).json()["processing_status"] == "ready"

    assert client.delete(f"/api/documents/{doc_id}", headers=h).status_code == 204
    assert client.get(f"/api/documents/{doc_id}", headers=h).status_code == 404
    r = client.post("/api/search", headers=h, json={"query": "liability", "mode": "hybrid"})
    assert r.json()["results"] == []


def test_multiple_upload_and_failed_processing(client, user, contract_pdf, pdf_dir):
    from tests.conftest import make_pdf

    blank = make_pdf(pdf_dir / "scan.pdf", ["", ""])
    with open(contract_pdf, "rb") as a, open(blank, "rb") as b:
        r = client.post(
            "/api/documents/upload",
            headers=user["headers"],
            files=[("files", ("a.pdf", a.read(), "application/pdf")), ("files", ("scan.pdf", b.read(), "application/pdf"))],
        )
    assert r.status_code == 201
    docs = {d["filename"]: d for d in client.get("/api/documents", headers=user["headers"]).json()}
    assert docs["a.pdf"]["processing_status"] == "ready"
    assert docs["scan.pdf"]["processing_status"] == "failed"
    assert "No extractable text" in docs["scan.pdf"]["status_message"]


def test_chat_grounded_answer_with_validated_citations(client, user, ready_doc, fake_llm):
    h = user["headers"]
    r = client.post("/api/chat/query", headers=h, json={"question": "What are the termination conditions?"})
    assert r.status_code == 200, r.text
    body = r.json()
    msg = body["message"]
    assert "[S99]" not in msg["content"] and "[S1]" in msg["content"]
    assert msg["meta"]["invalid_citations_removed"] == ["S99"]
    assert body["citations"] and all(c["document_name"] == "msa.pdf" for c in body["citations"])
    assert all(1 <= c["page_number"] <= 3 for c in body["citations"])
    conv_id = body["conversation_id"]

    # follow-up uses query rewriting with conversation context
    r2 = client.post("/api/chat/query", headers=h, json={"question": "What about the notice for it?", "conversation_id": conv_id})
    assert r2.status_code == 200
    assert r2.json()["rewritten_query"] == "What is the notice period for termination of the agreement?"

    conv = client.get(f"/api/chat/conversations/{conv_id}", headers=h).json()
    assert [m["role"] for m in conv["messages"]] == ["user", "assistant", "user", "assistant"]

    # regenerate replaces only the last assistant message
    r3 = client.post("/api/chat/query", headers=h, json={"question": "x", "conversation_id": conv_id, "regenerate": True})
    assert r3.status_code == 200
    conv = client.get(f"/api/chat/conversations/{conv_id}", headers=h).json()
    assert len(conv["messages"]) == 4

    convs = client.get("/api/chat/conversations", headers=h).json()
    assert convs[0]["id"] == conv_id and convs[0]["message_count"] == 4


def test_chat_isolation(client, user, other_user, ready_doc, fake_llm):
    r = client.post("/api/chat/query", headers=user["headers"], json={"question": "termination?"})
    conv_id = r.json()["conversation_id"]
    oh = other_user["headers"]
    assert client.get(f"/api/chat/conversations/{conv_id}", headers=oh).status_code == 404
    assert client.delete(f"/api/chat/conversations/{conv_id}", headers=oh).status_code == 404
    assert client.post("/api/chat/query", headers=oh, json={"question": "hi", "conversation_id": conv_id}).status_code == 404
    assert client.get("/api/chat/conversations", headers=oh).json() == []
    assert client.delete(f"/api/chat/conversations/{conv_id}", headers=user["headers"]).status_code == 204


def test_chat_streaming_sse(client, user, ready_doc, fake_llm):
    with client.stream("POST", "/api/chat/query", headers=user["headers"],
                       json={"question": "What is the notice period?", "stream": True}) as r:
        assert r.status_code == 200
        events = [json.loads(line[5:]) for line in r.iter_lines() if line.startswith("data:")]
    types = [e["type"] for e in events]
    assert types[0] == "meta" and types[-1] == "final" and "token" in types
    assert events[0]["sources"]
    final = events[-1]["message"]
    assert final["content"] == "The notice period is ninety days [S1]."
    assert final["citations"][0]["source_id"] == 1


def test_chat_without_gemini_returns_evidence_not_fake_answer(client, user, ready_doc):
    r = client.post("/api/chat/query", headers=user["headers"], json={"question": "What is the liability cap?"})
    assert r.status_code == 200
    msg = r.json()["message"]
    assert "AI answer unavailable" in msg["content"] and "GEMINI_API_KEY" in msg["content"]
    assert msg["meta"]["llm_error"] and msg["citations"]  # real retrieved evidence


def test_chat_with_no_documents_says_insufficient(client, user, fake_llm):
    r = client.post("/api/chat/query", headers=user["headers"], json={"question": "What is the liability cap?"})
    assert "do not contain enough information" in r.json()["message"]["content"]
    assert fake_llm.calls == []  # LLM never called without context


def test_dashboard_uses_real_data(client, user, ready_doc, fake_llm):
    h = user["headers"]
    s0 = client.get("/api/dashboard/stats", headers=h).json()
    assert s0["total_documents"] == 1 and s0["total_queries"] == 0 and s0["avg_retrieval_ms"] is None
    client.post("/api/chat/query", headers=h, json={"question": "termination?"})
    s1 = client.get("/api/dashboard/stats", headers=h).json()
    assert s1["total_queries"] == 1 and s1["total_conversations"] == 1 and s1["avg_retrieval_ms"] > 0
    act = client.get("/api/dashboard/activity", headers=h).json()
    assert sum(d["uploads"] for d in act["series"]) == 1
    assert sum(d["chat"] for d in act["series"]) == 1
    assert act["recent_documents"][0]["id"] == ready_doc["id"]


def test_rate_limit(client, user, monkeypatch):
    from app.config import get_settings
    from app.deps import general_limiter

    monkeypatch.setattr(get_settings(), "rate_limit_per_minute", 3)
    general_limiter.reset()
    codes = [client.get("/api/documents", headers=user["headers"]).status_code for _ in range(5)]
    assert codes[:3] == [200, 200, 200] and codes[3] == 429
    general_limiter.reset()


def test_storage_is_outside_user_control(client, user, contract_pdf):
    r = upload(client, user["headers"], contract_pdf, name="../../../etc/evil.pdf")
    doc = r.json()["uploaded"][0]
    assert doc["filename"] == "evil.pdf"
