from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import rate_limit
from app.models import Analysis, Conversation, Document, Message, QueryLog, User

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/stats")
def stats(db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    uid = user.id
    docs_by_status = dict(
        db.execute(
            select(Document.processing_status, func.count()).where(Document.user_id == uid)
            .group_by(Document.processing_status)
        ).all()
    )
    totals = db.execute(
        select(func.count(Document.id), func.coalesce(func.sum(Document.page_count), 0),
               func.coalesce(func.sum(Document.chunk_count), 0), func.coalesce(func.sum(Document.file_size), 0))
        .where(Document.user_id == uid)
    ).one()
    q = db.execute(
        select(func.count(QueryLog.id), func.avg(QueryLog.retrieval_ms), func.avg(QueryLog.total_ms))
        .where(QueryLog.user_id == uid)
    ).one()
    chat_q = db.scalar(select(func.count(QueryLog.id)).where(QueryLog.user_id == uid, QueryLog.kind == "chat"))
    conversations = db.scalar(select(func.count(Conversation.id)).where(Conversation.user_id == uid))
    analyses = dict(
        db.execute(select(Analysis.analysis_type, func.count()).where(Analysis.user_id == uid)
                   .group_by(Analysis.analysis_type)).all()
    )
    avg_proc = db.scalar(select(func.avg(Document.processing_ms)).where(Document.user_id == uid,
                                                                       Document.processing_status == "ready"))
    return {
        "total_documents": totals[0],
        "total_pages": int(totals[1]),
        "total_chunks": int(totals[2]),
        "storage_bytes": int(totals[3]),
        "documents_by_status": {k: docs_by_status.get(k, 0) for k in ("ready", "processing", "pending", "failed")},
        "total_queries": q[0],
        "chat_queries": chat_q,
        "search_queries": q[0] - chat_q,
        "avg_retrieval_ms": round(q[1], 1) if q[1] is not None else None,
        "avg_response_ms": round(q[2], 1) if q[2] is not None else None,
        "total_conversations": conversations,
        "analyses": analyses,
        "avg_processing_ms": round(avg_proc) if avg_proc is not None else None,
    }


def _day(v) -> date:
    if isinstance(v, datetime):
        return v.date()
    return v


@router.get("/activity")
def activity(days: int = 14, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    days = min(max(days, 7), 90)
    uid = user.id
    since = datetime.now(timezone.utc) - timedelta(days=days - 1)
    since = since.replace(hour=0, minute=0, second=0, microsecond=0)
    series = {}
    for i in range(days):
        d = (since + timedelta(days=i)).date()
        series[d] = {"date": d.isoformat(), "uploads": 0, "chat": 0, "search": 0, "avg_retrieval_ms": None}

    for (created,) in db.execute(select(Document.created_at).where(Document.user_id == uid, Document.created_at >= since)):
        d = _day(created)
        if d in series:
            series[d]["uploads"] += 1
    lat: dict[date, list[float]] = {}
    for created, kind, rms in db.execute(
        select(QueryLog.created_at, QueryLog.kind, QueryLog.retrieval_ms)
        .where(QueryLog.user_id == uid, QueryLog.created_at >= since)
    ):
        d = _day(created)
        if d in series:
            series[d][kind] = series[d].get(kind, 0) + 1
            lat.setdefault(d, []).append(rms)
    for d, vals in lat.items():
        series[d]["avg_retrieval_ms"] = round(sum(vals) / len(vals), 1)

    recent_docs = db.scalars(select(Document).where(Document.user_id == uid).order_by(Document.created_at.desc()).limit(5)).all()
    recent_queries = db.scalars(select(QueryLog).where(QueryLog.user_id == uid).order_by(QueryLog.created_at.desc()).limit(8)).all()
    recent_analyses = db.execute(
        select(Analysis.id, Analysis.analysis_type, Analysis.created_at, Document.filename)
        .join(Document, Document.id == Analysis.document_id)
        .where(Analysis.user_id == uid).order_by(Analysis.created_at.desc()).limit(5)
    ).all()
    latest_msgs = db.execute(
        select(Conversation.id, Conversation.title, func.max(Message.created_at))
        .join(Message, Message.conversation_id == Conversation.id)
        .where(Conversation.user_id == uid).group_by(Conversation.id, Conversation.title)
        .order_by(func.max(Message.created_at).desc()).limit(5)
    ).all()

    activity_feed = (
        [{"type": q.kind, "label": q.query, "created_at": q.created_at, "meta": {"latency_ms": round(q.total_ms)}}
         for q in recent_queries]
        + [{"type": "analysis", "label": f"{t.replace('_', ' ').title()} · {fn}", "created_at": c, "meta": {"id": i}}
           for i, t, c, fn in recent_analyses]
    )
    activity_feed.sort(key=lambda x: x["created_at"], reverse=True)

    return {
        "series": list(series.values()),
        "recent_documents": [
            {"id": d.id, "filename": d.filename, "status": d.processing_status, "page_count": d.page_count,
             "created_at": d.created_at} for d in recent_docs
        ],
        "recent_activity": activity_feed[:10],
        "recent_conversations": [{"id": i, "title": t, "last_message_at": c} for i, t, c in latest_msgs],
    }
