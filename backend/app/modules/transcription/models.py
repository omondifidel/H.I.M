import datetime as dt
import uuid
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.utils import utcnow

# uploading -> queued -> processing -> done  (or failed / cancelled)


class Transcription(Base):
    __tablename__ = "transcriptions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    original_name: Mapped[str] = mapped_column(String(300))
    size: Mapped[int] = mapped_column(Integer)
    language: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # None = detect automatically
    vocabulary: Mapped[str] = mapped_column(Text, default="")
    bible: Mapped[bool] = mapped_column(Boolean, default=True)
    mixed: Mapped[bool] = mapped_column(Boolean, default=False)  # English and Kiswahili mixed together
    chunk_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # None = server default
    status: Mapped[str] = mapped_column(String(20), default="uploading", index=True)
    note: Mapped[str] = mapped_column(String(300), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    chunks_total: Mapped[int] = mapped_column(Integer, default=0)
    chunks_done: Mapped[int] = mapped_column(Integer, default=0)
    duration: Mapped[float] = mapped_column(Float, default=0.0)
    engine: Mapped[str] = mapped_column(String(40), default="")
    has_audio: Mapped[bool] = mapped_column(Boolean, default=False)
    segments: Mapped[list] = mapped_column(JSON, default=list)  # [{start, end, text, low}]
    text: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[list] = mapped_column(JSON, default=list)  # [{id, time, body}] sermon notes
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    finished_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class TranscriptionChunk(Base):
    """Result of one piece of the recording. Saved as soon as it finishes, so a restart never
    repeats finished work."""
    __tablename__ = "transcription_chunks"
    __table_args__ = (UniqueConstraint("transcription_id", "idx"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transcription_id: Mapped[str] = mapped_column(ForeignKey("transcriptions.id"), index=True)
    idx: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(10), default="pending")  # pending | done
    segments: Mapped[list] = mapped_column(JSON, default=list)  # raw engine segments
