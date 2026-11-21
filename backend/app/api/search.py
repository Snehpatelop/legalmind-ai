import time

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import rate_limit
from app.models import Document, QueryLog, User
from app.schemas import SearchHistoryItem, SearchRequest, SearchResponse
from app.services.hybrid import retrieve
from app.services.query_processing import normalize_query

router = APIRouter(prefix="/api/search", tags=["search"])


@router.post("", response_model=SearchResponse)
def search(body: SearchRequest, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    t0 = time.perf_counter()
    doc_ids = None
    if body.document_ids:
        doc_ids = list(dict.fromkeys(body.document_ids))
        found = set(db.scalars(select(Document.id).where(Document.user_id == user.id, Document.id.in_(doc_ids))))
        if len(found) != len(doc_ids):
            raise HTTPException(status_code=404, detail="One or more selected documents were not found")
    query = normalize_query(body.query)
    res = retrieve(
        db, user.id, query, mode=body.mode, document_ids=doc_ids,
        top_k=max(body.top_k * 2, 20), use_rerank=body.rerank, rerank_top_n=body.top_k,
    )
    total = (time.perf_counter() - t0) * 1000
    db.add(QueryLog(user_id=user.id, kind="search", query=query, mode=body.mode,
                    result_count=len(res.chunks), retrieval_ms=res.retrieval_ms, total_ms=total))
    db.commit()
    return SearchResponse(
        query=query, mode=body.mode, results=[c.to_hit() for c in res.chunks],
        latency_ms=round(total, 1), reranked=res.reranked,
    )


@router.get("/history", response_model=list[SearchHistoryItem])
def history(limit: int = 30, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    return db.scalars(
        select(QueryLog).where(QueryLog.user_id == user.id, QueryLog.kind == "search")
        .order_by(QueryLog.created_at.desc()).limit(min(max(limit, 1), 100))
    ).all()


@router.delete("/history", status_code=status.HTTP_204_NO_CONTENT)
def clear_history(db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    db.execute(delete(QueryLog).where(QueryLog.user_id == user.id, QueryLog.kind == "search"))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
