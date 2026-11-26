import datetime as dt
import uuid
from pathlib import Path
from typing import Optional

from fastapi import UploadFile
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import BadRequest, Invalid, NotFound, TooLarge
from app.core.storage import get_storage
from app.core.utils import as_utc, utcnow
from app.modules.auth.groups import group_ids_for
from app.modules.auth.models import User
from app.modules.library.models import BOOK_PAGES, SECTION_NAMES, Document, DocumentProgress, DocumentShare, Note
from app.modules.library.schemas import DocumentOut, DocumentPatch, NoteIn, ProgressIn
from app.modules.search import index as search_index
from app.modules.usage import service as usage


def pdf_key(doc_id: str) -> str:
    return f"pdf/{doc_id}.pdf"


# ---------- who may read what ----------
def _share_condition(user: User, group_ids: list[str]):
    options = [DocumentShare.kind == "all", and_(DocumentShare.kind == "user", DocumentShare.target_id == user.id)]
    if group_ids:
        options.append(and_(DocumentShare.kind == "group", DocumentShare.target_id.in_(group_ids)))
    return or_(*options)


def get_accessible_document(db: Session, user: User, doc_id: str) -> Document:
    """A book you own, or one that was shared with you (directly, through a group, or with everybody)."""
    doc = db.get(Document, doc_id)
    if not doc:
        raise NotFound("Document not found")
    if doc.user_id == user.id:
        return doc
    shared = db.scalar(select(DocumentShare.id).where(DocumentShare.document_id == doc_id,
                                                      _share_condition(user, group_ids_for(db, user))).limit(1))
    if shared is None:
        raise NotFound("Document not found")
    return doc


def get_owned_document(db: Session, user: User, doc_id: str) -> Document:
    doc = db.get(Document, doc_id)
    if not doc or doc.user_id != user.id:
        raise NotFound("Document not found")
    return doc


def _out(doc: Document, page: int, paragraph: int, shared: bool) -> DocumentOut:
    return DocumentOut(id=doc.id, title=doc.title, size=doc.size, created_at=doc.created_at, last_page=page,
                       last_paragraph=paragraph, shared=shared, section=doc.section or "", pages=doc.pages or 0,
                       author=doc.author or "", kind="book" if (doc.pages or 0) > BOOK_PAGES else "pdf")


def to_out(db: Session, user: User, doc: Document) -> DocumentOut:
    if doc.user_id == user.id:
        return _out(doc, doc.last_page, doc.last_paragraph, False)
    row = db.get(DocumentProgress, (user.id, doc.id))
    return _out(doc, row.last_page if row else 1, row.last_paragraph if row else 0, True)


def list_documents(db: Session, user: User) -> list[DocumentOut]:
    shared_ids = select(DocumentShare.document_id).where(_share_condition(user, group_ids_for(db, user)))
    docs = db.scalars(select(Document).where(or_(Document.user_id == user.id, Document.id.in_(shared_ids)))
                      .order_by(Document.created_at.desc())).all()
    progress = {p.document_id: p for p in db.scalars(select(DocumentProgress).where(DocumentProgress.user_id == user.id)).all()}
    out = []
    for doc in docs:
        if doc.user_id == user.id:
            out.append(_out(doc, doc.last_page, doc.last_paragraph, False))
        else:
            row = progress.get(doc.id)
            out.append(_out(doc, row.last_page if row else 1, row.last_paragraph if row else 0, True))
    return out


def check_section(section: str) -> str:
    section = (section or "").strip()
    if section and section not in SECTION_NAMES:
        raise Invalid("Unknown section")
    return section


def patch_document(db: Session, user: User, doc_id: str, p: DocumentPatch) -> DocumentOut:
    """The owner sorts a PDF into a section or corrects its author."""
    doc = get_owned_document(db, user, doc_id)
    if p.section is not None:
        doc.section = check_section(p.section)
    if p.author is not None:
        doc.author = p.author.strip()[:200]
    db.commit()
    return to_out(db, user, doc)


