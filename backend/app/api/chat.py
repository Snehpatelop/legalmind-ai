import json
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.deps import ai_rate_limit, rate_limit
from app.models import Conversation, Document, Message, QueryLog, User
from app.schemas import ChatQuery, ChatResponse, ConversationDetail, ConversationOut, MessageOut
from app.services.citations import validate_citations
from app.services.llm import LLMUnavailableError, get_llm
from app.services.rag_pipeline import (
    AnswerResult,
    PreparedQuery,
    answer,
    llm_unavailable_answer,
    no_context_answer,
    prepare_query,
    stream_answer,
)

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _owned_doc_ids(db: Session, user: User, ids: list[str] | None) -> list[str] | None:
    if not ids:
        return None
    ids = list(dict.fromkeys(ids))
    found = set(db.scalars(select(Document.id).where(Document.user_id == user.id, Document.id.in_(ids))))
    if len(found) != len(ids):
        raise HTTPException(status_code=404, detail="One or more selected documents were not found")
    return ids


def _get_conversation(db: Session, user: User, conversation_id: str) -> Conversation:
    conv = db.scalar(select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user.id))
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


def _start_turn(db: Session, user: User, body: ChatQuery) -> tuple[Conversation, str, list[tuple[str, str]], list[str] | None]:
    doc_ids = _owned_doc_ids(db, user, body.document_ids)
    if body.conversation_id:
        conv = _get_conversation(db, user, body.conversation_id)
    else:
        if body.regenerate:
            raise HTTPException(status_code=400, detail="Nothing to regenerate")
        conv = Conversation(user_id=user.id, title=body.question.strip()[:80] or "New conversation", document_ids=doc_ids)
        db.add(conv)
        db.flush()
    if doc_ids is not None:
        conv.document_ids = doc_ids
    msgs = list(conv.messages)
    if body.regenerate:
        last_user_idx = max((i for i, m in enumerate(msgs) if m.role == "user"), default=None)
        if last_user_idx is None:
            raise HTTPException(status_code=400, detail="Nothing to regenerate")
        for m in msgs[last_user_idx + 1 :]:
            db.delete(m)
        question = msgs[last_user_idx].content
        history_msgs = msgs[:last_user_idx]
    else:
        question = body.question.strip()
        history_msgs = msgs
        db.add(Message(conversation_id=conv.id, role="user", content=question))
    conv.updated_at = datetime.now(timezone.utc)
    db.commit()
    history = [(m.role, m.content) for m in history_msgs][-8:]
    return conv, question, history, doc_ids if doc_ids is not None else conv.document_ids


def _persist(db: Session, user_id: str, conv_id: str, prep: PreparedQuery, result: AnswerResult) -> Message:
    total_ms = (time.perf_counter() - prep.started) * 1000
    msg = Message(
        conversation_id=conv_id,
        role="assistant",
        content=result.content,
        citations=result.citations,
        meta={
            "rewritten_query": prep.rewritten,
            "rewrite_method": prep.rewrite_method,
            "retrieval_ms": round(prep.retrieval.retrieval_ms, 1),
            "total_ms": round(total_ms, 1),
            "candidates": prep.retrieval.candidates,
            "sources_considered": len(prep.sources),
            "reranked": prep.retrieval.reranked,
            "invalid_citations_removed": result.invalid_citations,
            "llm_error": result.llm_error,
            "grounded": result.grounded,
        },
    )
    db.add(msg)
    db.add(QueryLog(
        user_id=user_id, kind="chat", query=prep.question, mode="hybrid",
        result_count=len(prep.sources), retrieval_ms=prep.retrieval.retrieval_ms, total_ms=total_ms,
    ))
    conv = db.get(Conversation, conv_id)
    if conv:
        conv.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(msg)
    return msg


@router.post("/query", response_model=ChatResponse)
def chat_query(body: ChatQuery, db: Session = Depends(get_db), user: User = Depends(ai_rate_limit)):
    conv, question, history, doc_ids = _start_turn(db, user, body)
    prep = prepare_query(db, user.id, question, history, doc_ids)

    if not body.stream:
        result = answer(prep) if prep.sources else no_context_answer(doc_ids)
        msg = _persist(db, user.id, conv.id, prep, result)
        return ChatResponse(
            conversation_id=conv.id,
            message=MessageOut.model_validate(msg),
            rewritten_query=prep.rewritten,
            citations=result.citations,
            retrieval_ms=prep.retrieval.retrieval_ms,
            total_ms=msg.meta["total_ms"],
        )

    user_id, conv_id = user.id, conv.id

    def sse(payload: dict) -> str:
        return f"data: {json.dumps(payload, default=str)}\n\n"

    def event_stream():
        yield sse({
            "type": "meta",
            "conversation_id": conv_id,
            "title": conv.title,
            "rewritten_query": prep.rewritten,
            "retrieval_ms": round(prep.retrieval.retrieval_ms, 1),
            "sources": [s.as_citation() for s in prep.sources],
        })
        if not prep.sources:
            result = no_context_answer(doc_ids)
            yield sse({"type": "token", "text": result.content})
        else:
            parts: list[str] = []
            try:
                get_llm()
                for delta in stream_answer(prep):
                    parts.append(delta)
                    yield sse({"type": "token", "text": delta})
                cleaned, cites, invalid = validate_citations("".join(parts), prep.sources)
                result = AnswerResult(cleaned, cites, invalid)
            except LLMUnavailableError as exc:
                if parts:  # partial stream: keep what we have, flag the error
                    cleaned, cites, invalid = validate_citations("".join(parts), prep.sources)
                    result = AnswerResult(cleaned + f"\n\n_(Response interrupted: {exc})_", cites, invalid, llm_error=str(exc))
                else:
                    result = llm_unavailable_answer(prep, str(exc))
        with SessionLocal() as s2:
            msg = _persist(s2, user_id, conv_id, prep, result)
            yield sse({"type": "final", "conversation_id": conv_id,
                       "message": MessageOut.model_validate(msg).model_dump(mode="json")})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    rows = db.execute(
        select(Conversation, func.count(Message.id))
        .outerjoin(Message, Message.conversation_id == Conversation.id)
        .where(Conversation.user_id == user.id)
        .group_by(Conversation.id)
        .order_by(Conversation.updated_at.desc())
    ).all()
    return [
        ConversationOut(id=c.id, title=c.title, created_at=c.created_at, updated_at=c.updated_at, message_count=n)
        for c, n in rows
    ]


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
def get_conversation(conversation_id: str, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    conv = _get_conversation(db, user, conversation_id)
    return ConversationDetail(
        id=conv.id, title=conv.title, created_at=conv.created_at, updated_at=conv.updated_at,
        message_count=len(conv.messages), document_ids=conv.document_ids,
        messages=[MessageOut.model_validate(m) for m in conv.messages],
    )


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(conversation_id: str, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    conv = _get_conversation(db, user, conversation_id)
    db.delete(conv)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
