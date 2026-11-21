"""PDF validation, page-level text extraction, cleaning and optional OCR (PyMuPDF)."""
from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache

import pymupdf as fitz  # PyMuPDF

logger = logging.getLogger(__name__)

PDF_MAGIC = b"%PDF-"
MIN_TEXT_CHARS_PER_PAGE = 25  # below this a page is considered "image only"


class PDFProcessingError(Exception):
    """Raised for corrupted / empty / unreadable PDFs with a user-friendly message."""


@dataclass
class ExtractedPage:
    page_number: int  # 1-based
    text: str
    ocr: bool = False


@dataclass
class ExtractionResult:
    pages: list[ExtractedPage]
    page_count: int
    ocr_pages: int = 0
    warnings: list[str] = field(default_factory=list)

    @property
    def total_chars(self) -> int:
        return sum(len(p.text) for p in self.pages)


def validate_pdf_bytes(data: bytes) -> None:
    if not data:
        raise PDFProcessingError("The file is empty.")
    if not data[:1024].lstrip().startswith(PDF_MAGIC):
        raise PDFProcessingError("The file is not a valid PDF (missing PDF header).")


_HYPHEN_BREAK = re.compile(r"(\w)-\n(\w)")
_MULTI_SPACE = re.compile(r"[ \t ]+")
_MULTI_NEWLINE = re.compile(r"\n{3,}")


def clean_text(text: str) -> str:
    """Normalise unicode, re-join hyphenated line breaks and collapse whitespace
    while keeping paragraph boundaries (blank lines) intact."""
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = _HYPHEN_BREAK.sub(r"\1\2", text)
    lines = [_MULTI_SPACE.sub(" ", ln).strip() for ln in text.split("\n")]
    text = "\n".join(lines)
    text = _MULTI_NEWLINE.sub("\n\n", text)
    return text.strip()


@lru_cache(maxsize=1)
def ocr_available() -> bool:
    """True if Tesseract language data is available to PyMuPDF."""
    try:
        return bool(fitz.get_tessdata())
    except Exception:
        return False


def _ocr_page(page: fitz.Page, language: str) -> str:
    tp = page.get_textpage_ocr(language=language, dpi=200, full=True)
    return page.get_text("text", textpage=tp)


def extract_pdf(path: str, *, ocr_enabled: bool = True, ocr_language: str = "eng") -> ExtractionResult:
    """Extract text page by page. Never loads more than one page's text at a time into fitz."""
    try:
        doc = fitz.open(path)
    except Exception as exc:  # corrupted file
        raise PDFProcessingError(f"Could not open PDF: the file appears to be corrupted ({exc.__class__.__name__}).") from exc

    try:
        if doc.needs_pass:
            raise PDFProcessingError("The PDF is password protected. Please upload an unlocked copy.")
        if doc.page_count == 0:
            raise PDFProcessingError("The PDF has no pages.")

        pages: list[ExtractedPage] = []
        warnings: list[str] = []
        ocr_pages = 0
        image_only_pages = 0
        can_ocr = ocr_enabled and ocr_available()

        for i in range(doc.page_count):
            try:
                page = doc.load_page(i)
                raw = page.get_text("text", sort=True)
            except Exception as exc:
                warnings.append(f"Page {i + 1}: text extraction failed ({exc.__class__.__name__}).")
                continue
            used_ocr = False
            if len(raw.strip()) < MIN_TEXT_CHARS_PER_PAGE:
                if can_ocr:
                    try:
                        raw = _ocr_page(page, ocr_language)
                        used_ocr = True
                        ocr_pages += 1
                    except Exception as exc:
                        warnings.append(f"Page {i + 1}: OCR failed ({exc.__class__.__name__}).")
                else:
                    image_only_pages += 1
            text = clean_text(raw)
            if text:
                pages.append(ExtractedPage(page_number=i + 1, text=text, ocr=used_ocr))

        if image_only_pages:
            warnings.append(
                f"{image_only_pages} page(s) appear to be scanned images with no text layer. "
                "OCR is not available on this machine (install Tesseract or use Docker) so they were skipped."
            )
        result = ExtractionResult(pages=pages, page_count=doc.page_count, ocr_pages=ocr_pages, warnings=warnings)
        if not pages:
            reason = (
                "No extractable text was found. The PDF seems to be scanned; OCR is unavailable on this machine."
                if image_only_pages and not can_ocr
                else "No extractable text was found in this PDF."
            )
            raise PDFProcessingError(reason)
        return result
    finally:
        doc.close()


def get_page_count(path: str) -> int:
    with fitz.open(path) as doc:
        return doc.page_count


def get_page_text(path: str, page_number: int) -> str:
    with fitz.open(path) as doc:
        if page_number < 1 or page_number > doc.page_count:
            raise IndexError("Page out of range")
        return clean_text(doc.load_page(page_number - 1).get_text("text", sort=True))


def render_page_png(path: str, page_number: int, zoom: float = 1.5) -> bytes:
    with fitz.open(path) as doc:
        if page_number < 1 or page_number > doc.page_count:
            raise IndexError("Page out of range")
        page = doc.load_page(page_number - 1)
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        return pix.tobytes("png")
