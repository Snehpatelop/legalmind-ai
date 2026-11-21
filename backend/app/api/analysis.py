from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import ai_rate_limit, get_owned_document, rate_limit
from app.models import Analysis, Document, User
from app.schemas import AnalysisOut, CompareRequest, SummarizeRequest
from app.services import analysis as svc
from app.services.llm import LLMUnavailableError, get_llm
from app.services.pdf_export import risk_pdf, summary_pdf

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


def _ready(doc: Document) -> Document:
    if doc.processing_status != "ready":
        raise HTTPException(status_code=409, detail=f"'{doc.filename}' is not ready yet (status: {doc.processing_status})")
    return doc


def _run(fn, *args):
    try:
        get_llm()  # fail fast (before retrieval work) when Gemini is not configured
        return fn(*args)
    except LLMUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _save(db: Session, user: User, doc_id: str, kind: str, result: dict) -> Analysis:
    a = Analysis(user_id=user.id, document_id=doc_id, analysis_type=kind, result=result)
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


@router.post("/summarize/{document_id}", response_model=AnalysisOut, status_code=status.HTTP_201_CREATED)
def summarize(document_id: str, body: SummarizeRequest | None = None,
              db: Session = Depends(get_db), user: User = Depends(ai_rate_limit)):
    doc = _ready(get_owned_document(document_id, db, user))
    result = _run(svc.summarize, db, user.id, doc, (body or SummarizeRequest()).length)
    return _save(db, user, doc.id, "summary", result)


@router.post("/contract-risk/{document_id}", response_model=AnalysisOut, status_code=status.HTTP_201_CREATED)
def contract_risk(document_id: str, db: Session = Depends(get_db), user: User = Depends(ai_rate_limit)):
    doc = _ready(get_owned_document(document_id, db, user))
    result = _run(svc.contract_risk, db, user.id, doc)
    return _save(db, user, doc.id, "contract_risk", result)


@router.post("/compare", response_model=AnalysisOut, status_code=status.HTTP_201_CREATED)
def compare(body: CompareRequest, db: Session = Depends(get_db), user: User = Depends(ai_rate_limit)):
    if body.document_a_id == body.document_b_id:
        raise HTTPException(status_code=400, detail="Select two different documents")
    a = _ready(get_owned_document(body.document_a_id, db, user))
    b = _ready(get_owned_document(body.document_b_id, db, user))
    result = _run(svc.compare_documents, db, user.id, a, b)
    return _save(db, user, a.id, "comparison", result)


@router.get("", response_model=list[AnalysisOut])
def list_analyses(document_id: str | None = None, analysis_type: str | None = None, limit: int = 50,
                  db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    q = select(Analysis).where(Analysis.user_id == user.id)
    if document_id:
        q = q.where(Analysis.document_id == document_id)
    if analysis_type:
        q = q.where(Analysis.analysis_type == analysis_type)
    return db.scalars(q.order_by(Analysis.created_at.desc()).limit(min(max(limit, 1), 200))).all()


def _owned_analysis(db: Session, user: User, analysis_id: str) -> Analysis:
    a = db.scalar(select(Analysis).where(Analysis.id == analysis_id, Analysis.user_id == user.id))
    if a is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return a


@router.get("/{analysis_id}", response_model=AnalysisOut)
def get_analysis(analysis_id: str, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    return _owned_analysis(db, user, analysis_id)


@router.delete("/{analysis_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_analysis(analysis_id: str, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    db.delete(_owned_analysis(db, user, analysis_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{analysis_id}/export.pdf")
def export_pdf(analysis_id: str, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    a = _owned_analysis(db, user, analysis_id)
    if a.analysis_type == "summary":
        pdf = summary_pdf(a.result, a.created_at)
    elif a.analysis_type == "contract_risk":
        pdf = risk_pdf(a.result, a.created_at)
    else:
        raise HTTPException(status_code=400, detail="PDF export is available for summaries and risk analyses")
    name = f"legalmind-{a.analysis_type}-{a.id[:8]}.pdf"
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"'})
