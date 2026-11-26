import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.storage import get_storage
from app.modules.auth.deps import current_user, require_app
from app.modules.auth.models import User
from app.modules.library import service
from app.modules.library.models import GROUPS, SECTIONS
from app.modules.library.schemas import DocumentOut, DocumentPatch, NoteIn, NoteOut, ProgressIn

router = APIRouter(prefix="/api", tags=["library"])
library_user = require_app("library")


@router.get("/sections")
def sections(user: User = Depends(current_user)):
    """The discipleship sections, in programme order (the library and Transcribe both use them)."""
    return [{"name": name, "short": short} for name, short in SECTIONS]


@router.get("/groups")
def groups(user: User = Depends(current_user)):
    """The second label (Intercession / Family, Warfare / Men, ...); a book can be in several."""
    return GROUPS


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(user: User = Depends(library_user), db: Session = Depends(get_db)):
    return service.list_documents(db, user)


@router.post("/documents", response_model=DocumentOut)
async def upload_document(file: UploadFile = File(...), section: str = Form(""), user: User = Depends(library_user),
                          db: Session = Depends(get_db)):
    doc = await service.create_document(db, user, file, section)
    return service.to_out(db, user, doc)


@router.get("/documents/{doc_id}/file")
def download_document(doc_id: str, user: User = Depends(library_user), db: Session = Depends(get_db)):
    return get_storage().response(service.file_key_for_download(db, user, doc_id), "application/pdf")


@router.post("/documents/{doc_id}/opened", status_code=204)
def document_opened(doc_id: str, user: User = Depends(library_user), db: Session = Depends(get_db)):
    service.mark_opened(db, user, doc_id)


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(doc_id: str, user: User = Depends(library_user), db: Session = Depends(get_db)):
    service.delete_document(db, user, doc_id)


@router.patch("/documents/{doc_id}", response_model=DocumentOut)
def patch_document(doc_id: str, p: DocumentPatch, user: User = Depends(library_user), db: Session = Depends(get_db)):
    return service.patch_document(db, user, doc_id, p)


@router.put("/documents/{doc_id}/progress", response_model=DocumentOut)
def save_progress(doc_id: str, p: ProgressIn, user: User = Depends(library_user), db: Session = Depends(get_db)):
    return service.save_progress(db, user, doc_id, p)


@router.put("/notes/{note_id}", response_model=NoteOut)
def upsert_note(note_id: str, n: NoteIn, user: User = Depends(library_user), db: Session = Depends(get_db)):
    return service.upsert_note(db, user, note_id, n)


@router.get("/notes", response_model=list[NoteOut])
def pull_notes(since: Optional[dt.datetime] = None, user: User = Depends(library_user), db: Session = Depends(get_db)):
    return service.pull_notes(db, user, since)
