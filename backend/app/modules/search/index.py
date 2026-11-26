"""Keeps search_chunks in step with books, sermons and notes. Every change rebuilds that source's rows,
so running anything here twice is harmless. Indexing never breaks the action that triggered it."""
import io
import logging
import re
import threading

from sqlalchemy import delete, exists, or_, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.storage import get_storage
from app.modules.library import sorter
from app.modules.library.models import Document, Note
from app.modules.search.models import SearchChunk
from app.modules.transcription import merge
from app.modules.transcription.models import Transcription

log = logging.getLogger("search")
logging.getLogger("pypdf").setLevel(logging.ERROR)  # slightly broken PDFs still read fine; don't flood the log


def _safe(fn):
    def run(db: Session, *args):
        try:
            fn(db, *args)
            db.commit()
        except Exception:
            db.rollback()
            log.exception("search indexing failed in %s", fn.__name__)
    return run


def pdf_pages(data: bytes) -> list[str]:
    from pypdf import PdfReader

    pages = []
    for page in PdfReader(io.BytesIO(data)).pages:
        try:
            text = page.extract_text() or ""
        except Exception:  # one broken page should not hide the rest of the book
            text = ""
        text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)  # words split across lines
        pages.append(re.sub(r"\s+", " ", text).strip())
    return pages


def pdf_author(data: bytes) -> str:
    from pypdf import PdfReader

    try:
        return str(PdfReader(io.BytesIO(data)).metadata.author or "").strip()[:200]
    except Exception:  # no metadata, or not a real PDF
        return ""


@_safe
def index_document(db: Session, doc_id: str) -> None:
    from app.modules.library.service import pdf_key

    doc = db.get(Document, doc_id)
    if not doc:
        return
    data = get_storage().read_bytes(pdf_key(doc_id))
    pages = pdf_pages(data)
    doc.pages = len(pages)  # the library sorts short teachings (PDFs) from full books by this
    doc.author = doc.author or pdf_author(data)
    if not doc.section or not doc.doc_type:  # never undo what the owner chose
        found = sorter.classify(doc.title, pages)
        doc.section = doc.section or found.section
        doc.doc_type = doc.doc_type or (found.kind if found.kind in ("sermon", "notes") else "")
        log.info("sorted %r: %s / %s (%s) %s", doc.title, found.kind, found.section or "-", found.by, found.reason)
    db.execute(delete(SearchChunk).where(SearchChunk.kind == "book", SearchChunk.source_id == doc_id))
    rows = [SearchChunk(kind="book", source_id=doc.id, user_id=doc.user_id, title=doc.title, page=n, text=t)
            for n, t in enumerate(pages, 1) if t]
    # a scanned PDF has no text: an empty page-0 row marks it as done so it is not read again at every start
    db.add_all(rows or [SearchChunk(kind="book", source_id=doc.id, user_id=doc.user_id, title=doc.title, page=0, text="")])


@_safe
def index_sermon(db: Session, job: Transcription) -> None:
    """A finished sermon: one row per paragraph (with the second each sentence starts) plus its notes."""
    db.execute(delete(SearchChunk).where(SearchChunk.source_id == job.id))
    if job.status != "done":
        return
    segments = job.segments or []
    for para in merge.group_paragraphs(segments):
        times, offset = [], 0
        for seg in segments[para["first"]:para["last"] + 1]:
            times.append([offset, seg["start"]])
            offset += len(seg["text"]) + 1  # paragraphs join their sentences with one space
        db.add(SearchChunk(kind="sermon", source_id=job.id, user_id=job.user_id, title=job.title,
                           start=para["start"], text=para["text"], times=times))
    for note in job.notes or []:
        if (note.get("body") or "").strip():
            db.add(SearchChunk(kind="note", source_id=job.id, item_id=note.get("id"), user_id=job.user_id,
                               title=job.title, start=note.get("time") or 0, text=note["body"].strip()))


@_safe
def index_note(db: Session, note: Note) -> None:
    db.execute(delete(SearchChunk).where(SearchChunk.item_id == note.id))
    if note.deleted or not note.body.strip():
        return
    doc = db.get(Document, note.document_id)
    db.add(SearchChunk(kind="note", source_id=note.document_id, item_id=note.id, user_id=note.user_id,
                       title=doc.title if doc else "", page=note.page, text=note.body.strip()))


@_safe
def remove_source(db: Session, source_id: str) -> None:
    db.execute(delete(SearchChunk).where(SearchChunk.source_id == source_id))


def backfill() -> None:
    """Indexes whatever is not indexed yet: everything on the first start, then only new things."""
    with SessionLocal() as db:
        for doc_id in db.scalars(select(Document.id).where(or_(Document.pages == 0, ~exists().where(
                SearchChunk.kind == "book", SearchChunk.source_id == Document.id)))).all():
            index_document(db, doc_id)
        for job in db.scalars(select(Transcription).where(Transcription.status == "done",
                                                          ~exists().where(SearchChunk.source_id == Transcription.id))).all():
            index_sermon(db, job)
        for note in db.scalars(select(Note).where(Note.deleted.is_(False), Note.body != "",
                                                  ~exists().where(SearchChunk.item_id == Note.id))).all():
            index_note(db, note)
    log.info("search backfill finished")


def index_document_later(doc_id: str) -> None:
    """Upload returns at once; the pages are read in the background (big books take a few seconds)."""
    def run():
        with SessionLocal() as db:
            index_document(db, doc_id)
    threading.Thread(target=run, daemon=True).start()
