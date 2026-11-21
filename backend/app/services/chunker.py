"""Paragraph-aware recursive chunking that preserves page references."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.services.pdf_processor import ExtractedPage

SEPARATORS = ["\n\n", "\n", ". ", "; ", ", ", " ", ""]


@dataclass
class Chunk:
    chunk_id: str
    document_id: str
    user_id: str
    document_name: str
    page_number: int
    chunk_index: int
    chunk_text: str

    def contextual_text(self) -> str:
        """Text used for embeddings: a short header situates the chunk in its document
        (lightweight 'contextual retrieval')."""
        return f"Document: {self.document_name} | Page {self.page_number}\n{self.chunk_text}"

    def payload(self) -> dict:
        return {
            "chunk_id": self.chunk_id,
            "document_id": self.document_id,
            "user_id": self.user_id,
            "document_name": self.document_name,
            "page_number": self.page_number,
            "chunk_index": self.chunk_index,
            "chunk_text": self.chunk_text,
        }


def make_splitter(chunk_size: int, chunk_overlap: int) -> RecursiveCharacterTextSplitter:
    if chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be smaller than chunk_size")
    return RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=SEPARATORS,
        keep_separator="end",
        strip_whitespace=True,
    )


def chunk_pages(
    pages: list[ExtractedPage],
    *,
    document_id: str,
    user_id: str,
    document_name: str,
    chunk_size: int = 1000,
    chunk_overlap: int = 150,
    min_chars: int = 20,
) -> list[Chunk]:
    """Split each page separately so every chunk maps to exactly one page number."""
    splitter = make_splitter(chunk_size, chunk_overlap)
    chunks: list[Chunk] = []
    idx = 0
    for page in pages:
        for piece in splitter.split_text(page.text):
            piece = piece.strip()
            if len(piece) < min_chars:
                continue
            chunks.append(
                Chunk(
                    chunk_id=str(uuid.uuid4()),
                    document_id=document_id,
                    user_id=user_id,
                    document_name=document_name,
                    page_number=page.page_number,
                    chunk_index=idx,
                    chunk_text=piece,
                )
            )
            idx += 1
    return chunks
