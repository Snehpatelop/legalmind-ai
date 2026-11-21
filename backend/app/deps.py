"""FastAPI dependencies: current user, ownership checks and rate limiting."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Document, User
from app.security import decode_access_token

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if creds is None or creds.scheme.lower() != "bearer":
        raise unauthorized
    user_id = decode_access_token(creds.credentials)
    if not user_id:
        raise unauthorized
    user = db.get(User, user_id)
    if user is None:
        raise unauthorized
    return user


def get_owned_document(document_id: str, db: Session, user: User) -> Document:
    """Return the document only if it belongs to the user. 404 otherwise (no existence leak)."""
    doc = db.scalar(select(Document).where(Document.id == document_id, Document.user_id == user.id))
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


class RateLimiter:
    """Simple in-memory sliding-window limiter (per user or per IP)."""

    def __init__(self, limit_attr: str, scope: str):
        self.limit_attr = limit_attr
        self.scope = scope
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        limit = getattr(get_settings(), self.limit_attr)
        if limit <= 0:
            return
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= limit:
                retry = max(1, int(60 - (now - q[0])))
                raise HTTPException(
                    status_code=429,
                    detail=f"Rate limit exceeded. Try again in {retry}s.",
                    headers={"Retry-After": str(retry)},
                )
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


general_limiter = RateLimiter("rate_limit_per_minute", "general")
ai_limiter = RateLimiter("ai_rate_limit_per_minute", "ai")
auth_limiter = RateLimiter("ai_rate_limit_per_minute", "auth")


def rate_limit(request: Request, user: User = Depends(get_current_user)) -> User:
    general_limiter.check(user.id)
    return user


def ai_rate_limit(request: Request, user: User = Depends(get_current_user)) -> User:
    general_limiter.check(user.id)
    ai_limiter.check(user.id)
    return user


def auth_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    auth_limiter.check(ip)
