from typing import Optional

from sqlalchemy import JSON, Computed, Float, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.expression import FunctionElement

from app.core.database import Base

_TSV_TYPE = TSVECTOR().with_variant(Text(), "sqlite")


class _SimpleTsvector(FunctionElement):
    type = _TSV_TYPE
    inherit_cache = True


@compiles(_SimpleTsvector, "postgresql")
def _compile_tsv_pg(element, compiler, **kw):
    arg = compiler.process(list(element.clauses)[0], **kw)
    return f"to_tsvector('simple', coalesce(title, '') || ' ' || {arg})"


@compiles(_SimpleTsvector, "sqlite")
def _compile_tsv_sqlite(element, compiler, **kw):
    arg = compiler.process(list(element.clauses)[0], **kw)
    return f"coalesce(title, '') || ' ' || {arg}"


class SearchChunk(Base):
    """One searchable piece: a PDF page, a sermon paragraph or a note.
    Rebuilt whenever its source changes, so it can always be deleted and made again."""
    __tablename__ = "search_chunks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(10), index=True)  # "book" | "sermon" | "note"
    source_id: Mapped[str] = mapped_column(String(36), index=True)  # the book or sermon a result opens
    item_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)  # the note, for notes
    user_id: Mapped[str] = mapped_column(String(36))  # owner of the source (books, sermons) or of the note
    title: Mapped[str] = mapped_column(String(300), default="")
    page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # books and book notes
    start: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # seconds, sermons and sermon notes
    text: Mapped[str] = mapped_column(Text, default="")
    times: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)  # sermons: [[char offset, seconds], ...]
    # "simple" keeps every word as spoken: English stemming would mangle Kiswahili and mixed sermons
    tsv = mapped_column(_TSV_TYPE, Computed(_SimpleTsvector(text), persisted=True))

    __table_args__ = (Index("ix_search_chunks_tsv", "tsv", postgresql_using="gin"),)
