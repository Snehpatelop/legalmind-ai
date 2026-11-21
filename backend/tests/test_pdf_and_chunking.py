import pytest

from app.services.chunker import chunk_pages
from app.services.pdf_processor import ExtractedPage, PDFProcessingError, clean_text, extract_pdf, validate_pdf_bytes
from tests.conftest import CONTRACT_PAGES, make_pdf


def test_extract_preserves_page_numbers(contract_pdf):
    res = extract_pdf(str(contract_pdf), ocr_enabled=False)
    assert res.page_count == 3
    assert [p.page_number for p in res.pages] == [1, 2, 3]
    assert "MASTER SERVICES AGREEMENT" in res.pages[0].text
    assert "LIMITATION OF LIABILITY" in res.pages[2].text


def test_clean_text_rejoins_hyphenation_and_collapses_space():
    assert clean_text("termi-\nnation   clause\n\n\n\nnext") == "termination clause\n\nnext"


def test_corrupted_pdf_is_rejected(pdf_dir):
    bad = pdf_dir / "bad.pdf"
    bad.write_bytes(b"%PDF-1.7\nthis is not really a pdf")
    with pytest.raises(PDFProcessingError):
        extract_pdf(str(bad), ocr_enabled=False)


def test_validate_pdf_bytes():
    with pytest.raises(PDFProcessingError):
        validate_pdf_bytes(b"")
    with pytest.raises(PDFProcessingError):
        validate_pdf_bytes(b"hello world")
    validate_pdf_bytes(b"%PDF-1.4 ...")


def test_empty_pdf_has_no_text(pdf_dir):
    path = make_pdf(pdf_dir / "blank.pdf", ["", ""])
    with pytest.raises(PDFProcessingError, match="No extractable text"):
        extract_pdf(str(path), ocr_enabled=False)


def test_chunking_keeps_metadata_and_page_refs():
    pages = [ExtractedPage(i + 1, t) for i, t in enumerate(CONTRACT_PAGES)]
    chunks = chunk_pages(pages, document_id="d1", user_id="u1", document_name="msa.pdf", chunk_size=200, chunk_overlap=30)
    assert len(chunks) > 3
    for c in chunks:
        assert c.document_id == "d1" and c.user_id == "u1" and c.document_name == "msa.pdf"
        assert 1 <= c.page_number <= 3
        assert len(c.chunk_text) <= 200
        assert c.chunk_text in CONTRACT_PAGES[c.page_number - 1].replace("\n", "\n") or c.chunk_text.split()[0] in CONTRACT_PAGES[c.page_number - 1]
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
    assert "Page 2" in next(c for c in chunks if c.page_number == 2).contextual_text()


def test_chunk_overlap_must_be_smaller():
    with pytest.raises(ValueError):
        chunk_pages([ExtractedPage(1, "x" * 50)], document_id="d", user_id="u", document_name="n", chunk_size=100, chunk_overlap=100)
