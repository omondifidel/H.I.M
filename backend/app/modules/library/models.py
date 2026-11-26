import datetime as dt
import uuid
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.utils import utcnow

# The discipleship sections every PDF, book and sermon is grouped by (the HIM Library design), in programme order.
# (name, short label for the filter chips)
SECTIONS = [
    ("Intimacy / Presence of God", "Intimacy"), ("Prayer and Intercession", "Prayer"), ("Faith", "Faith"),
    ("Submission and Fatherhood / Prosperity", "Submission"), ("The Supernatural Life", "Supernatural"),
    ("Light and Illumination", "Light"), ("Royalty", "Royalty"), ("Excellence", "Excellence"),
    ("Yadon / Stature", "Yadon / Stature"), ("The Prophetic", "Prophetic"), ("Anointing", "Anointing"),
    ("Restoration", "Restoration"), ("Relationships", "Relationships"),
]
SECTION_NAMES = {name for name, _ in SECTIONS}
DOC_TYPES = ("pdf", "book", "sermon", "notes")
BOOK_PAGES = 40  # longer than this is a full book; up to this is a short teaching ("PDF")


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_page: Mapped[int] = mapped_column(Integer, default=1)
    last_paragraph: Mapped[int] = mapped_column(Integer, default=0)
    section: Mapped[str] = mapped_column(String(80), default="")  # one of SECTIONS, "" = not sorted yet
    pages: Mapped[int] = mapped_column(Integer, default=0)  # filled in when the PDF is read for search
    author: Mapped[str] = mapped_column(String(200), default="")
    doc_type: Mapped[str] = mapped_column(String(10), default="")  # "sermon" | "notes" | "book" | "pdf"; "" = by page count


class Note(Base):
    """The client creates the id (uuid) so notes can be written offline, then synced."""
    __tablename__ = "notes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), index=True)
    page: Mapped[int] = mapped_column(Integer)
    paragraph: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    body: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class DocumentShare(Base):
    """Who may read a book besides its owner: everybody, one group, or one person."""
    __tablename__ = "document_shares"
    __table_args__ = (UniqueConstraint("document_id", "kind", "target_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), index=True)
    kind: Mapped[str] = mapped_column(String(8))  # "all" | "group" | "user"
    target_id: Mapped[str] = mapped_column(String(36), default="")  # group id or user id ("" for "all")


class DocumentProgress(Base):
    """Where each reader is up to in a book somebody else owns (owners keep it on the document itself)."""
    __tablename__ = "document_progress"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), primary_key=True)
    last_page: Mapped[int] = mapped_column(Integer, default=1)
    last_paragraph: Mapped[int] = mapped_column(Integer, default=0)
