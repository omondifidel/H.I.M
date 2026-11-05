"""Read-Aloud PDF app: lightweight monolith (API + static frontend)."""
import datetime as dt
import hashlib
import hmac
import os
import secrets
import uuid
from pathlib import Path
from typing import Optional

import jwt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

load_dotenv()
DATABASE_URL = os.environ["DATABASE_URL"]
SECRET_KEY = os.environ["SECRET_KEY"]
INVITE_CODE = os.environ.get("INVITE_CODE", "")
STORAGE = Path(os.environ.get("STORAGE_DIR", "./storage"))
MAX_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "100")) * 1024 * 1024
STORAGE.mkdir(parents=True, exist_ok=True)


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    pw_hash: Mapped[str] = mapped_column(String(300))


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_page: Mapped[int] = mapped_column(Integer, default=1)
    last_paragraph: Mapped[int] = mapped_column(Integer, default=0)


class Note(Base):
    """Client creates the id (uuid) so notes can be written offline, then synced."""
    __tablename__ = "notes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), index=True)
    page: Mapped[int] = mapped_column(Integer)
    paragraph: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    body: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)


engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
Base.metadata.create_all(engine)  # simple for now; switch to Alembic later

app = FastAPI(title="Read-Aloud PDF")
_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["*"], allow_headers=["*"])


def get_db():
    with SessionLocal() as db:
        yield db


def hash_pw(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"{salt.hex()}${h.hex()}"


def check_pw(pw: str, stored: str) -> bool:
    salt_hex, h_hex = stored.split("$")
    h = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
    return hmac.compare_digest(h.hex(), h_hex)


def make_token(uid: str) -> str:
    exp = now() + dt.timedelta(days=30)
    return jwt.encode({"sub": uid, "exp": exp}, SECRET_KEY, algorithm="HS256")


def current_user(authorization: str = Header(default=""), db: Session = Depends(get_db)) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    try:
        uid = jwt.decode(authorization[7:], SECRET_KEY, algorithms=["HS256"])["sub"]
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    user = db.get(User, uid)
    if not user:
        raise HTTPException(401, "Unknown user")
    return user


def own_doc(db: Session, user: User, doc_id: str) -> Document:
    doc = db.get(Document, doc_id)
    if not doc or doc.user_id != user.id:
        raise HTTPException(404, "Document not found")
    return doc


def doc_json(d: Document) -> dict:
    return {"id": d.id, "title": d.title, "size": d.size, "created_at": d.created_at,
            "last_page": d.last_page, "last_paragraph": d.last_paragraph}


# ---------- auth ----------
class Credentials(BaseModel):
    email: str
    password: str
    invite_code: str = ""


@app.post("/api/auth/register")
def register(c: Credentials, db: Session = Depends(get_db)):
    if INVITE_CODE and not hmac.compare_digest(c.invite_code, INVITE_CODE):
        raise HTTPException(403, "Invalid invite code")
    email = c.email.strip().lower()
    if len(c.password) < 8 or "@" not in email:
        raise HTTPException(422, "Use a valid email and a password of 8+ characters")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Email already registered")
    user = User(email=email, pw_hash=hash_pw(c.password))
    db.add(user)
    db.commit()
    return {"token": make_token(user.id)}


@app.post("/api/auth/login")
def login(c: Credentials, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == c.email.strip().lower()))
    if not user or not check_pw(c.password, user.pw_hash):
        raise HTTPException(401, "Wrong email or password")
    return {"token": make_token(user.id)}


# ---------- library ----------
@app.get("/api/documents")
def list_documents(user: User = Depends(current_user), db: Session = Depends(get_db)):
    docs = db.scalars(select(Document).where(Document.user_id == user.id)
                      .order_by(Document.created_at.desc())).all()
    return [doc_json(d) for d in docs]


@app.post("/api/documents")
async def upload_document(file: UploadFile = File(...), user: User = Depends(current_user),
                          db: Session = Depends(get_db)):
    doc_id = str(uuid.uuid4())
    path = STORAGE / f"{doc_id}.pdf"
    size, first = 0, True
    try:
        with open(path, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                if first:
                    if not chunk.startswith(b"%PDF"):
                        raise HTTPException(400, "That file is not a PDF")
                    first = False
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "File is too large")
                out.write(chunk)
        if size == 0:
            raise HTTPException(400, "Empty file")
    except HTTPException:
        path.unlink(missing_ok=True)
        raise
    title = (file.filename or "Untitled.pdf")[:300]
    doc = Document(id=doc_id, user_id=user.id, title=title, size=size)
    db.add(doc)
    db.commit()
    return doc_json(doc)


@app.get("/api/documents/{doc_id}/file")
def download_document(doc_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    own_doc(db, user, doc_id)
    return FileResponse(STORAGE / f"{doc_id}.pdf", media_type="application/pdf")


@app.delete("/api/documents/{doc_id}", status_code=204)
def delete_document(doc_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = own_doc(db, user, doc_id)
    for n in db.scalars(select(Note).where(Note.document_id == doc_id)).all():
        db.delete(n)
    db.delete(doc)
    db.commit()
    (STORAGE / f"{doc_id}.pdf").unlink(missing_ok=True)


class Progress(BaseModel):
    page: int
    paragraph: int


@app.put("/api/documents/{doc_id}/progress")
def save_progress(doc_id: str, p: Progress, user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    doc = own_doc(db, user, doc_id)
    doc.last_page, doc.last_paragraph = max(1, p.page), max(0, p.paragraph)
    db.commit()
    return doc_json(doc)


# ---------- notes (offline-first sync, last write wins) ----------
class NoteIn(BaseModel):
    document_id: str
    page: int
    paragraph: Optional[int] = None
    body: str = ""
    updated_at: dt.datetime
    deleted: bool = False


def note_json(n: Note) -> dict:
    return {"id": n.id, "document_id": n.document_id, "page": n.page, "paragraph": n.paragraph,
            "body": n.body, "updated_at": n.updated_at, "deleted": n.deleted}


@app.put("/api/notes/{note_id}")
def upsert_note(note_id: str, n: NoteIn, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    try:
        uuid.UUID(note_id)
    except ValueError:
        raise HTTPException(422, "Note id must be a UUID")
    own_doc(db, user, n.document_id)
    ts = n.updated_at if n.updated_at.tzinfo else n.updated_at.replace(tzinfo=dt.timezone.utc)
    existing = db.get(Note, note_id)
    if existing and existing.user_id != user.id:
        raise HTTPException(404, "Note not found")
    if existing is None:
        existing = Note(id=note_id, user_id=user.id, document_id=n.document_id, page=n.page,
                        paragraph=n.paragraph, body=n.body, updated_at=ts, deleted=n.deleted)
        db.add(existing)
    elif ts > existing.updated_at:  # newer edit wins
        existing.page, existing.paragraph, existing.body = n.page, n.paragraph, n.body
        existing.updated_at, existing.deleted = ts, n.deleted
    db.commit()
    return note_json(existing)


@app.get("/api/notes")
def pull_notes(since: Optional[dt.datetime] = None, user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    q = select(Note).where(Note.user_id == user.id)
    if since:
        q = q.where(Note.updated_at > (since if since.tzinfo else since.replace(tzinfo=dt.timezone.utc)))
    return [note_json(n) for n in db.scalars(q.order_by(Note.updated_at)).all()]


@app.get("/api/health")
def health():
    return {"ok": True}


# Serve the built Next.js site (frontend/out) when it exists. Keep this LAST.
FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "out"
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="web")