# ---------- uploading, downloading, deleting ----------
async def create_document(db: Session, user: User, file: UploadFile, section: str = "") -> Document:
    section = check_section(section)
    doc_id = str(uuid.uuid4())
    temp = settings.storage_dir / "tmp" / f"{doc_id}.pdf"
    temp.parent.mkdir(parents=True, exist_ok=True)
    size, first = 0, True
    try:
        with open(temp, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                if first:
                    if not chunk.startswith(b"%PDF"):
                        raise BadRequest("That file is not a PDF")
                    first = False
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise TooLarge("File is too large")
                out.write(chunk)
        if size == 0:
            raise BadRequest("Empty file")
        get_storage().put_file(pdf_key(doc_id), temp)
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    doc = Document(id=doc_id, user_id=user.id, title=(file.filename or "Untitled.pdf")[:300], size=size,
                   section=section)
    db.add(doc)
    db.commit()
    search_index.index_document_later(doc_id)
    return doc


def file_key_for_download(db: Session, user: User, doc_id: str) -> str:
    get_accessible_document(db, user, doc_id)
    key = pdf_key(doc_id)
    if not get_storage().exists(key):
        raise NotFound("The file for this PDF is missing on the server")
    return key


def mark_opened(db: Session, user: User, doc_id: str) -> None:
    get_accessible_document(db, user, doc_id)
    usage.record(db, user.id, "library", "document_open", doc_id, throttle_minutes=30)


def _purge(db: Session, doc: Document) -> None:
    db.execute(delete(Note).where(Note.document_id == doc.id))
    db.execute(delete(DocumentShare).where(DocumentShare.document_id == doc.id))
    db.execute(delete(DocumentProgress).where(DocumentProgress.document_id == doc.id))
    db.delete(doc)
    db.commit()
    search_index.remove_source(db, doc.id)  # its pages and the notes on it
    get_storage().delete(pdf_key(doc.id))


def delete_document(db: Session, user: User, doc_id: str) -> None:
    _purge(db, get_owned_document(db, user, doc_id))


def save_progress(db: Session, user: User, doc_id: str, p: ProgressIn) -> DocumentOut:
    doc = get_accessible_document(db, user, doc_id)
    page, paragraph = max(1, p.page), max(0, p.paragraph)
    if doc.user_id == user.id:
        doc.last_page, doc.last_paragraph = page, paragraph
    else:
        row = db.get(DocumentProgress, (user.id, doc.id))
        if row is None:
            db.add(DocumentProgress(user_id=user.id, document_id=doc.id, last_page=page, last_paragraph=paragraph))
        else:
            row.last_page, row.last_paragraph = page, paragraph
    db.commit()
    return to_out(db, user, doc)


# ---------- notes (offline-first sync, last write wins) ----------
def upsert_note(db: Session, user: User, note_id: str, n: NoteIn) -> Note:
    try:
        uuid.UUID(note_id)
    except ValueError:
        raise Invalid("Note id must be a UUID")
    get_accessible_document(db, user, n.document_id)
    ts = as_utc(n.updated_at)
    existing = db.get(Note, note_id)
    if existing and existing.user_id != user.id:
        raise NotFound("Note not found")
    if existing is None:
        existing = Note(id=note_id, user_id=user.id, document_id=n.document_id, page=n.page,
                        paragraph=n.paragraph, body=n.body, updated_at=ts, deleted=n.deleted)
        db.add(existing)
    elif ts > as_utc(existing.updated_at):  # the newer edit wins
        existing.page, existing.paragraph, existing.body = n.page, n.paragraph, n.body
        existing.updated_at, existing.deleted = ts, n.deleted
    db.commit()
    search_index.index_note(db, existing)
    return existing


def pull_notes(db: Session, user: User, since: Optional[dt.datetime]) -> list[Note]:
    q = select(Note).where(Note.user_id == user.id)
    if since:
        q = q.where(Note.updated_at > as_utc(since))
    return list(db.scalars(q.order_by(Note.updated_at)).all())


# ---------- things the admin area asks for ----------
def list_all_documents(db: Session) -> list[Document]:
    return list(db.scalars(select(Document).order_by(Document.created_at.desc())).all())


def delete_any_document(db: Session, doc_id: str) -> None:
    doc = db.get(Document, doc_id)
    if not doc:
        raise NotFound("Book not found")
    _purge(db, doc)


def shares_for(db: Session, doc_ids: list[str]) -> dict[str, list[tuple[str, str]]]:
    out: dict[str, list[tuple[str, str]]] = {}
    if not doc_ids:
        return out
    for share in db.scalars(select(DocumentShare).where(DocumentShare.document_id.in_(doc_ids))).all():
        out.setdefault(share.document_id, []).append((share.kind, share.target_id))
    return out


def set_shares(db: Session, doc_id: str, everyone: bool, group_ids: list[str], user_ids: list[str]) -> None:
    if not db.get(Document, doc_id):
        raise NotFound("Book not found")
    db.execute(delete(DocumentShare).where(DocumentShare.document_id == doc_id))
    if everyone:
        db.add(DocumentShare(document_id=doc_id, kind="all", target_id=""))
    for gid in dict.fromkeys(group_ids):
        db.add(DocumentShare(document_id=doc_id, kind="group", target_id=gid))
    for uid in dict.fromkeys(user_ids):
        db.add(DocumentShare(document_id=doc_id, kind="user", target_id=uid))
    db.commit()


def remove_group_shares(db: Session, group_id: str) -> None:
    db.execute(delete(DocumentShare).where(DocumentShare.kind == "group", DocumentShare.target_id == group_id))
    db.commit()


def document_counts(db: Session) -> dict[str, int]:
    rows = db.execute(select(Document.user_id, func.count(Document.id)).group_by(Document.user_id)).all()
    return {user_id: count for user_id, count in rows}


def totals(db: Session) -> dict[str, int]:
    return {
        "documents": db.scalar(select(func.count(Document.id))) or 0,
        "notes": db.scalar(select(func.count(Note.id)).where(Note.deleted.is_(False))) or 0,
    }


def titles_for(db: Session, doc_ids: list[str]) -> dict[str, str]:
    if not doc_ids:
        return {}
    return {doc_id: title for doc_id, title in db.execute(select(Document.id, Document.title).where(Document.id.in_(doc_ids))).all()}
