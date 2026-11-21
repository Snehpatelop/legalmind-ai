from tests.conftest import CONTRACT_PAGES, make_pdf, upload


def test_contract_risk_requires_gemini(client, user, ready_doc):
    r = client.post(f"/api/analysis/contract-risk/{ready_doc['id']}", headers=user["headers"])
    assert r.status_code == 503 and "GEMINI_API_KEY" in r.json()["detail"]


def test_contract_risk_findings_are_evidence_backed(client, user, other_user, ready_doc, fake_llm):
    r = client.post(f"/api/analysis/contract-risk/{ready_doc['id']}", headers=user["headers"])
    assert r.status_code == 201, r.text
    res = r.json()["result"]
    # The finding citing a non-existent source S999 must be dropped
    assert len(res["findings"]) == 1 and res["unsupported_findings_removed"] == 1
    f = res["findings"][0]
    assert f["risk_level"] == "HIGH" and f["citations"] and f["page_number"] == f["citations"][0]["page_number"]
    assert f["document_name"] == "msa.pdf"
    # extracted_text either verified verbatim, or replaced with the real passage
    assert f["extracted_text"].lower() in " ".join(CONTRACT_PAGES).lower() or f["quote_verified"] is False
    assert res["counts"] == {"HIGH": 1, "MEDIUM": 0, "LOW": 0}

    aid = r.json()["id"]
    pdf = client.get(f"/api/analysis/{aid}/export.pdf", headers=user["headers"])
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"
    assert client.get(f"/api/analysis/{aid}", headers=other_user["headers"]).status_code == 404
    assert client.post(f"/api/analysis/contract-risk/{ready_doc['id']}", headers=other_user["headers"]).status_code == 404


def test_summary_and_pdf_export(client, user, ready_doc, fake_llm):
    r = client.post(f"/api/analysis/summarize/{ready_doc['id']}", headers=user["headers"], json={"length": "short"})
    assert r.status_code == 201, r.text
    res = r.json()["result"]
    assert res["length"] == "short" and res["coverage"] == "full"
    assert res["parties"][0]["name"] == "Northwind Analytics Ltd" and res["parties"][0]["citations"]
    assert len(res["key_obligations"]) == 1 and res["unsupported_items_removed"] == 1
    pdf = client.get(f"/api/analysis/{r.json()['id']}/export.pdf", headers=user["headers"])
    assert pdf.content[:5] == b"%PDF-"
    listed = client.get(f"/api/analysis?document_id={ready_doc['id']}&analysis_type=summary", headers=user["headers"]).json()
    assert listed[0]["id"] == r.json()["id"]


def test_compare_documents_with_side_specific_citations(client, user, ready_doc, fake_llm, pdf_dir):
    v2 = make_pdf(pdf_dir / "msa_v2.pdf", [p.replace("thirty (30)", "forty-five (45)") for p in CONTRACT_PAGES])
    b = upload(client, user["headers"], v2).json()["uploaded"][0]
    r = client.post("/api/analysis/compare", headers=user["headers"],
                    json={"document_a_id": ready_doc["id"], "document_b_id": b["id"]})
    assert r.status_code == 201, r.text
    aspect = r.json()["result"]["aspects"][0]
    assert aspect["status"] == "different"
    assert all(c["document_name"] == "msa.pdf" for c in aspect["document_a"]["citations"])
    # B summary listed an A source id too; cross-document citation must be filtered out
    assert aspect["document_b"]["citations"] and all(c["document_name"] == "msa_v2.pdf" for c in aspect["document_b"]["citations"])
    same = client.post("/api/analysis/compare", headers=user["headers"],
                       json={"document_a_id": ready_doc["id"], "document_b_id": ready_doc["id"]})
    assert same.status_code == 400


def test_evaluation_fails_with_real_reason_without_gemini(client, user, ready_doc):
    h = user["headers"]
    ds = client.post("/api/evaluation/datasets/sample", headers=h).json()
    assert ds["is_sample"] and len(ds["questions"]) == 6
    r = client.post("/api/evaluation/run", headers=h, json={"dataset_id": ds["id"]})
    assert r.status_code == 202
    ev = client.get(f"/api/evaluation/results/{r.json()['id']}", headers=h).json()
    assert ev["status"] == "failed" and "GEMINI_API_KEY" in ev["error"]
    assert ev["metric_results"] is None  # no fabricated scores


def test_evaluation_run_with_mocked_ragas(client, user, other_user, ready_doc, fake_llm, monkeypatch):
    from app.services import evaluation as svc

    def fake_scorer(rows):
        assert rows and all(r["contexts"] for r in rows)
        return [{"faithfulness": 0.9, "answer_relevancy": 0.8, "context_precision": 0.4, "context_recall": None} for _ in rows], "test"

    monkeypatch.setattr(svc, "score_with_ragas", fake_scorer)
    h = user["headers"]
    ds = client.post("/api/evaluation/datasets", headers=h, json={
        "name": "My set", "questions": [{"question": "What is the notice period for termination?", "ground_truth": "Ninety days."}]
    }).json()
    q = client.post(f"/api/evaluation/datasets/{ds['id']}/questions", headers=h,
                    json={"question": "What is the liability cap?", "ground_truth": "Fees paid in prior 12 months."})
    assert q.status_code == 201
    ev = client.post("/api/evaluation/run", headers=h, json={"dataset_id": ds["id"]}).json()
    ev = client.get(f"/api/evaluation/results/{ev['id']}", headers=h).json()
    assert ev["status"] == "completed" and not ev["is_sample"]
    mr = ev["metric_results"]
    assert mr["aggregate"] == {"faithfulness": 0.9, "answer_relevancy": 0.8, "context_precision": 0.4, "context_recall": None}
    assert len(mr["rows"]) == 2 and mr["rows"][0]["failed"]  # precision < 0.5 and recall missing
    assert mr["rows"][0]["contexts"][0]["page_number"] >= 1
    assert client.get("/api/evaluation/results", headers=other_user["headers"]).json() == []
    assert client.post("/api/evaluation/run", headers=other_user["headers"], json={"dataset_id": ds["id"]}).status_code == 404
