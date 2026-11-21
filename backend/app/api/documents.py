import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import get_owned_document, rate_limit
from app.models import Document, DocumentChunk, User
from app.schemas import DocumentOut, PageText, UploadResult
from app.services import ingestion
from app.services.pdf_processor import PDFProcessingError, get_page_count, get_page_text, render_page_png, validate_pdf_bytes

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("/upload", response_model=UploadResult, status_code=status.HTTP_201_CREATED)
async def upload_documents(
    files: list[UploadFile] = File(..., description="One or more PDF files"),
    db: Session = Depends(get_db),
    user: User = Depends(rate_limit),
) -> UploadResult:
    s = get_settings()
    if len(files) > s.max_files_per_upload:
        raise HTTPException(status_code=400, detail=f"You can upload at most {s.max_files_per_upload} files at once")
    uploaded: list[Document] = []
    rejected: list[dict[str, str]] = []
    for f in files:
        name = ingestion.sanitize_filename(f.filename or "document.pdf")
        data = await f.read(s.max_upload_bytes + 1)
        await f.close()
        if len(data) > s.max_upload_bytes:
            rejected.append({"filename": name, "reason": f"File exceeds the {s.max_upload_mb} MB limit"})
            continue
        if not (f.filename or "").lower().endswith(".pdf"):
            rejected.append({"filename": name, "reason": "Only PDF files are supported"})
            continue
        try:
            validate_pdf_bytes(data)
        except PDFProcessingError as exc:
            rejected.append({"filename": name, "reason": str(exc)})
            continue
        digest = ingestion.sha256(data)
        dup = db.scalar(select(Document).where(Document.user_id == user.id, Document.file_hash == digest))
        if dup:
            rejected.append({"filename": name, "reason": f"Duplicate of an existing document ({dup.filename})"})
            continue
        doc_id = str(uuid.uuid4())
        path = ingestion.storage_path_for(user.id, doc_id)
        path.write_bytes(data)
        try:
            page_count = get_page_count(str(path))
        except Exception:
            path.unlink(missing_ok=True)
            rejected.append({"filename": name, "reason": "Could not open PDF: the file appears to be corrupted"})
            continue
        doc = Document(
            id=doc_id, user_id=user.id, filename=name, storage_path=str(path), file_hash=digest,
            file_size=len(data), page_count=page_count, processing_status="pending",
            status_message="Queued for processing",
        )
        db.add(doc)
        db.commit()
        uploaded.append(doc)
    for doc in uploaded:
        ingestion.submit(doc.id)
    for doc in uploaded:
        db.refresh(doc)
    return UploadResult(uploaded=[DocumentOut.model_validate(d) for d in uploaded], rejected=rejected)


@router.get("", response_model=list[DocumentOut])
def list_documents(db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    return db.scalars(select(Document).where(Document.user_id == user.id).order_by(Document.created_at.desc())).all()


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    return get_owned_document(document_id, db, user)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(rate_limit)) -> Response:
    doc = get_owned_document(document_id, db, user)
    path = doc.storage_path
    db.delete(doc)
    db.commit()
    ingestion.delete_document_data(user.id, document_id)
    try:
        ingestion.resolve_storage_path(path).unlink(missing_ok=True)
    except Exception:
        pass
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{document_id}/reindex", response_model=DocumentOut, status_code=status.HTTP_202_ACCEPTED)
def reindex_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    doc = get_owned_document(document_id, db, user)
    if doc.processing_status in ("pending", "processing"):
        raise HTTPException(status_code=409, detail="Document is already being processed")
    db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == doc.id))
    doc.processing_status = "pending"
    doc.status_message = "Queued for re-indexing"
    doc.chunk_count = 0
    db.commit()
    ingestion.delete_document_data(user.id, doc.id)
    ingestion.submit(doc.id)
    db.refresh(doc)
    return doc


@router.get("/{document_id}/file")
def download_file(document_id: str, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    doc = get_owned_document(document_id, db, user)
    path = ingestion.resolve_storage_path(doc.storage_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing from storage")
    return FileResponse(path, media_type="application/pdf", filename=doc.filename, content_disposition_type="inline")


@router.get("/{document_id}/pages/{page_number}", response_model=PageText)
def page_text(document_id: str, page_number: int, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    doc = get_owned_document(document_id, db, user)
    try:
        text = get_page_text(str(ingestion.resolve_storage_path(doc.storage_path)), page_number)
    except IndexError:
        raise HTTPException(status_code=404, detail="Page not found")
    return PageText(document_id=doc.id, page_number=page_number, page_count=doc.page_count, text=text)


@router.get("/{document_id}/pages/{page_number}/image")
def page_image(document_id: str, page_number: int, zoom: float = 1.5,
               db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    doc = get_owned_document(document_id, db, user)
    zoom = min(max(zoom, 0.5), 3.0)
    try:
        png = render_page_png(str(ingestion.resolve_storage_path(doc.storage_path)), page_number, zoom)
    except IndexError:
        raise HTTPException(status_code=404, detail="Page not found")
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})
