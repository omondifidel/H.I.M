"""Search against a real PostgreSQL (full-text search is Postgres-only).
Runs when TEST_DATABASE_URL points at an empty, throwaway database; skipped otherwise. It drops every table there.
  TEST_DATABASE_URL=postgresql+psycopg://user:pass@localhost/him_search_test python -m pytest tests/test_search.py
"""
import os

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@localhost/x")  # the app engine is never used here
os.environ.setdefault("SECRET_KEY", "test")

import pytest  # noqa: E402

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="set TEST_DATABASE_URL to a throwaway Postgres database")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.core.database import Base  # noqa: E402
from app.modules.auth.models import User  # noqa: E402
from app.modules.library.models import Document, DocumentShare, Note  # noqa: E402
from app.modules.search import index, service  # noqa: E402
from app.modules.search import models as _search_models  # noqa: E402,F401
from app.modules.transcription.models import Transcription  # noqa: E402
from app.modules.usage import models as _usage  # noqa: E402,F401
from app.modules.notifications import models as _notifications  # noqa: E402,F401

SEGMENTS = [
    {"start": 0.0, "end": 4.0, "text": "Welcome church, karibuni sana."},
    {"start": 4.5, "end": 9.0, "text": "Turn with me to John 3:16, for God so loved the world."},
    {"start": 9.2, "end": 15.0, "text": "And I tell you, faith moves mountains when you pray."},
    {"start": 15.1, "end": 21.0, "text": "Imani inahamisha milima, amen."},
]


@pytest.fixture()
def db(monkeypatch):
    engine = create_engine(URL)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    session = sessionmaker(engine, expire_on_commit=False)()
    pastor = User(id="u-pastor", email="p@x", pw_hash="x", apps=["library", "transcribe"])
    member = User(id="u-member", email="m@x", pw_hash="x", apps=["library"])
    guest = User(id="u-guest", email="g@x", pw_hash="x", apps=[])  # no library access
    session.add_all([pastor, member, guest])
    session.add_all([Document(id="d-private", user_id=pastor.id, title="Pastor's draft.pdf", size=1),
                     Document(id="d-shared", user_id=pastor.id, title="Discipleship Basics.pdf", size=1)])
    session.add(DocumentShare(document_id="d-shared", kind="all", target_id=""))
    job = Transcription(id="t-1", user_id=pastor.id, title="Faith Sunday", speaker="Sir Elvin", original_name="a.mp3", size=1,
                        status="done", segments=SEGMENTS, duration=21, notes=[{"id": "n1", "time": 10, "body": "secret sermon note about mountains"}])
    session.add(job)
    session.commit()
    pages = {"d-private": ["The mountains of my private draft."], "d-shared": ["Prayer and fasting.", "Faith moves mountains, page two."]}
    monkeypatch.setattr(index, "pdf_pages", lambda data: pages[data.decode()])
    monkeypatch.setattr(index, "get_storage", lambda: type("S", (), {"read_bytes": lambda self, key: key[4:-4].encode()})())
    index.index_document(session, "d-private")
    index.index_document(session, "d-shared")
    index.index_sermon(session, job)
    note = Note(id="11111111-1111-1111-1111-111111111111", user_id=member.id, document_id="d-shared", page=2,
                body="My note: mountains bow to prayer", updated_at=job.created_at)
    session.add(note)
    session.commit()
    index.index_note(session, note)
    yield session, pastor, member, guest
    session.close()
    Base.metadata.drop_all(engine)
    engine.dispose()


def kinds(res):
    return sorted((r["kind"], r["id"]) for r in res["results"])


def test_phrase_in_sermon_jumps_to_the_second(db):
    s, pastor, member, guest = db
    res = service.search(s, guest, "Find me the sermon where the words 'faith moves mountains' were said")
    assert res["kind"] == "sermon"
    (hit,) = res["results"]
    assert hit["id"] == "t-1" and hit["start"] == 9.2  # the sentence, not the start of the paragraph
    assert any(p["hit"] for p in hit["snippet"])


def test_who_sees_what(db):
    s, pastor, member, guest = db
    # the pastor sees their private book, the shared one, the sermon and their own sermon note
    assert kinds(service.search(s, pastor, "mountains")) == [
        ("book", "d-private"), ("book", "d-shared"), ("note", "t-1"), ("sermon", "t-1")]
    # a member sees the shared book, the sermon and only their own note; never the private book or the pastor's note
    assert kinds(service.search(s, member, "mountains")) == [("book", "d-shared"), ("note", "d-shared"), ("sermon", "t-1")]
    # no library access: sermons only
    assert kinds(service.search(s, guest, "mountains")) == [("sermon", "t-1")]


def test_bible_reference_in_either_language(db):
    s, _, member, _ = db
    for q in ("John 3:16", "Yohana 3:16", "what did he preach on Jn 3:16?"):
        res = service.search(s, member, q)
        assert [(r["id"], r["start"]) for r in res["results"]] == [("t-1", 4.5)], q


def test_kiswahili_and_filters(db):
    s, _, member, _ = db
    assert kinds(service.search(s, member, "tafuta mahubiri kuhusu imani")) == [("sermon", "t-1")]
    assert kinds(service.search(s, member, "mountains", kind="book")) == [("book", "d-shared")]
    assert service.search(s, member, "\"faith moves mountains\"", kind="book")["results"][0]["page"] == 2


def test_nothing_found_and_reindex(db):
    s, pastor, member, _ = db
    assert service.search(s, member, "cryptocurrency yield farming")["results"] == []
    job = s.get(Transcription, "t-1")
    job.segments = [{"start": 0.0, "end": 2.0, "text": "A new message entirely."}]
    s.commit()
    index.index_sermon(s, job)
    assert service.search(s, member, "\"faith moves mountains\"", kind="sermon")["results"] == []
    index.remove_source(s, "d-shared")
    assert kinds(service.search(s, member, "mountains")) == []


def test_speaker_filter(db):
    s, pastor, member, _ = db
    other = Transcription(id="t-2", user_id=pastor.id, title="Youth night", speaker="Pastor Ann", original_name="b.mp3",
                          size=1, status="done", duration=5, segments=[{"start": 0.0, "end": 5.0, "text": "Faith moves mountains, young people."}])
    s.add(other)
    s.commit()
    index.index_sermon(s, other)
    both = service.search(s, member, "\"faith moves mountains\"", kind="sermon")["results"]
    assert sorted(r["id"] for r in both) == ["t-1", "t-2"]
    elvin = service.search(s, member, "\"faith moves mountains\"", speaker="sir elvin")["results"]  # any capitals
    assert [(r["id"], r["speaker"]) for r in elvin] == [("t-1", "Sir Elvin")]
    assert service.speakers(s) == ["Pastor Ann", "Sir Elvin"]
