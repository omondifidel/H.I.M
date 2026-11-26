"""Library shelves: sections, PDF-or-book by page count, and sermon listening progress. Plain SQLite, always runs."""
import os

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@localhost/x")  # the app engine is never used here
os.environ.setdefault("SECRET_KEY", "test")

import pytest  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.core.database import Base  # noqa: E402
from app.core.errors import Invalid  # noqa: E402
from app.modules.auth.models import User  # noqa: E402
from app.modules.library import service as library  # noqa: E402
from app.modules.library.models import Document, DocumentShare  # noqa: E402
from app.modules.library.schemas import DocumentPatch  # noqa: E402
from app.modules.notifications import models as _notifications  # noqa: E402,F401
from app.modules.search import models as _search  # noqa: E402,F401
from app.modules.transcription import service as sermons  # noqa: E402
from app.modules.transcription.models import Transcription  # noqa: E402
from app.modules.transcription.schemas import PositionIn  # noqa: E402
from app.modules.usage import models as _usage  # noqa: E402,F401


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = sessionmaker(engine, expire_on_commit=False)()
    pastor = User(id="u-pastor", email="p@x", pw_hash="x", apps=["library", "transcribe"])
    member = User(id="u-member", email="m@x", pw_hash="x", apps=["library"])
    session.add_all([pastor, member,
                     Document(id="d-short", user_id=pastor.id, title="Am I born again.pdf", size=1, pages=8),
                     Document(id="d-long", user_id=pastor.id, title="The Name of Jesus.pdf", size=1, pages=112),
                     DocumentShare(document_id="d-short", kind="all", target_id=""),
                     Transcription(id="t-done", user_id=pastor.id, title="Prayer Code", original_name="a.mp3", size=1,
                                   status="done", has_audio=True, duration=600),
                     Transcription(id="t-busy", user_id=pastor.id, title="Still working", original_name="b.mp3", size=1,
                                   status="processing", has_audio=True, duration=0)])
    session.commit()
    yield session, pastor, member
    session.close()


def test_short_teachings_are_pdfs_and_long_ones_books(db):
    session, pastor, member = db
    kinds = {d.id: d.kind for d in library.list_documents(session, pastor)}
    assert kinds == {"d-short": "pdf", "d-long": "book"}
    assert [d.id for d in library.list_documents(session, member)] == ["d-short"]  # only what is shared


def test_owner_sorts_into_a_known_section_only(db):
    session, pastor, member = db
    out = library.patch_document(session, pastor, "d-short", DocumentPatch(section="Prayer and Intercession"))
    assert out.section == "Prayer and Intercession"
    with pytest.raises(Invalid):
        library.patch_document(session, pastor, "d-short", DocumentPatch(section="Made up"))
    with pytest.raises(Exception):  # a reader it was shared with may not re-sort the owner's PDF
        library.patch_document(session, member, "d-short", DocumentPatch(section="Faith"))
    out = library.patch_document(session, pastor, "d-short", DocumentPatch(
        groups=["Warfare / Men", "Intercession / Family"], kind="notes"))
    assert (out.groups, out.kind) == (["Intercession / Family", "Warfare / Men"], "notes")  # kept in list order
    with pytest.raises(Invalid):
        library.patch_document(session, pastor, "d-short", DocumentPatch(groups=["Made up"]))


def test_sermon_progress_is_per_listener_and_capped(db):
    session, pastor, member = db
    assert [c.id for c in sermons.sermon_cards(session, member)] == ["t-done"]  # unfinished jobs stay hidden
    sermons.save_position(session, member, "t-done", PositionIn(position=125.5))
    sermons.save_position(session, member, "t-done", PositionIn(position=9999))  # past the end -> the end
    assert sermons.sermon_cards(session, member)[0].position == 600
    assert sermons.sermon_cards(session, pastor)[0].position == 0  # the pastor has not listened
